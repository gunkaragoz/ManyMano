import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, useNavigation, useSearchParams, Form } from "@remix-run/react";
import { eq, and, inArray } from "drizzle-orm";
import { useState, useMemo } from "react";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CircleCheck,
  Clock,
  Download,
  Link2,
  Lock,
  MapPin,
  Minus,
  PartyPopper,
  Pencil,
  Star,
  Target,
  TriangleAlert,
  Trophy,
  User,
  X,
} from "lucide-react";
import { getDb, events, eventSlots, signups, pollVotes, pollVoteEntries } from "~/db";
import { generateInternalId, generateSecretToken } from "~/utils/ids";
import { sendEmail } from "~/utils/email";
import { escapeHtml } from "~/utils/sanitize";
import {
  buildAdminCookie,
  buildExpiredAdminCookie,
  checkAdminRateLimit,
  getPresentedAdminToken,
  hashSecretForStorage,
  secretMatches,
} from "~/utils/auth";
import { expiryDateFor, isExpired, pruneExpiredEvents, RETENTION_DAYS } from "~/utils/retention";
import { verifyTurnstile, turnstileFailure } from "~/utils/turnstile";
import Turnstile from "~/components/Turnstile";
import DatePicker from "~/components/DatePicker";
import { buildGoogleCalendarUrl, pickCalendarSlot, effectiveDateForSlot, formatSlotDateLabel, formatDurationLabel } from "~/utils/calendar";
import {
  SITE_NAME,
  mergeParentMeta,
  pageMetaOverrides,
  truncate,
} from "~/utils/seo";
import {
  COMMENT_MAX,
  DESCRIPTION_MAX,
  EMAIL_MAX,
  LOCATION_MAX,
  MAX_SLOTS_PER_EVENT,
  ORGANIZER_NAME_MAX,
  PARTICIPANT_NAME_MAX,
  SHIFT_NAME_MAX,
  SLOT_TITLE_MAX,
  TITLE_MAX,
  cleanText,
  isValidEmail,
} from "~/utils/validation";

// Events are unlisted (robots.txt disallows /events/). Keep them out of
// search indexes and give each event a real title/description. Remix renders
// only the deepest `meta` export, so merge parent descriptors (OG image,
// twitter card, etc.) and override title/description/canonical/robots.
export const meta: MetaFunction<typeof loader> = ({ data, matches }) => {
  const fallbackTitle = `Event | ${SITE_NAME}`;
  const fallbackDescription =
    "View event details and respond. No account needed.";
  if (!data?.event) {
    return mergeParentMeta(matches, [
      ...pageMetaOverrides({
        title: fallbackTitle,
        description: fallbackDescription,
        path: "/",
        robots: "noindex, nofollow",
      }),
    ]);
  }
  const rawTitle = (data.event.title || "Untitled event").trim() || "Untitled event";
  const title = truncate(`${rawTitle} | ${SITE_NAME}`, 70);
  const rawDesc =
    (data.event.description || "").trim() ||
    (data.event.type === "SIGNUP_SHEET"
      ? `Sign up for ${rawTitle}. No account needed — claim your spot in seconds.`
      : `Vote on the best time for ${rawTitle}. No account needed.`);
  const description = truncate(rawDesc, 155);
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({
      title,
      description,
      path: `/events/${data.event.id}`,
      robots: "noindex, nofollow",
    }),
  ]);
};

function publicEventShape(e: typeof events.$inferSelect) {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    description: e.description,
    eventDate: e.eventDate,
    location: e.location,
    organizerName: e.organizerName,
    status: e.status,
    winningSlotId: e.winningSlotId,
    timezone: e.timezone,
    durationMinutes: (e as { durationMinutes?: number | null }).durationMinutes ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    expiresAt: expiryDateFor(e.createdAt),
    retentionDays: RETENTION_DAYS,
  };
}

function adminEventShape(e: typeof events.$inferSelect) {
  return {
    ...publicEventShape(e),
    organizerEmail: e.organizerEmail,
  };
}

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as {
    DB: D1Database;
    RESEND_API_KEY?: string;
    FROM_EMAIL?: string;
    TURNSTILE_SITE_KEY?: string;
  };
  const db = getDb(env.DB);
  const eventId = params.id;

  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  // Best-effort auto-prune of long-expired events.
  try {
    await pruneExpiredEvents(db);
  } catch {
    // pruning must never break reads
  }

  // Fetch event
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw new Response("Event not found", { status: 404 });
  }

  if (isExpired(event.createdAt)) {
    throw new Response("This event expired and was auto-deleted.", { status: 410 });
  }

  const url = new URL(request.url);

  // Self-serve cancellation via emailed ?cancel_token= (signup or poll vote).
  // Security: GET never mutates — it only validates the token and surfaces a
  // one-click confirm form. Actual deletion happens in the `cancel_by_token`
  // POST action below (CSRF-safe, no <img>/prefetch deletion).
  const cancelToken = url.searchParams.get("cancel_token");
  let pendingCancel: { kind: "signup" | "vote"; name: string } | null = null;
  if (cancelToken) {
    const candidates = await db.select().from(signups).where(eq(signups.eventId, eventId));
    let matchedSignup: typeof candidates[number] | null = null;
    for (const s of candidates) {
      if (await secretMatches(cancelToken, s.editToken)) {
        matchedSignup = s;
        break;
      }
    }
    if (matchedSignup) {
      pendingCancel = { kind: "signup", name: matchedSignup.participantName };
    } else {
      const voteCandidates = await db.select().from(pollVotes).where(eq(pollVotes.eventId, eventId));
      for (const v of voteCandidates) {
        if (await secretMatches(cancelToken, v.editToken)) {
          pendingCancel = { kind: "vote", name: v.participantName };
          break;
        }
      }
      if (!pendingCancel) {
        return redirect(`/events/${eventId}?cancel_error=1`);
      }
    }
  }

  // Check admin access: HttpOnly cookie preferred, ?admin= supported for bookmarks.
  const presented = getPresentedAdminToken(request, eventId);
  let isAdmin = false;
  if (presented) {
    const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
    if (checkAdminRateLimit(`${clientIp}:${eventId}`)) {
      isAdmin = await secretMatches(presented, event.adminToken);
    }
  }

  // If a valid ?admin= token was just presented via URL, upgrade to a
  // cookie and redirect to the clean URL so the secret leaves history/logs.
  const adminQuery = url.searchParams.get("admin");
  const hasAdminCookie = (request.headers.get("cookie") || "").includes(`mm_admin_${eventId}=`);
  if (isAdmin && adminQuery && !hasAdminCookie) {
    const clean = new URL(request.url);
    clean.searchParams.delete("admin");
    const headers = new Headers();
    headers.append("Set-Cookie", buildAdminCookie(eventId, adminQuery));
    headers.set("Cache-Control", "private, no-store");
    headers.set("Referrer-Policy", "no-referrer");
    return redirect(clean.toString(), { headers });
  }

  // Fetch slots (polls: chronological by day then time; sheets keep author order)
  const rawSlots = await db
    .select()
    .from(eventSlots)
    .where(eq(eventSlots.eventId, eventId))
    .orderBy(eventSlots.displayOrder);
  const slots =
    event.type === "TIME_POLL"
      ? [...rawSlots].sort((a, b) => {
          const dateCmp = ((a as { slotDate?: string | null }).slotDate || "").localeCompare(
            (b as { slotDate?: string | null }).slotDate || ""
          );
          if (dateCmp !== 0) return dateCmp;
          const timeCmp = (a.startTime || "").localeCompare(b.startTime || "");
          if (timeCmp !== 0) return timeCmp;
          return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
        })
      : rawSlots;

  if (event.type === "SIGNUP_SHEET") {
    // Fetch signups — never expose emails or edit tokens to non-admins,
    // and never expose edit tokens to anyone (self-serve uses emailed link).
    const eventSignups = await db
      .select()
      .from(signups)
      .where(and(eq(signups.eventId, eventId), eq(signups.status, "CONFIRMED")));

    const safeSignups = eventSignups.map((s) => ({
      id: s.id,
      slotId: s.slotId,
      eventId: s.eventId,
      participantName: s.participantName,
      participantEmail: isAdmin ? s.participantEmail : null,
      customFields: s.customFields,
      status: s.status,
      createdAt: s.createdAt,
    }));

    return json(
      {
        event: isAdmin ? adminEventShape(event) : publicEventShape(event),
        slots,
        signups: safeSignups,
        isAdmin,
        // Echoed only to a proven admin (they already presented it).
        // Forms prefer the HttpOnly cookie; this is a fallback for cookie-less clients.
        adminToken: isAdmin ? presented : null,
        pollData: null,
        pendingCancel,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      },
      {
        headers: {
          "Cache-Control": isAdmin || pendingCancel ? "private, no-store" : "public, max-age=15",
        },
      }
    );
  } else {
    // TIME_POLL: Fetch votes and entries (scoped to this event only —
    // never load the whole poll_vote_entries table).
    const votes = await db.select().from(pollVotes).where(eq(pollVotes.eventId, eventId));
    const voteIds = votes.map((v) => v.id);
    const entries =
      voteIds.length > 0
        ? await db
            .select({
              id: pollVoteEntries.id,
              pollVoteId: pollVoteEntries.pollVoteId,
              slotId: pollVoteEntries.slotId,
              response: pollVoteEntries.response,
            })
            .from(pollVoteEntries)
            .where(inArray(pollVoteEntries.pollVoteId, voteIds))
        : [];

    // Map votes with their entry responses — emails only for admins,
    // edit tokens never leave the server.
    const votesWithResponses = votes.map((v) => {
      const vEntries = entries.filter((e) => e.pollVoteId === v.id);
      const responses: Record<string, string> = {};
      vEntries.forEach((e) => {
        responses[e.slotId] = e.response;
      });
      return {
        id: v.id,
        participantName: v.participantName,
        participantEmail: isAdmin ? v.participantEmail : null,
        responses,
      };
    });

    // Compute tallies per slot
    const slotTallies: Record<string, { yes: number; maybe: number }> = {};
    slots.forEach((s) => {
      slotTallies[s.id] = { yes: 0, maybe: 0 };
    });

    votesWithResponses.forEach((v) => {
      Object.entries(v.responses).forEach(([slotId, resp]) => {
        if (slotTallies[slotId]) {
          if (resp === "YES") slotTallies[slotId].yes += 1;
          if (resp === "MAYBE") slotTallies[slotId].maybe += 1;
        }
      });
    });

    return json(
      {
        event: isAdmin ? adminEventShape(event) : publicEventShape(event),
        slots,
        signups: [],
        isAdmin,
        adminToken: isAdmin ? presented : null,
        pollData: {
          votes: votesWithResponses,
          tallies: slotTallies,
        },
        pendingCancel,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      },
      {
        headers: {
          "Cache-Control": isAdmin || pendingCancel ? "private, no-store" : "public, max-age=15",
        },
      }
    );
  }
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as {
    DB: D1Database;
    RESEND_API_KEY?: string;
    FROM_EMAIL?: string;
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_HOSTNAMES?: string;
  };
  const db = getDb(env.DB);
  const eventId = params.id;

  if (!eventId) {
    return json({ error: "Missing event ID." }, { status: 400 });
  }

  try {
    await pruneExpiredEvents(db);
  } catch {}

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    return json({ error: "Event not found." }, { status: 404 });
  }
  if (isExpired(event.createdAt)) {
    return json({ error: "This event expired and was auto-deleted." }, { status: 410 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const now = new Date().toISOString();
  const url = new URL(request.url);

  const presentedAdmin =
    (formData.get("adminToken") as string) || getPresentedAdminToken(request, eventId);
  const requireAdmin = async () => {
    if (!presentedAdmin) return false;
    const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
    if (!checkAdminRateLimit(`action:${clientIp}:${eventId}`)) return false;
    return secretMatches(presentedAdmin, event.adminToken);
  };

  // 1. Sign-Up Slot Claim (transactional capacity guard)
  if (intent === "signup") {
    const slotId = cleanText(formData.get("slotId"), 32);
    const participantName = cleanText(formData.get("participantName"), PARTICIPANT_NAME_MAX);
    const rawEmail = cleanText(formData.get("participantEmail"), EMAIL_MAX);
    const participantEmail = rawEmail || null;
    const comment = cleanText(formData.get("comment"), COMMENT_MAX);

    if (!slotId || !participantName) {
      return json({ error: "Name is required to sign up." }, { status: 400 });
    }
    if (participantEmail && !isValidEmail(participantEmail)) {
      return json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Bot protection before any DB work.
    const turnstileSignup = await verifyTurnstile({
      token: formData.get("cf-turnstile-response") as string | null,
      expectedAction: "event-signup",
      env,
      remoteIp: request.headers.get("cf-connecting-ip"),
    });
    if (!turnstileSignup.ok) {
      const f = turnstileFailure();
      return json(f.body, { status: f.status });
    }

    const [targetSlot] = await db.select().from(eventSlots).where(eq(eventSlots.id, slotId)).limit(1);
    if (!targetSlot || targetSlot.eventId !== eventId) {
      return json({ error: "Slot not found." }, { status: 404 });
    }

    const signupId = generateInternalId();
    const editTokenPlain = generateSecretToken();
    const editTokenStored = await hashSecretForStorage(editTokenPlain);

    const safeName = participantName.slice(0, PARTICIPANT_NAME_MAX);
    const safeEmail = participantEmail?.slice(0, EMAIL_MAX) || null;
    const customFields = JSON.stringify({ comment });

    // D1 does not allow raw BEGIN/COMMIT via SQL (drizzle's .transaction()
    // throws D1_ERROR under Durable-Object-backed D1, incl. local dev), so
    // the capacity guard must be a single atomic statement instead of a
    // check-then-insert transaction. INSERT...SELECT...WHERE fails atomically
    // (0 rows written) when the slot is already full.
    if (targetSlot.capacity > 0) {
      const res = await env.DB.prepare(
        `INSERT INTO signups (id, slot_id, event_id, participant_name, participant_email, edit_token, custom_fields, status, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'CONFIRMED', ?8
         WHERE (SELECT COUNT(*) FROM signups WHERE slot_id = ?2 AND status = 'CONFIRMED') < ?9
         AND EXISTS (SELECT 1 FROM event_slots WHERE id = ?2 AND event_id = ?3)`
      )
        .bind(
          signupId,
          slotId,
          eventId,
          safeName,
          safeEmail,
          editTokenStored,
          customFields,
          now,
          targetSlot.capacity
        )
        .run();
      if ((res.meta?.changes ?? 0) === 0) {
        // Distinguish "slot filled" from "slot deleted concurrently".
        const [stillThere] = await db
          .select({ id: eventSlots.id })
          .from(eventSlots)
          .where(eq(eventSlots.id, slotId))
          .limit(1);
        if (!stillThere) {
          return json({ error: "Slot not found." }, { status: 404 });
        }
        return json({ error: "Sorry, this slot just filled up!" }, { status: 400 });
      }
    } else {
      // Unlimited capacity (capacity <= 0): plain insert, no guard needed.
      await db.insert(signups).values({
        id: signupId,
        slotId,
        eventId,
        participantName: safeName,
        participantEmail: safeEmail,
        editToken: editTokenStored,
        customFields,
        status: "CONFIRMED",
        createdAt: now,
      });
    }

    // Send confirmation email to participant if email provided
    if (participantEmail) {
      const cancelUrl = `${url.origin}/events/${eventId}?cancel_token=${encodeURIComponent(editTokenPlain)}`;
      const shiftPrefix = ((targetSlot as { shiftName?: string | null }).shiftName || "").trim();
      const taskLabel = shiftPrefix ? `${shiftPrefix} – ${targetSlot.title}` : targetSlot.title;
      const googleCalendarUrl = buildGoogleCalendarUrl({
        title: `${taskLabel} — ${event.title}`,
        description: event.description,
        location: event.location,
        eventDate: event.eventDate,
        startTime: targetSlot.startTime,
        endTime: targetSlot.endTime,
        url: `${url.origin}/events/${eventId}`,
      });
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.FROM_EMAIL,
        to: participantEmail,
        subject: `Confirmed: "${taskLabel}" for ${event.title}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
            <h2 style="color: #0f172a; margin-top: 0;">You're signed up!</h2>
            <p>Hi ${escapeHtml(participantName)},</p>
            <p>You have secured your spot for <strong>${escapeHtml(taskLabel)}</strong> at <strong>${escapeHtml(event.title)}</strong>.</p>
            ${event.location ? `<p><strong>Location:</strong> ${escapeHtml(event.location)}</p>` : ""}
            <p>
              <a href="${escapeHtml(googleCalendarUrl)}" style="color: #2563eb;">Add to Google Calendar</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(url.origin)}/events/${escapeHtml(eventId)}/ics" style="color: #2563eb;">Download .ics (Apple/Outlook)</a>
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin: 24px 0;">
              <p style="margin: 0 0 10px 0; font-size: 13px;"><strong>Need to cancel?</strong></p>
              <a href="${escapeHtml(cancelUrl)}" style="color: #dc2626; font-size: 13px;">Cancel this sign-up</a>
            </div>
            <p style="margin-top: 24px; font-weight: 600;">— ManyMano</p>
          </div>
        `,
      });
    }

    return json({ success: true, message: `Thank you ${participantName}! Your spot has been confirmed.` });
  }

  // 2. Cancel Signup (admin, or owner via emailed edit token)
  if (intent === "cancel_signup") {
    const signupId = formData.get("signupId") as string;
    const editToken = (formData.get("editToken") as string) || null;

    const [existing] = await db.select().from(signups).where(eq(signups.id, signupId)).limit(1);
    if (!existing || existing.eventId !== eventId) {
      return json({ error: "Signup entry not found." }, { status: 404 });
    }

    const adminOk = await requireAdmin();
    const ownerOk = editToken ? await secretMatches(editToken, existing.editToken) : false;

    if (!adminOk && !ownerOk) {
      return json({ error: "Unauthorized to cancel this signup." }, { status: 403 });
    }

    await db.delete(signups).where(eq(signups.id, signupId));
    return json({ success: true, message: "Signup cancelled." });
  }

  // 3. Meeting Poll Vote
  if (intent === "vote_poll") {
    const participantName = cleanText(formData.get("participantName"), PARTICIPANT_NAME_MAX);
    const rawVoteEmail = cleanText(formData.get("participantEmail"), EMAIL_MAX);
    const participantEmail = rawVoteEmail || null;

    if (!participantName) {
      return json({ error: "Your name is required to vote." }, { status: 400 });
    }
    if (participantEmail && !isValidEmail(participantEmail)) {
      return json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Bot protection before any DB writes.
    const turnstileVote = await verifyTurnstile({
      token: formData.get("cf-turnstile-response") as string | null,
      expectedAction: "poll-vote",
      env,
      remoteIp: request.headers.get("cf-connecting-ip"),
    });
    if (!turnstileVote.ok) {
      const f = turnstileFailure();
      return json(f.body, { status: f.status });
    }

    const voteId = generateInternalId();
    const editTokenPlain = generateSecretToken();

    await db.insert(pollVotes).values({
      id: voteId,
      eventId,
      participantName,
      participantEmail,
      editToken: await hashSecretForStorage(editTokenPlain),
      createdAt: now,
      updatedAt: now,
    });

    const slots = await db.select().from(eventSlots).where(eq(eventSlots.eventId, eventId));
    for (const s of slots) {
      const resp = (formData.get(`slot_${s.id}`) as string) || "NO";
      if (resp === "YES" || resp === "MAYBE") {
        await db.insert(pollVoteEntries).values({
          id: generateInternalId(),
          pollVoteId: voteId,
          slotId: s.id,
          response: resp,
        });
      }
    }

    if (participantEmail) {
      const manageUrl = `${url.origin}/events/${eventId}?cancel_token=${encodeURIComponent(editTokenPlain)}`;
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.FROM_EMAIL,
        to: participantEmail,
        subject: `Your vote for "${event.title}" is recorded`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
            <p>Hi ${escapeHtml(participantName)},</p>
            <p>Your availability for <strong>${escapeHtml(event.title)}</strong> is recorded.</p>
            <p><a href="${escapeHtml(manageUrl)}" style="color: #dc2626;">Remove my vote</a></p>
          </div>
        `,
      });
    }

    return json({ success: true, message: `Availability recorded for ${participantName}!` });
  }

  // 3b. Delete poll vote (admin, or owner via emailed edit token)
  if (intent === "delete_poll_vote") {
    const voteId = formData.get("voteId") as string;
    const editToken = (formData.get("editToken") as string) || null;
    const [existing] = await db.select().from(pollVotes).where(eq(pollVotes.id, voteId)).limit(1);
    if (!existing || existing.eventId !== eventId) {
      return json({ error: "Vote not found." }, { status: 404 });
    }
    const adminOk = await requireAdmin();
    const ownerOk = editToken ? await secretMatches(editToken, existing.editToken) : false;
    if (!adminOk && !ownerOk) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }
    await db.delete(pollVoteEntries).where(eq(pollVoteEntries.pollVoteId, voteId));
    await db.delete(pollVotes).where(eq(pollVotes.id, voteId));
    return json({ success: true, message: "Vote removed." });
  }

  // 4. Finalize Poll
  if (intent === "finalize_poll") {
    if (!(await requireAdmin())) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }
    const winningSlotId = cleanText(formData.get("winningSlotId"), 32);
    if (!winningSlotId) {
      return json({ error: "Please choose a winning option." }, { status: 400 });
    }
    // Validate the winning slot belongs to this event (no arbitrary IDs).
    const [winningSlot] = await db
      .select({ id: eventSlots.id, eventId: eventSlots.eventId })
      .from(eventSlots)
      .where(eq(eventSlots.id, winningSlotId))
      .limit(1);
    if (!winningSlot || winningSlot.eventId !== eventId) {
      return json({ error: "Winning option not found for this event." }, { status: 400 });
    }

    await db
      .update(events)
      .set({
        status: "FINALIZED",
        winningSlotId,
        updatedAt: now,
      })
      .where(eq(events.id, eventId));

    return json({ success: true, message: "Meeting has been officially locked and finalized!" });
  }

  // 5. Update Event Details (admin only)
  if (intent === "update_event") {
    if (!(await requireAdmin())) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }

    const title = cleanText(formData.get("title"), TITLE_MAX);
    const description = cleanText(formData.get("description"), DESCRIPTION_MAX) || null;
    const eventDate = cleanText(formData.get("eventDate"), 32) || null;
    const location = cleanText(formData.get("location"), LOCATION_MAX) || null;
    const organizerName = cleanText(formData.get("organizerName"), ORGANIZER_NAME_MAX);

    if (!title) {
      return json({ error: "Event title is required." }, { status: 400 });
    }
    if (!organizerName) {
      return json({ error: "Organizer name is required." }, { status: 400 });
    }

    await db
      .update(events)
      .set({ title, description, eventDate, location, organizerName, updatedAt: now })
      .where(eq(events.id, eventId));

    return json({ success: true, message: "Event details updated." });
  }

  // 6. Add Slot (admin only)
  if (intent === "add_slot") {
    if (!(await requireAdmin())) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }

    const title = cleanText(formData.get("slotTitle"), SLOT_TITLE_MAX);
    const shiftName = cleanText(formData.get("slotShiftName"), SHIFT_NAME_MAX) || null;
    const slotDateRaw = cleanText(formData.get("slotDate"), 10);
    const slotDate = /^\d{4}-\d{2}-\d{2}$/.test(slotDateRaw) ? slotDateRaw : null;
    const startTime = cleanText(formData.get("slotStartTime"), 16) || null;
    const endTime = cleanText(formData.get("slotEndTime"), 16) || null;
    const capacityRaw = cleanText(formData.get("slotCapacity"), 8) || "1";
    if (!title && !startTime && !shiftName && !slotDate) {
      return json({ error: "Give the new option a title, day or time." }, { status: 400 });
    }

    const existingSlots = await db.select().from(eventSlots).where(eq(eventSlots.eventId, eventId));
    if (existingSlots.length >= MAX_SLOTS_PER_EVENT) {
      return json(
        { error: `Too many options — maximum ${MAX_SLOTS_PER_EVENT} per event.` },
        { status: 400 }
      );
    }
    const maxOrder = existingSlots.reduce((m, s) => Math.max(m, s.displayOrder ?? 0), -1);
    const rawCap = parseInt(capacityRaw, 10);
    const capacity =
      event.type === "SIGNUP_SHEET"
        ? Number.isFinite(rawCap)
          ? Math.min(Math.max(rawCap, 1), 999)
          : 1
        : 999;

    await db.insert(eventSlots).values({
      id: generateInternalId(),
      eventId,
      title: (title || shiftName || (endTime ? `${startTime} – ${endTime}` : (startTime as string)) || slotDate || "New option").slice(0, SLOT_TITLE_MAX),
      shiftName,
      slotDate,
      capacity,
      startTime,
      endTime,
      displayOrder: maxOrder + 1,
    });

    return json({ success: true, message: "New option added." });
  }

  // 7. Update Slot (admin only)
  if (intent === "update_slot") {
    if (!(await requireAdmin())) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }

    const slotId = cleanText(formData.get("slotId"), 32);
    const title = cleanText(formData.get("slotTitle"), SLOT_TITLE_MAX);
    const shiftName = cleanText(formData.get("slotShiftName"), SHIFT_NAME_MAX) || null;
    const slotDateRaw = cleanText(formData.get("slotDate"), 10);
    const slotDate = slotDateRaw === "" ? null : (/^\d{4}-\d{2}-\d{2}$/.test(slotDateRaw) ? slotDateRaw : null);
    const startTime = cleanText(formData.get("slotStartTime"), 16) || null;
    const endTime = cleanText(formData.get("slotEndTime"), 16) || null;
    const capacityRaw = cleanText(formData.get("slotCapacity"), 8);

    const [target] = await db.select().from(eventSlots).where(eq(eventSlots.id, slotId)).limit(1);
    if (!target || target.eventId !== eventId) {
      return json({ error: "Slot not found." }, { status: 404 });
    }
    if (!title) {
      return json({ error: "Slot title is required." }, { status: 400 });
    }
    const parsedCap = capacityRaw ? parseInt(capacityRaw, 10) : NaN;

    await db
      .update(eventSlots)
      .set({
        title,
        shiftName,
        slotDate,
        startTime,
        endTime,
        ...(event.type === "SIGNUP_SHEET" && capacityRaw
          ? {
              capacity: Number.isFinite(parsedCap)
                ? Math.min(Math.max(parsedCap, 1), 999)
                : target.capacity,
            }
          : {}),
      })
      .where(eq(eventSlots.id, slotId));

    return json({ success: true, message: "Option updated." });
  }

  // 8. Delete Slot (admin only, cascades signups/votes for that slot)
  if (intent === "delete_slot") {
    if (!(await requireAdmin())) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }

    const slotId = formData.get("slotId") as string;
    const [target] = await db.select().from(eventSlots).where(eq(eventSlots.id, slotId)).limit(1);
    if (!target || target.eventId !== eventId) {
      return json({ error: "Slot not found." }, { status: 404 });
    }

    // Remove dependent rows first (D1/cascade safety)
    await db.delete(signups).where(eq(signups.slotId, slotId));
    await db.delete(pollVoteEntries).where(eq(pollVoteEntries.slotId, slotId));
    await db.delete(eventSlots).where(eq(eventSlots.id, slotId));

    if (event.winningSlotId === slotId) {
      await db
        .update(events)
        .set({ winningSlotId: null, status: "OPEN", updatedAt: now })
        .where(eq(events.id, eventId));
    }

    return json({ success: true, message: "Option deleted." });
  }

  // 9. Delete entire event (admin only).
  if (intent === "delete_event") {
    if (!(await requireAdmin())) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }
    const slots = await db.select({ id: eventSlots.id }).from(eventSlots).where(eq(eventSlots.eventId, eventId));
    const slotIds = slots.map((s) => s.id);
    if (slotIds.length > 0) {
      await db.delete(signups).where(inArray(signups.slotId, slotIds));
      await db.delete(pollVoteEntries).where(inArray(pollVoteEntries.slotId, slotIds));
    }
    const votes = await db.select({ id: pollVotes.id }).from(pollVotes).where(eq(pollVotes.eventId, eventId));
    if (votes.length > 0) {
      await db.delete(pollVoteEntries).where(inArray(pollVoteEntries.pollVoteId, votes.map((v) => v.id)));
    }
    await db.delete(signups).where(eq(signups.eventId, eventId));
    await db.delete(pollVotes).where(eq(pollVotes.eventId, eventId));
    await db.delete(eventSlots).where(eq(eventSlots.eventId, eventId));
    await db.delete(events).where(eq(events.id, eventId));
    const headers = new Headers();
    headers.append("Set-Cookie", buildExpiredAdminCookie(eventId));
    return redirect("/?deleted=1", { headers });
  }

  // 10. Self-serve cancellation via emailed token (POST only — see loader).
  if (intent === "cancel_by_token") {
    const cancelToken = cleanText(formData.get("cancel_token"), 64);
    if (!cancelToken) {
      return json({ error: "Missing cancellation token." }, { status: 400 });
    }
    const candidates = await db.select().from(signups).where(eq(signups.eventId, eventId));
    for (const s of candidates) {
      if (await secretMatches(cancelToken, s.editToken)) {
        await db.delete(signups).where(eq(signups.id, s.id));
        return redirect(`/events/${eventId}?cancelled=1`);
      }
    }
    const voteCandidates = await db.select().from(pollVotes).where(eq(pollVotes.eventId, eventId));
    for (const v of voteCandidates) {
      if (await secretMatches(cancelToken, v.editToken)) {
        await db.delete(pollVoteEntries).where(eq(pollVoteEntries.pollVoteId, v.id));
        await db.delete(pollVotes).where(eq(pollVotes.id, v.id));
        return redirect(`/events/${eventId}?cancelled=1`);
      }
    }
    return redirect(`/events/${eventId}?cancel_error=1`);
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

export default function EventView() {
  const { event, slots, signups: initialSignups, isAdmin, adminToken, pollData, pendingCancel, turnstileSiteKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; message?: string; error?: string }>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const cancelTokenParam = searchParams.get("cancel_token");

  const justCreated = Boolean(searchParams.get("created"));
  const justCancelled = Boolean(searchParams.get("cancelled"));
  const cancelError = Boolean(searchParams.get("cancel_error"));
  const [selectedSlotForSignup, setSelectedSlotForSignup] = useState<{ id: string; title: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  // Active poll vote states for interactive row: Record<slotId, 'NO' | 'YES' | 'MAYBE'>
  const [userVotes, setUserVotes] = useState<Record<string, "NO" | "YES" | "MAYBE">>({});
  const [voterName, setVoterName] = useState("");
  const [voterEmail, setVoterEmail] = useState("");
  const [showAllVotesMobile, setShowAllVotesMobile] = useState(false);

  const cycleSlotVote = (slotId: string) => {
    const current = userVotes[slotId] || "NO";
    const nextMap: Record<string, "NO" | "YES" | "MAYBE"> = {
      NO: "YES",
      YES: "MAYBE",
      MAYBE: "NO",
    };
    setUserVotes((prev) => ({
      ...prev,
      [slotId]: nextMap[current],
    }));
  };

  const setSlotVote = (slotId: string, value: "NO" | "YES" | "MAYBE") => {
    setUserVotes((prev) => ({ ...prev, [slotId]: value }));
  };

  const setAllVotes = (value: "NO" | "YES" | "MAYBE") => {
    setUserVotes(() => {
      const next: Record<string, "NO" | "YES" | "MAYBE"> = {};
      slots.forEach((s) => {
        next[s.id] = value;
      });
      return next;
    });
  };

  const yesCount = useMemo(
    () => Object.values(userVotes).filter((v) => v === "YES").length,
    [userVotes]
  );
  const maybeCount = useMemo(
    () => Object.values(userVotes).filter((v) => v === "MAYBE").length,
    [userVotes]
  );

  const copyToClipboard = async (text: string, label: string) => {
    const markCopied = () => {
      setCopiedLink(label);
      setTimeout(() => setCopiedLink(null), 2500);
    };
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        markCopied();
        return;
      }
      throw new Error("clipboard-api-unavailable");
    } catch (_) {
      // Fallback for non-secure contexts / denied permissions
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        markCopied();
      } catch (__: unknown) {
        window.prompt("Copy this link:", text);
      }
    }
  };

  // Identify top poll option
  const topSlot = useMemo(() => {
    if (!pollData || slots.length === 0) return null;
    let bestSlot = slots[0];
    let maxScore = -1;

    slots.forEach((s) => {
      const t = pollData.tallies[s.id] || { yes: 0, maybe: 0 };
      const score = t.yes * 2 + t.maybe;
      if (score > maxScore) {
        maxScore = score;
        bestSlot = s;
      }
    });

    const bestTally = pollData.tallies[bestSlot.id] || { yes: 0, maybe: 0 };
    return { slot: bestSlot, tally: bestTally };
  }, [pollData, slots]);

  // Day groups for the calendar-grid vote table: consecutive columns that
  // share a slotDate render under one day header. Slots arrive sorted by
  // (slotDate, startTime) from the loader.
  type PollSlotRow = (typeof slots)[number];
  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; slots: PollSlotRow[] }> = [];
    const indexByKey = new Map<string, number>();
    slots.forEach((s) => {
      const raw = ((s as { slotDate?: string | null }).slotDate || "").trim();
      const key = raw || "__undated__";
      const label = raw ? formatSlotDateLabel(raw) : "Undated";
      const existing = indexByKey.get(key);
      if (existing !== undefined) {
        groups[existing].slots.push(s);
      } else {
        indexByKey.set(key, groups.length);
        groups.push({ key, label, slots: [s] });
      }
    });
    return groups;
  }, [slots]);

  const pollDateRange = useMemo(() => {
    if (event.type !== "TIME_POLL" || dayGroups.length === 0) return null;
    const dated = dayGroups.filter((g) => g.key !== "__undated__");
    if (dated.length === 0) return null;
    if (dated.length === 1) return dated[0].label;
    return `${dated[0].label} – ${dated[dated.length - 1].label}`;
  }, [event.type, dayGroups]);

  // slotId -> day label for mobile cards
  const slotDayLabel = useMemo(() => {
    const map: Record<string, string> = {};
    dayGroups.forEach((g) => {
      g.slots.forEach((s) => {
        map[s.id] = g.label;
      });
    });
    return map;
  }, [dayGroups]);
  // Group signup slots into shifts sharing name + time window.
  // Each slot is one task; a shift card lists its tasks.
  type SlotRow = (typeof slots)[number];
  const shiftGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      shiftName: string | null;
      startTime: string | null;
      endTime: string | null;
      tasks: SlotRow[];
    }> = [];
    const indexByKey = new Map<string, number>();
    slots.forEach((s) => {
      const shiftName = ((s as { shiftName?: string | null }).shiftName || "").trim();
      const key = `${shiftName}||${s.startTime || ""}||${s.endTime || ""}`;
      const existing = indexByKey.get(key);
      if (existing !== undefined) {
        groups[existing].tasks.push(s);
      } else {
        indexByKey.set(key, groups.length);
        groups.push({
          key,
          shiftName: shiftName || null,
          startTime: s.startTime,
          endTime: s.endTime,
          tasks: [s],
        });
      }
    });
    return groups;
  }, [slots]);

  // Calendar: winning slot first, else earliest timed slot. Times combine with
  // event.eventDate inside the calendar utils. The Google link is a one-click
  // template (no file download); the .ics download covers Apple/Outlook.
  const calendarSlot = useMemo(
    () => pickCalendarSlot(slots, event.winningSlotId),
    [slots, event.winningSlotId]
  );
  const icsHref =
    isAdmin && adminToken
      ? `/events/${event.id}/ics?admin=${encodeURIComponent(adminToken)}`
      : `/events/${event.id}/ics`;
  const googleCalendarHref = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return buildGoogleCalendarUrl({
      title: event.title,
      description: event.description,
      location: event.location,
      eventDate: calendarSlot ? effectiveDateForSlot(calendarSlot, event.eventDate) : event.eventDate,
      startTime: calendarSlot?.startTime ?? null,
      endTime: calendarSlot?.endTime ?? null,
      url: origin ? `${origin}/events/${event.id}` : null,
    });
  }, [event.title, event.description, event.location, event.eventDate, event.id, calendarSlot]);

  return (
    <div className="space-y-10 py-2">
      {/* Event Created Banner with 1-Click Copy Links */}
      {justCreated && isAdmin && (
        <div className="bg-white border-2 border-green-500/80 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
              <PartyPopper className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Your event is live!</h2>
              <p className="text-xs text-slate-500">
                Share the public link with attendees and bookmark your secret admin link.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-700 block">1. Public Link to Share with Attendees</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/events/${event.id}`}
                  className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono text-slate-600 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      `${typeof window !== "undefined" ? window.location.origin : ""}/events/${event.id}`,
                      "public"
                    )
                  }
                  className="px-3.5 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shrink-0 transition-colors shadow-sm inline-flex items-center gap-1.5"
                >
                  {copiedLink === "public" ? (
                    <>
                      Copied! <Check className="w-3.5 h-3.5" />
                    </>
                  ) : (
                    "Copy"
                  )}
                </button>
              </div>
            </div>

            <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200/70 space-y-2">
              <span className="text-xs font-bold text-amber-900 block">2. Secret Admin Link (Keep Private!)</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={typeof window !== "undefined" ? window.location.href : ""}
                  className="w-full bg-white px-3 py-2 rounded-xl border border-amber-200 text-xs font-mono text-amber-800 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(typeof window !== "undefined" ? window.location.href : "", "admin")
                  }
                  className="px-3.5 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shrink-0 transition-colors shadow-sm inline-flex items-center gap-1.5"
                >
                  {copiedLink === "admin" ? (
                    <>
                      Copied! <Check className="w-3.5 h-3.5" />
                    </>
                  ) : (
                    "Copy"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Notification */}
      {justCancelled && (
        <div className="p-4 rounded-2xl bg-green-50 border border-green-200/80 text-green-800 text-sm font-semibold flex items-center gap-2.5 animate-fade-in">
          <CircleCheck className="w-4 h-4 shrink-0" />
          <span>Your entry was removed.</span>
        </div>
      )}
      {cancelError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-sm font-semibold flex items-center gap-2.5 animate-fade-in">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span>That cancel link was invalid or already used.</span>
        </div>
      )}
      {pendingCancel && cancelTokenParam && (
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-900 text-sm animate-fade-in">
          <p className="font-semibold">
            Confirm cancellation for {pendingCancel.name}?
          </p>
          <p className="text-xs text-amber-700/90 mt-1">
            This will remove the {pendingCancel.kind === "signup" ? "sign-up" : "vote"}. This
            cannot be undone.
          </p>
          <Form method="post" className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="intent" value="cancel_by_token" />
            <input type="hidden" name="cancel_token" value={cancelTokenParam} />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? "Removing…" : "Yes, remove my entry"}
            </button>
            <a
              href={`/events/${event.id}`}
              className="px-4 py-2 rounded-xl border border-amber-300 bg-white hover:bg-amber-100/50 text-amber-900 text-xs font-bold"
            >
              Keep my entry
            </a>
          </Form>
        </div>
      )}
      {actionData?.message && (
        <div className="p-4 rounded-2xl bg-green-50 border border-green-200/80 text-green-800 text-sm font-semibold flex items-center gap-2.5 animate-fade-in">
          <CircleCheck className="w-4 h-4 shrink-0" />
          <span>{actionData.message}</span>
        </div>
      )}
      {actionData?.error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-sm font-semibold flex items-center gap-2.5 animate-fade-in">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span>{actionData.error}</span>
        </div>
      )}

      {/* Event Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-5">
        <div className="space-y-3 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
              {event.type === "SIGNUP_SHEET" ? "Sign-Up Sheet" : "Meeting Availability Poll"}
            </span>
            <span
              className={`text-[11px] px-3 py-1 rounded-full font-semibold border inline-flex items-center gap-1.5 ${
                event.status === "FINALIZED"
                  ? "bg-purple-50 text-purple-700 border-purple-200"
                  : "bg-green-50 text-green-700 border-green-200"
              }`}
            >
              {event.status === "FINALIZED" ? (
                <>
                  Meeting Finalized <Target className="w-3 h-3" />
                </>
              ) : (
                "Open for Responses"
              )}
            </span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl sm:text-[32px] sm:leading-[1.15] font-extrabold text-slate-900 tracking-tight min-w-0 flex-1">
              {event.title}
            </h1>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowEdit((v) => !v)}
                className="shrink-0 mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-all shadow-sm"
              >
                <Pencil className="w-3.5 h-3.5" />
                {showEdit ? "Close editor" : "Edit event"}
              </button>
            )}
          </div>

          {event.description && (
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed whitespace-pre-wrap font-normal">
              {event.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {event.eventDate && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100/90 px-3 py-1.5 rounded-full border border-slate-200/80">
                <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
                {new Date(event.eventDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
            {event.location && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100/90 px-3 py-1.5 rounded-full border border-slate-200/80">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                {event.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-100/90 px-3 py-1.5 rounded-full border border-slate-200/80">
              <User className="w-3.5 h-3.5 text-slate-500" />
              Organized by:&nbsp;<strong className="text-slate-800 font-semibold">{event.organizerName}</strong>
            </span>
            {event.type === "TIME_POLL" && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100/90 px-3 py-1.5 rounded-full border border-slate-200/80">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                {formatDurationLabel((event as { durationMinutes?: number | null }).durationMinutes)}
              </span>
            )}
            {event.type === "TIME_POLL" && pollDateRange && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100/90 px-3 py-1.5 rounded-full border border-slate-200/80">
                <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
                {pollDateRange} · {slots.length} option{slots.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 pt-0.5">
            Anyone with the link can see names/notes. Organizer can delete anytime below.
          </p>
        </div>

        {/* Quick Action Buttons — 2-column grid to avoid sidebar blank space */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() =>
              copyToClipboard(
                `${typeof window !== "undefined" ? window.location.origin : ""}/events/${event.id}`,
                "share"
              )
            }
            className="w-full h-11 px-4 text-sm font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Link2 className="w-4 h-4" />
            <span className="inline-flex items-center gap-1">
              {copiedLink === "share" ? (
                <>
                  Link Copied! <Check className="w-4 h-4" />
                </>
              ) : (
                "Share Link"
              )}
            </span>
          </button>

          <a
            href={googleCalendarHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-11 px-4 text-[13px] font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <CalendarPlus className="w-4 h-4 text-slate-500" />
            <span>Add to Google Calendar</span>
          </a>

          <a
            href={icsHref}
            download
            className="w-full h-11 px-4 text-[13px] font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Apple / Outlook (.ics)</span>
          </a>

          {isAdmin ? (
            <a
              href={adminToken ? `/events/${event.id}/export?admin=${encodeURIComponent(adminToken)}` : `/events/${event.id}/export`}
              download
              className="w-full h-11 px-4 text-[13px] font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition-all shadow-sm flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Export CSV Roster</span>
            </a>
          ) : null}
        </div>

        {/* Admin Bar */}
        {isAdmin && (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <p className="text-xs leading-relaxed text-amber-900">
              <span className="font-bold">Organizer Admin Mode Active</span>
              <span className="mx-2 text-amber-300">•</span>
              <span className="font-normal text-amber-700/90">
                You are viewing with your private admin token. You can edit details, manage options, cancel entries and finalize.
              </span>
            </p>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* ADMIN EDIT PANEL                                                      */}
      {/* ===================================================================== */}
      {isAdmin && showEdit && (
        <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-8 animate-fade-in">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight inline-flex items-center gap-2"><Pencil className="w-4 h-4" /> Edit Event</h2>
            <button
              type="button"
              onClick={() => setShowEdit(false)}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-2xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white text-slate-600 transition-all shadow-sm inline-flex items-center gap-1"
            >
              Close <X className="w-3 h-3" />
            </button>
          </div>

          {/* Edit details form */}
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="update_event" />
            <input type="hidden" name="adminToken" value={adminToken || ""} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Event Title *</label>
                <input
                  type="text"
                  name="title"
                  required
                  defaultValue={event.title}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Date</label>
                <DatePicker
                  name="eventDate"
                  defaultValue={event.eventDate || ""}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Location</label>
                <input
                  type="text"
                  name="location"
                  defaultValue={event.location || ""}
                  placeholder="e.g. Central Park, Zoom link…"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={event.description || ""}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 leading-relaxed"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Organizer Name *</label>
                <input
                  type="text"
                  name="organizerName"
                  required
                  defaultValue={event.organizerName}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {isSubmitting ? "Saving…" : "Save Details"}
            </button>
          </Form>

          {/* Manage options / slots */}
          <div className="space-y-4 pt-6 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              {event.type === "SIGNUP_SHEET" ? "Manage Shifts / Tasks" : "Manage Time Options"}
            </h3>
            <div className="space-y-3.5">
              {slots.map((s) => (
                <Form
                  key={s.id}
                  method="post"
                  className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-end bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 transition-all"
                >
                  <input type="hidden" name="intent" value="update_slot" />
                  <input type="hidden" name="adminToken" value={adminToken || ""} />
                  <input type="hidden" name="slotId" value={s.id} />
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
                    {event.type === "SIGNUP_SHEET" && (
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Shift (opt.)</label>
                        <input
                          type="text"
                          name="slotShiftName"
                          defaultValue={(s as { shiftName?: string | null }).shiftName || ""}
                          placeholder="e.g. Morning"
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                        />
                      </div>
                    )}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">{event.type === "SIGNUP_SHEET" ? "Task *" : "Title *"}</label>
                      <input
                        type="text"
                        name="slotTitle"
                        required
                        defaultValue={s.title}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      />
                    </div>
                    {event.type === "TIME_POLL" && (
                      <div className="lg:col-span-2">
                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Day</label>
                        <DatePicker
                          name="slotDate"
                          defaultValue={(s as { slotDate?: string | null }).slotDate || ""}
                        />
                      </div>
                    )}
                    <div className="lg:col-span-2">
                      <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Start</label>
                      <input
                        type="text"
                        name="slotStartTime"
                        defaultValue={s.startTime || ""}
                        placeholder="9:00 AM"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">End</label>
                      <input
                        type="text"
                        name="slotEndTime"
                        defaultValue={s.endTime || ""}
                        placeholder="11:00 AM"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                      />
                    </div>
                    {event.type === "SIGNUP_SHEET" && (
                      <div className="lg:col-span-2">
                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Capacity</label>
                        <input
                          type="number"
                          name="slotCapacity"
                          min={1}
                          defaultValue={s.capacity}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-4 py-2 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="submit"
                      name="intent"
                      value="delete_slot"
                      formMethod="post"
                      onClick={(e) => {
                        if (!window.confirm(`Delete "${s.title}"? Existing signups/votes for it will be removed.`)) {
                          e.preventDefault();
                        }
                      }}
                      className="px-4 py-2 rounded-2xl bg-white border border-rose-200 hover:border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-semibold shadow-sm transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </Form>
              ))}
            </div>

            {/* Add new slot */}
            <Form
              method="post"
              className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-end bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 transition-all"
            >
              <input type="hidden" name="intent" value="add_slot" />
              <input type="hidden" name="adminToken" value={adminToken || ""} />
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
                {event.type === "SIGNUP_SHEET" && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Shift (opt.)</label>
                    <input
                      type="text"
                      name="slotShiftName"
                      placeholder="e.g. Morning"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                    />
                  </div>
                )}
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">{event.type === "SIGNUP_SHEET" ? "New task" : "New option title"}</label>
                  <input
                    type="text"
                    name="slotTitle"
                    placeholder={event.type === "SIGNUP_SHEET" ? "e.g. Setup crew" : "e.g. Mon 10am – 11am"}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Start (opt.)</label>
                  <input
                    type="text"
                    name="slotStartTime"
                    placeholder="9:00 AM"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">End (opt.)</label>
                  <input
                    type="text"
                    name="slotEndTime"
                    placeholder="11:00 AM"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                  />
                </div>
                {event.type === "TIME_POLL" && (
                  <div className="lg:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Day</label>
                    <DatePicker
                      name="slotDate"
                    />
                  </div>
                )}
                {event.type === "SIGNUP_SHEET" && (
                  <div className="lg:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Capacity</label>
                    <input
                      type="number"
                      name="slotCapacity"
                      min={1}
                      defaultValue={1}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] shrink-0 disabled:opacity-50"
              >
                + Add Option
              </button>
            </Form>
            <p className="text-[11px] text-slate-500">
              Deleting a task also removes its signups / votes. If it was the finalized winning time, the event reopens.
            </p>
            <div className="pt-6 border-t border-rose-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                <span className="font-bold text-slate-700 block">Delete this event</span>
                <span>Removes the event, signups/votes and roster immediately. Cannot be undone.</span>
              </div>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!window.confirm("Delete this entire event and all signups/votes?")) e.preventDefault();
                }}
              >
                <input type="hidden" name="intent" value="delete_event" />
                <input type="hidden" name="adminToken" value={adminToken || ""} />
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-2xl bg-white border border-rose-200 hover:border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-bold shadow-sm transition-all"
                >
                  Delete event
                </button>
              </Form>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SECTION 1: SIGNUP SHEET VIEW                                */}
      {/* ===================================================================== */}
      {event.type === "SIGNUP_SHEET" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Available Shifts & Tasks</h2>
            <span className="text-xs font-medium text-slate-500">
              {initialSignups.length} confirmed {initialSignups.length === 1 ? "signup" : "signups"}
            </span>
          </div>

          <div className="space-y-5">
            {shiftGroups.map((group) => {
              const renderTask = (slot: SlotRow) => {
                const slotSignups = initialSignups.filter((s) => Boolean(s && s.slotId === slot.id));
                const isFull = slot.capacity > 0 && slotSignups.length >= slot.capacity;
                const spotsLeft = slot.capacity > 0 ? slot.capacity - slotSignups.length : 999;
                const fillPercent =
                  slot.capacity > 0 ? Math.min(100, Math.round((slotSignups.length / slot.capacity) * 100)) : 0;
                const signupLabel = group.shiftName ? `${group.shiftName} – ${slot.title}` : slot.title;

                return (
                  <div
                    key={slot.id}
                    className="bg-[#fafafc] rounded-2xl p-4 sm:p-5 border border-slate-100 space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="space-y-2 max-w-xl">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h4 className="font-bold text-base text-slate-900">{slot.title}</h4>
                          {slot.capacity > 0 ? (
                            <span
                              className={`text-xs px-3 py-1 rounded-full font-semibold border ${
                                isFull
                                  ? "bg-slate-100 text-slate-500 border-slate-200"
                                  : spotsLeft <= 1
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-green-50 text-green-700 border-green-200"
                              }`}
                            >
                              {isFull ? "Filled" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
                            </span>
                          ) : (
                            <span className="text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                              Unlimited
                            </span>
                          )}
                        </div>

                        {/* Visual capacity progress bar */}
                        {slot.capacity > 0 && (
                          <div className="w-48 h-1.5 bg-slate-200/70 rounded-full overflow-hidden mt-2">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isFull ? "bg-slate-400" : "bg-blue-600"
                              }`}
                              style={{ width: `${fillPercent}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={isFull}
                        onClick={() => setSelectedSlotForSignup({ id: slot.id, title: signupLabel })}
                        className={`px-6 py-3 rounded-2xl text-xs font-bold transition-all shadow-sm shrink-0 inline-flex items-center gap-1.5 ${
                          isFull
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                            : "bg-blue-600 text-white hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98]"
                        }`}
                      >
                        {isFull ? (
                          "Full"
                        ) : (
                          <>
                            Sign Up <ArrowRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>

                    {/* Confirmed Roster Container */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Confirmed ({slotSignups.length} {slot.capacity > 0 ? `of ${slot.capacity}` : ""})
                      </div>

                      {slotSignups.length === 0 ? (
                        <div className="text-xs text-slate-400 italic py-1">
                          No one has signed up for this task yet. Claim the first spot!
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                          {slotSignups.map((s, idx) => {
                            if (!s) return null;
                            let customNotes = "";
                            try {
                              const parsed = JSON.parse(s.customFields);
                              customNotes = parsed.comment || "";
                            } catch (_) {}

                            return (
                              <div
                                key={s.id}
                                className="bg-white p-3 rounded-xl border border-slate-200/80 text-xs flex items-center justify-between shadow-sm"
                              >
                                <div className="truncate mr-2">
                                  <span className="font-semibold text-slate-800">
                                    {idx + 1}. {s.participantName}
                                  </span>
                                  {isAdmin && (s as { participantEmail?: string | null }).participantEmail && (
                                    <span className="block text-[11px] text-slate-500 truncate mt-0.5">
                                      {(s as { participantEmail?: string | null }).participantEmail}
                                    </span>
                                  )}
                                  {customNotes && (
                                    <span className="block text-[11px] text-slate-500 truncate mt-0.5">
                                      "{customNotes}"
                                    </span>
                                  )}
                                </div>

                                {isAdmin && (
                                  <Form method="post" className="shrink-0">
                                    <input type="hidden" name="intent" value="cancel_signup" />
                                    <input type="hidden" name="signupId" value={s.id} />
                                    <input type="hidden" name="adminToken" value={adminToken || ""} />
                                    <button
                                      type="submit"
                                      title="Cancel entry"
                                      className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </Form>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <div
                  key={group.key}
                  className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.05)] transition-all space-y-5"
                >
                  <div className="space-y-1.5">
                    {group.shiftName && (
                      <h3 className="font-bold text-lg text-slate-900">{group.shiftName}</h3>
                    )}
                    {(group.startTime || group.endTime) && (
                      <p className="text-xs text-slate-500 inline-flex items-center gap-1.5 font-semibold">
                        <Clock className="w-3.5 h-3.5" /> {group.startTime} {group.endTime ? `– ${group.endTime}` : ""}
                      </p>
                    )}
                    {!group.shiftName && !(group.startTime || group.endTime) && group.tasks.length === 1 && (
                      <h3 className="font-bold text-lg text-slate-900">{group.tasks[0].title}</h3>
                    )}
                  </div>

                  {group.shiftName || group.startTime || group.endTime || group.tasks.length > 1 ? (
                    <div className="space-y-4">{group.tasks.map(renderTask)}</div>
                  ) : (
                    renderTask(group.tasks[0])
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SECTION 2: MEETING TIME FINDER                                          */}
      {/* ===================================================================== */}
      {event.type === "TIME_POLL" && pollData && (
        <div className="space-y-6">
          {/* Top Consensus Winner Banner */}
          {topSlot && (
            <div className="bg-gradient-to-r from-blue-50/70 to-indigo-50/70 border border-blue-200/80 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-sm">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 uppercase tracking-wider">
                  <Star className="w-3.5 h-3.5" /> Consensus Leader
                </div>
                <div className="text-xl font-extrabold text-slate-900">{topSlot.slot.title}</div>
                {(topSlot.slot.startTime || topSlot.slot.endTime) && (
                  <div className="text-xs font-semibold text-blue-700 inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> {formatTime(topSlot.slot.startTime)}
                    {topSlot.slot.endTime ? ` – ${formatTime(topSlot.slot.endTime)}` : ""}
                  </div>
                )}
                <div className="text-xs text-slate-600">
                  {topSlot.tally.yes} available • {topSlot.tally.maybe} if need be
                </div>
              </div>

              {isAdmin && event.status !== "FINALIZED" && (
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="intent" value="finalize_poll" />
                  <input type="hidden" name="adminToken" value={adminToken || ""} />
                  <input type="hidden" name="winningSlotId" value={topSlot.slot.id} />
                  <button
                    type="submit"
                    className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-2xl shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] inline-flex items-center gap-2"
                  >
                    <Lock className="w-3.5 h-3.5" /> Lock This Time as Final Meeting
                  </button>
                </Form>
              )}
            </div>
          )}

          {/* Voting + Results Card — responsive: cards on mobile, matrix on desktop */}
          <div className="bg-white border border-slate-200/80 rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
            {/* Card header */}
            <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  {event.status === "FINALIZED" ? "Results" : "Vote your availability"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {pollData.votes.length} {pollData.votes.length === 1 ? "response" : "responses"} so far
                  {event.status !== "FINALIZED" && (
                    <span className="hidden sm:inline"> · Tap a cell to cycle No → Yes → If need be</span>
                  )}
                  {event.status !== "FINALIZED" && (
                    <span className="sm:hidden"> · Tap an option below</span>
                  )}
                </p>
              </div>
              {event.status !== "FINALIZED" && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setAllVotes("YES")}
                    className="px-3.5 py-2 rounded-full border border-green-200 bg-green-50 text-green-700 font-bold hover:bg-green-100 transition-colors min-h-[36px]"
                  >
                    All Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllVotes("NO")}
                    className="px-3.5 py-2 rounded-full border border-slate-200 bg-white text-slate-600 font-bold hover:bg-slate-50 transition-colors min-h-[36px]"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>

            {/* Voter identity — shared by mobile cards + desktop matrix */}
            {event.status !== "FINALIZED" && (
              <div className="p-5 sm:p-6 bg-blue-50/40 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="voter-name" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Your name *
                  </label>
                  <input
                    id="voter-name"
                    type="text"
                    value={voterName}
                    onChange={(e) => setVoterName(e.target.value)}
                    placeholder="e.g. Maya Lin"
                    autoComplete="name"
                    className="w-full text-sm font-medium px-4 py-3.5 rounded-2xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[52px]"
                  />
                </div>
                <div>
                  <label htmlFor="voter-email" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Email <span className="font-normal text-slate-400">(optional, for edit link)</span>
                  </label>
                  <input
                    id="voter-email"
                    type="email"
                    value={voterEmail}
                    onChange={(e) => setVoterEmail(e.target.value)}
                    placeholder="maya@example.com"
                    autoComplete="email"
                    className="w-full text-sm px-4 py-3.5 rounded-2xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[52px]"
                  />
                </div>
              </div>
            )}

            {/* ---- MOBILE: stacked option cards (thumb-friendly) ---- */}
            <div className="md:hidden divide-y divide-slate-100">
              {slots.map((s) => {
                const t = pollData.tallies[s.id] || { yes: 0, maybe: 0 };
                const cur = userVotes[s.id] || "NO";
                const isWinning = event.winningSlotId === s.id;
                const isTop = topSlot?.slot.id === s.id;
                const yesVoters = pollData.votes
                  .filter((v) => v.responses[s.id] === "YES")
                  .map((v) => v.participantName);
                const maybeVoters = pollData.votes
                  .filter((v) => v.responses[s.id] === "MAYBE")
                  .map((v) => v.participantName);
                const timeLabel =
                  s.startTime || s.endTime
                    ? `${formatTime(s.startTime)}${s.endTime ? ` – ${formatTime(s.endTime)}` : ""}`
                    : "All day";
                const dayLabel = slotDayLabel[s.id] || "Undated";
                // Auto-generated titles duplicate day + time already shown above — only show custom labels.
                const autoTitle = `${dayLabel} · ${timeLabel}`;
                const rawTitle = (s.title || "").trim();
                const customLabel = rawTitle && rawTitle !== autoTitle ? s.title : "";
                return (
                  <div key={s.id} className={`p-5 space-y-4 ${isWinning ? "bg-purple-50/50" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          {dayLabel}
                        </div>
                        <div className="font-extrabold text-slate-900 text-lg leading-tight mt-0.5">
                          {timeLabel}
                        </div>
                        {customLabel && (
                          <div className="text-xs text-slate-500 mt-0.5 truncate">{customLabel}</div>
                        )}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                            <Check className="w-3 h-3" /> {t.yes} Yes
                          </span>
                          {t.maybe > 0 && (
                            <span className="inline-flex items-center text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                              +{t.maybe} If need be
                            </span>
                          )}
                          {isTop && pollData.votes.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                              <Star className="w-3 h-3" /> Leader
                            </span>
                          )}
                          {isWinning && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-800 bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-full">
                              <Trophy className="w-3 h-3" /> Final
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {event.status !== "FINALIZED" ? (
                      <div
                        role="group"
                        aria-label={`Your availability for ${slotDayLabel[s.id]} ${timeLabel}`}
                        className="grid grid-cols-3 gap-2"
                      >
                        <button
                          type="button"
                          aria-pressed={cur === "YES"}
                          onClick={() => setSlotVote(s.id, "YES")}
                          className={`min-h-[56px] rounded-2xl border-2 font-bold text-sm transition-all active:scale-[0.97] inline-flex flex-col items-center justify-center gap-0.5 ${
                            cur === "YES"
                              ? "bg-green-600 border-green-600 text-white shadow-md"
                              : "bg-white border-slate-200 text-slate-500 hover:border-green-400 hover:text-green-700"
                          }`}
                        >
                          <Check className="w-5 h-5" />
                          Yes
                        </button>
                        <button
                          type="button"
                          aria-pressed={cur === "MAYBE"}
                          onClick={() => setSlotVote(s.id, "MAYBE")}
                          className={`min-h-[56px] rounded-2xl border-2 font-bold text-sm transition-all active:scale-[0.97] inline-flex flex-col items-center justify-center gap-0.5 ${
                            cur === "MAYBE"
                              ? "bg-amber-400 border-amber-400 text-slate-900 shadow-md"
                              : "bg-white border-slate-200 text-slate-500 hover:border-amber-400 hover:text-amber-700"
                          }`}
                        >
                          <span className="text-base leading-none font-extrabold">~</span>
                          <span className="text-xs">If need be</span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={cur === "NO"}
                          onClick={() => setSlotVote(s.id, "NO")}
                          className={`min-h-[56px] rounded-2xl border-2 font-bold text-sm transition-all active:scale-[0.97] inline-flex flex-col items-center justify-center gap-0.5 ${
                            cur === "NO"
                              ? "bg-slate-800 border-slate-800 text-white shadow-md"
                              : "bg-white border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700"
                          }`}
                        >
                          <X className="w-5 h-5" />
                          No
                        </button>
                      </div>
                    ) : null}

                    {(yesVoters.length > 0 || maybeVoters.length > 0) && (
                      <details className="text-xs text-slate-500">
                        <summary className="cursor-pointer font-semibold text-slate-600 py-2 min-h-[44px] flex items-center">
                          Who voted? ({yesVoters.length + maybeVoters.length})
                        </summary>
                        <div className="flex flex-wrap gap-1.5 pb-1">
                          {yesVoters.map((n) => (
                            <span key={`y-${s.id}-${n}`} className="px-2.5 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-800 font-semibold">
                              {n} ✓
                            </span>
                          ))}
                          {maybeVoters.map((n) => (
                            <span key={`m-${s.id}-${n}`} className="px-2.5 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-semibold">
                              {n} ~
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}

              {/* Mobile: all responses (collapsible, avoids giant matrix) */}
              {pollData.votes.length > 0 && (
                <div className="p-5 bg-slate-50/60">
                  <button
                    type="button"
                    onClick={() => setShowAllVotesMobile((v) => !v)}
                    aria-expanded={showAllVotesMobile}
                    className="w-full min-h-[48px] px-4 py-3 rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm"
                  >
                    {showAllVotesMobile
                      ? "Hide all responses"
                      : `Show all ${pollData.votes.length} responses`}
                  </button>
                  {showAllVotesMobile && (
                    <div className="mt-3 space-y-2">
                      {pollData.votes.map((v) => {
                        const vYes = Object.values(v.responses).filter((r) => r === "YES").length;
                        return (
                          <div key={v.id} className="bg-white border border-slate-200/80 rounded-2xl p-3.5 flex items-center justify-between gap-2 text-xs">
                            <span className="font-bold text-slate-800 truncate">
                              {v.participantName}
                              <span className="block font-normal text-slate-500">
                                {vYes} Yes · {Object.values(v.responses).filter((r) => r === "MAYBE").length} If need be
                              </span>
                            </span>
                            {isAdmin && (
                              <Form method="post" className="shrink-0">
                                <input type="hidden" name="intent" value="delete_poll_vote" />
                                <input type="hidden" name="voteId" value={v.id} />
                                <input type="hidden" name="adminToken" value={adminToken || ""} />
                                <button
                                  type="submit"
                                  title="Remove vote"
                                  aria-label={`Remove vote by ${v.participantName}`}
                                  className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-400 hover:text-rose-600 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </Form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ---- DESKTOP: matrix grid (44px+ targets) ---- */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  {/* Day-group row: one header per day spanning its time options */}
                  <tr className="bg-slate-100/80 border-b border-slate-200/80 text-slate-700 font-bold">
                    <th
                      rowSpan={2}
                      className="p-4 sm:p-5 w-52 min-w-[200px] sticky left-0 bg-slate-100 border-r border-slate-200/80 align-bottom"
                    >
                      Participants ({pollData.votes.length})
                    </th>
                    {dayGroups.map((g) => (
                      <th
                        key={g.key}
                        colSpan={g.slots.length}
                        className="p-2.5 text-center border-r border-slate-200/80 text-[11px] uppercase tracking-wider text-slate-600 bg-slate-100/60"
                      >
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-slate-700 font-bold">
                    {slots.map((s) => {
                      const isWinning = event.winningSlotId === s.id;
                      return (
                        <th
                          key={s.id}
                          className={`p-4 text-center border-r border-slate-200/80 min-w-[150px] ${
                            isWinning ? "bg-purple-50/60 text-purple-900" : ""
                          }`}
                        >
                          <div className="font-bold text-slate-900">
                            {s.startTime || s.endTime
                              ? `${formatTime(s.startTime)}${s.endTime ? ` – ${formatTime(s.endTime)}` : ""}`
                              : "All day"}
                          </div>
                          {isWinning && (
                            <span className="mt-1 text-[10px] px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold inline-flex items-center gap-1">
                              <Trophy className="w-3 h-3" /> Selected Meeting Time
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {/* Participant rows */}
                  {pollData.votes.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4 sticky left-0 bg-white border-r border-slate-200/80 font-semibold text-slate-900">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {v.participantName}
                            {isAdmin && (v as { participantEmail?: string | null }).participantEmail && (
                              <span className="block text-[11px] font-normal text-slate-500">
                                {(v as { participantEmail?: string | null }).participantEmail}
                              </span>
                            )}
                          </span>
                          {isAdmin && (
                            <Form method="post">
                              <input type="hidden" name="intent" value="delete_poll_vote" />
                              <input type="hidden" name="voteId" value={v.id} />
                              <input type="hidden" name="adminToken" value={adminToken || ""} />
                              <button
                                type="submit"
                                title="Remove vote"
                                className="text-slate-300 hover:text-rose-600 p-1 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </Form>
                          )}
                        </div>
                      </td>
                      {slots.map((s) => {
                        const resp = v.responses[s.id] || "NO";
                        return (
                          <td key={s.id} className="p-3 text-center border-r border-slate-100">
                            {resp === "YES" && (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-green-500 text-white shadow-sm">
                                <Check className="w-4 h-4" />
                              </span>
                            )}
                            {resp === "MAYBE" && (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-amber-400 text-slate-900 shadow-sm">
                                <Check className="w-4 h-4" />
                              </span>
                            )}
                            {resp === "NO" && (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 text-slate-400">
                                <Minus className="w-4 h-4" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Active Voting Row — desktop: 44px targets + labels */}
                  {event.status !== "FINALIZED" && (
                    <tr className="bg-blue-50/30 border-t-2 border-blue-400/80">
                      <td className="p-4 sticky left-0 bg-blue-50 border-r border-slate-200/80">
                        <div className="text-xs font-bold text-blue-900">
                          {voterName.trim() ? voterName.trim() : "Your vote"}
                        </div>
                        <div className="text-[11px] text-blue-700/80 mt-0.5">
                          {yesCount > 0 || maybeCount > 0
                            ? `${yesCount} Yes${maybeCount ? ` · ${maybeCount} If need be` : ""}`
                            : "Tap a cell to vote"}
                        </div>
                      </td>

                      {slots.map((s) => {
                        const cur = userVotes[s.id] || "NO";
                        const label = cur === "YES" ? "Yes" : cur === "MAYBE" ? "If need be" : "No";
                        return (
                          <td key={s.id} className="p-2.5 text-center border-r border-slate-200/80">
                            <button
                              type="button"
                              onClick={() => cycleSlotVote(s.id)}
                              title={`${label} — click to change`}
                              aria-label={`Your vote: ${label}. Activate to change.`}
                              className={`min-w-[48px] min-h-[48px] px-2 rounded-xl font-bold text-xs transition-all shadow-sm inline-flex flex-col items-center justify-center gap-0.5 ${
                                cur === "YES"
                                  ? "bg-green-500 text-white scale-105"
                                  : cur === "MAYBE"
                                  ? "bg-amber-400 text-slate-900 scale-105"
                                  : "bg-white border border-slate-300 hover:border-blue-500 text-slate-400"
                              }`}
                            >
                              {cur === "YES" ? (
                                <Check className="w-5 h-5" />
                              ) : cur === "MAYBE" ? (
                                <Check className="w-5 h-5" />
                              ) : (
                                <Minus className="w-5 h-5" />
                              )}
                              <span className="text-[10px] leading-none">{label}</span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>

                {/* Tallies Footer */}
                <tfoot>
                  <tr className="bg-slate-100/70 border-t border-slate-300/80 font-bold text-slate-800">
                    <td className="p-4 sm:p-5 sticky left-0 bg-slate-100 border-r border-slate-300/80">
                      Total Yes / (If need be)
                    </td>
                    {slots.map((s) => {
                      const t = pollData.tallies[s.id] || { yes: 0, maybe: 0 };
                      const isTop = topSlot?.slot.id === s.id;
                      return (
                        <td
                          key={s.id}
                          className={`p-4 text-center border-r border-slate-200/80 ${
                            isTop ? "bg-blue-100/60 text-blue-950" : ""
                          }`}
                        >
                          <span className="text-sm font-extrabold">{t.yes}</span>
                          {t.maybe > 0 && (
                            <span className="text-xs text-slate-500 ml-1.5 font-normal">
                              (+{t.maybe})
                            </span>
                          )}
                          {isTop && <Star className="ml-1 w-3.5 h-3.5 inline text-blue-600" />}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Voting footer / submit — shared */}
            {event.status !== "FINALIZED" && (
              <div className="p-5 sm:p-6 bg-[#fafafc] border-t border-slate-200/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-lg bg-green-500 text-white inline-flex items-center justify-center"><Check className="w-3 h-3" /></span>
                    <span>Available</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-lg bg-amber-400 text-slate-900 inline-flex items-center justify-center"><Check className="w-3 h-3" /></span>
                    <span>If need be</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-lg border border-slate-300 bg-slate-800 text-white inline-flex items-center justify-center"><X className="w-3 h-3" /></span>
                    <span>Unavailable</span>
                  </span>
                  {(yesCount > 0 || maybeCount > 0) && (
                    <span className="font-bold text-slate-700">
                      You: {yesCount} Yes{maybeCount ? ` · ${maybeCount} If need be` : ""}
                    </span>
                  )}
                </div>

                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (!voterName.trim()) {
                      e.preventDefault();
                      document.getElementById("voter-name")?.focus();
                      alert("Please enter your name first!");
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="vote_poll" />
                  <input type="hidden" name="participantName" value={voterName} />
                  <input type="hidden" name="participantEmail" value={voterEmail} />

                  {slots.map((s) => (
                    <input
                      key={s.id}
                      type="hidden"
                      name={`slot_${s.id}`}
                      value={userVotes[s.id] || "NO"}
                    />
                  ))}

                  {turnstileSiteKey && (
                    <div className="flex justify-center sm:justify-start">
                      <Turnstile siteKey={turnstileSiteKey} action="poll-vote" resetKey={navigation.state} />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full sm:w-auto min-h-[52px] px-7 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? "Saving..." : <>Save My Availability <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </Form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Signup Dialog Modal */}
      {selectedSlotForSignup && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-xl text-slate-900">Claim Spot</h3>
              <button
                type="button"
                onClick={() => setSelectedSlotForSignup(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-blue-50/70 border border-blue-100 p-4 rounded-2xl text-xs text-blue-900 space-y-0.5">
              <span className="font-bold text-sm text-blue-950 block">{selectedSlotForSignup.title}</span>
              <span className="text-blue-700">at {event.title}</span>
            </div>

            <Form method="post" onSubmit={() => setSelectedSlotForSignup(null)} className="space-y-4 text-xs">
              <input type="hidden" name="intent" value="signup" />
              <input type="hidden" name="slotId" value={selectedSlotForSignup.id} />

              <div>
                <label className="font-semibold block text-slate-700 mb-1.5">Your Full Name *</label>
                <input
                  type="text"
                  name="participantName"
                  required
                  placeholder="e.g. Maya Lin"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="font-semibold block text-slate-700 mb-1.5">
                  Your Email (Optional, for calendar invite & edit link)
                </label>
                <input
                  type="email"
                  name="participantEmail"
                  placeholder="maya@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="font-semibold block text-slate-700 mb-1.5">
                  Comments / Dietary or Equipment Notes (Optional)
                </label>
                <input
                  type="text"
                  name="comment"
                  placeholder="e.g., Bringing 2 dozen apples or bringing own gloves"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {turnstileSiteKey && (
                <Turnstile siteKey={turnstileSiteKey} action="event-signup" resetKey={navigation.state} />
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedSlotForSignup(null)}
                  className="px-5 py-2.5 rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-2xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-sm transition-colors"
                >
                  Confirm Spot
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}
