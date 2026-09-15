import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, useNavigation, useSearchParams, useFetcher, Form } from "@remix-run/react";
import { eq, and, inArray } from "drizzle-orm";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CircleCheck,
  Clock,
  Download,
  Globe,
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
import { sendEmail, emailFooter } from "~/utils/email";
import { escapeHtml } from "~/utils/sanitize";
import {
  buildAdminCookie,
  buildExpiredAdminCookie,
  getPresentedAdminToken,
  hashSecretForStorage,
  secretMatches,
  verifyAdminToken,
} from "~/utils/auth";
import { expiryDateFor, isExpired, pruneExpiredEvents, RETENTION_DAYS } from "~/utils/retention";
import { verifyTurnstile, turnstileFailure, hasTurnstileToken } from "~/utils/turnstile";
import { assessGuestRequest, needsVerification } from "~/utils/bot-protection";
import Turnstile from "~/components/Turnstile";
import DatePicker from "~/components/DatePicker";
import TimezoneSelect from "~/components/TimezoneSelect";
import { useCreateStickyHeader } from "~/utils/useCreateStickyHeader";
import { buildGoogleCalendarUrl, pickCalendarSlot, effectiveDateForSlot, formatSlotDateLabel, formatLongDateLabel, formatDurationLabel, addMinutesToTimeString, parseTimeString } from "~/utils/calendar";
import {
  detectLocalTimezone,
  formatInstantDateInZone,
  formatInstantTimeInZone,
  formatUtcOffsetLabel,
  timezoneCity,
  zonedWallTimeToUtc,
} from "~/utils/timezones";
import {
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
  truncate,
} from "~/utils/seo";
import { getSiteConfig } from "~/utils/site";
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
  isValidIsoDate,
  isValidTime,
  timeToMinutes,
  normalizeTimezone,
} from "~/utils/validation";

// Events are unlisted (robots.txt disallows /events/). Keep them out of
// search indexes and give each event a real title/description. Remix renders
// only the deepest `meta` export, so merge parent descriptors (OG image,
// twitter card, etc.) and override title/description/canonical/robots.
export const meta: MetaFunction<typeof loader> = ({ data, matches }) => {
  const site = rootSiteFromMatches(matches);
  const siteName = site.siteName;
  const siteUrl = site.siteUrl;
  const fallbackTitle = `Event | ${siteName}`;
  const fallbackDescription =
    "View event details and respond. No account needed.";
  if (!data?.event) {
    return mergeParentMeta(matches, [
      ...pageMetaOverrides({
        title: fallbackTitle,
        description: fallbackDescription,
        path: "/",
        robots: "noindex, nofollow",
        siteUrl,
      }),
    ]);
  }
  const rawTitle = (data.event.title || "Untitled event").trim() || "Untitled event";
  const title = truncate(`${rawTitle} | ${siteName}`, 70);
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
      siteUrl,
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

// Forward the loader's Cache-Control to the actual HTTP response. Remix
// only propagates Set-Cookie from loader responses by default — without this
// export, both `public, max-age=15` (initial loads) and `private, no-store`
// (background `?poll=1` live-syncs) would be silently dropped, letting
// browsers heuristically cache poll responses instead of hitting the origin.
export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers();
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return headers;
};

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as {
    DB: D1Database;
    TURNSTILE_SITE_KEY?: string;
    SITE_URL: string;
    SITE_NAME: string;
    SITE_TAGLINE: string;
    SITE_DESCRIPTION: string;
    FROM_EMAIL: string;
    GITHUB_REPO_URL?: string;
    FOOTER_CREDIT_URL?: string;
    FOOTER_CREDIT_LABEL?: string;
    SECURITY_CONTACT?: string;
    ICS_UID_DOMAIN?: string;
    ICS_PRODID?: string;
  };
  const site = getSiteConfig(env);
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
  // Background poll requests (`?poll=1` from the live-sync hook below) must
  // always hit the origin: private/no-store so neither the browser HTTP cache
  // (public max-age below) nor the CDN serves a stale roster/tallies snapshot.
  const isPoll = url.searchParams.get("poll") === "1";

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
  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  const isAdmin = await verifyAdminToken(presented, event.adminToken, `${clientIp}:${eventId}`);

  // If a valid ?admin= token was presented via URL, (re)issue the cookie and
  // redirect to the clean URL so the secret leaves history/logs.
  const adminQuery = url.searchParams.get("admin");
  if (isAdmin && adminQuery) {
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
        origin: url.origin,
        siteName: site.siteName,
      },
      {
        headers: {
          "Cache-Control":
            isAdmin || pendingCancel || isPoll ? "private, no-store" : "public, max-age=15",
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
        origin: url.origin,
        siteName: site.siteName,
      },
      {
        headers: {
          "Cache-Control":
            isAdmin || pendingCancel || isPoll ? "private, no-store" : "public, max-age=15",
        },
      }
    );
  }
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as {
    DB: D1Database;
    RESEND_API_KEY?: string;
    FROM_EMAIL: string;
    SITE_URL: string;
    SITE_NAME: string;
    SITE_TAGLINE: string;
    SITE_DESCRIPTION: string;
    GITHUB_REPO_URL?: string;
    FOOTER_CREDIT_URL?: string;
    FOOTER_CREDIT_LABEL?: string;
    SECURITY_CONTACT?: string;
    ICS_UID_DOMAIN?: string;
    ICS_PRODID?: string;
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_HOSTNAMES?: string;
  };
  // Fail-fast: FROM_EMAIL / SITE_NAME / ICS_* required — no fallback.
  const site = getSiteConfig(env);
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
    const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
    return verifyAdminToken(presentedAdmin, event.adminToken, `action:${clientIp}:${eventId}`);
  };
  const isPoll = event.type === "TIME_POLL";
  const isFinalized = event.status === "FINALIZED";
  const finalizedError = () =>
    json({ error: "This poll is finalized. Reopen it by deleting it or creating a new poll." }, { status: 409 });

  // 1. Sign-Up Slot Claim (transactional capacity guard)
  if (intent === "signup") {
    if (event.type !== "SIGNUP_SHEET") {
      return json({ error: "This event doesn't take sign-ups." }, { status: 400 });
    }
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

    // Progressive bot protection: frictionless for humans, Turnstile only
    // when honeypot/time-trap/rate-limit says suspicious. No widget is
    // rendered upfront — the client mounts it only on needsVerification.
    const guestCheck = assessGuestRequest(formData, {
      ip: request.headers.get("cf-connecting-ip") || "unknown",
      eventId,
    });
    if (guestCheck.verdict === "bot") {
      // Silent fake-success: don't tip bots that the honeypot caught them.
      return json({ success: true, message: `Thank you ${participantName}! Your spot has been confirmed.` });
    }
    if (guestCheck.verdict === "challenge") {
      const turnstileSignup = await verifyTurnstile({
        token: formData.get("cf-turnstile-response") as string | null,
        expectedAction: "event-signup",
        env,
        remoteIp: request.headers.get("cf-connecting-ip"),
      });
      if (!turnstileSignup.ok) {
        const f = needsVerification(guestCheck);
        return json(f.body, { status: f.status });
      }
    } else if (hasTurnstileToken(formData)) {
      // Low-risk retry carrying a token (e.g. after a prior challenge):
      // verify opportunistically so a solved token is consumed correctly.
      const turnstileSignup = await verifyTurnstile({
        token: formData.get("cf-turnstile-response") as string | null,
        expectedAction: "event-signup",
        env,
        remoteIp: request.headers.get("cf-connecting-ip"),
      });
      if (!turnstileSignup.ok) {
        const f = turnstileFailure(false);
        return json(f.body, { status: f.status });
      }
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
      const eventUrl = `${url.origin}/events/${eventId}`;
      const shiftPrefix = ((targetSlot as { shiftName?: string | null }).shiftName || "").trim();
      const taskLabel = shiftPrefix ? `${shiftPrefix} – ${targetSlot.title}` : targetSlot.title;
      const whenDatePart = event.eventDate ? formatLongDateLabel(event.eventDate) : "";
      const whenTimePart = targetSlot.startTime
        ? `${formatTime(targetSlot.startTime)}${targetSlot.endTime ? ` – ${formatTime(targetSlot.endTime)}` : ""}`
        : targetSlot.endTime
          ? formatTime(targetSlot.endTime)
          : "";
      // Same "City · GMT±HH:MM" format as the UI header (never raw IANA or
      // abbreviations like "EDT"). Offset is taken at the event instant (DST-aware).
      const organizerTz = (event.timezone || "").trim() || "UTC";
      const orgAt =
        event.eventDate && targetSlot.startTime
          ? zonedWallTimeToUtc(event.eventDate, targetSlot.startTime, organizerTz)
          : null;
      const whenTzPart = (() => {
        const city = timezoneCity(organizerTz);
        const offset = formatUtcOffsetLabel(organizerTz, orgAt ?? new Date());
        return offset ? `${city} · ${offset}` : city;
      })();
      const whenBase = [whenDatePart, whenTimePart].filter(Boolean).join(" · ");
      const whenLine = whenBase ? (whenTzPart ? `${whenBase} (${whenTzPart})` : whenBase) : whenTzPart;
      const googleCalendarUrl = buildGoogleCalendarUrl({
        title: `${taskLabel} — ${event.title}`,
        description: event.description,
        location: event.location,
        eventDate: event.eventDate,
        startTime: targetSlot.startTime,
        endTime: targetSlot.endTime,
        timeZone: event.timezone,
        url: `${url.origin}/events/${eventId}`,
        fallbackTitle: `${site.siteName} Event`,
      });
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: site.fromEmail,
        to: participantEmail,
        subject: `Confirmed: "${taskLabel}" for ${event.title}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
            <h2 style="color: #0f172a; margin-top: 0;">You're signed up!</h2>
            <p>Hi ${escapeHtml(participantName)},</p>
            <p>You have secured your spot for <strong>${escapeHtml(taskLabel)}</strong> at <strong>${escapeHtml(event.title)}</strong>.</p>
            ${whenLine ? `<p><strong>When:</strong> ${escapeHtml(whenLine)}</p>` : ""}
            ${event.location ? `<p><strong>Location:</strong> ${escapeHtml(event.location)}</p>` : ""}
            ${event.description ? `<p><strong>Description:</strong><br>${escapeHtml(event.description).replace(/\r?\n/g, "<br>")}</p>` : ""}
            <p><strong>Event page:</strong> <a href="${escapeHtml(eventUrl)}" style="color: #2563eb;">${escapeHtml(eventUrl)}</a></p>
            <p>
              <a href="${escapeHtml(googleCalendarUrl)}" style="color: #2563eb;">Add to Google Calendar</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(url.origin)}/events/${escapeHtml(eventId)}/ics" style="color: #2563eb;">Download .ics (Apple/Outlook)</a>
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin: 24px 0;">
              <p style="margin: 0 0 10px 0; font-size: 13px;"><strong>Need to cancel?</strong></p>
              <a href="${escapeHtml(cancelUrl)}" style="color: #dc2626; font-size: 13px;">Cancel this sign-up</a>
            </div>
            ${emailFooter(site)}
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
    if (!isPoll) {
      return json({ error: "This event isn't a poll." }, { status: 400 });
    }
    if (isFinalized) {
      return json({ error: "Voting is closed — the organizer has picked a time." }, { status: 409 });
    }
    const participantName = cleanText(formData.get("participantName"), PARTICIPANT_NAME_MAX);
    const rawVoteEmail = cleanText(formData.get("participantEmail"), EMAIL_MAX);
    const participantEmail = rawVoteEmail || null;

    if (!participantName) {
      return json({ error: "Your name is required to vote." }, { status: 400 });
    }
    if (participantEmail && !isValidEmail(participantEmail)) {
      return json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Progressive bot protection (same as signup): no upfront widget.
    const guestVoteCheck = assessGuestRequest(formData, {
      ip: request.headers.get("cf-connecting-ip") || "unknown",
      eventId,
    });
    if (guestVoteCheck.verdict === "bot") {
      return json({ success: true, message: `Availability recorded for ${participantName}!` });
    }
    if (guestVoteCheck.verdict === "challenge") {
      const turnstileVote = await verifyTurnstile({
        token: formData.get("cf-turnstile-response") as string | null,
        expectedAction: "poll-vote",
        env,
        remoteIp: request.headers.get("cf-connecting-ip"),
      });
      if (!turnstileVote.ok) {
        const f = needsVerification(guestVoteCheck);
        return json(f.body, { status: f.status });
      }
    } else if (hasTurnstileToken(formData)) {
      const turnstileVote = await verifyTurnstile({
        token: formData.get("cf-turnstile-response") as string | null,
        expectedAction: "poll-vote",
        env,
        remoteIp: request.headers.get("cf-connecting-ip"),
      });
      if (!turnstileVote.ok) {
        const f = turnstileFailure(false);
        return json(f.body, { status: f.status });
      }
    }

    const voteSlots = await db.select().from(eventSlots).where(eq(eventSlots.eventId, eventId));
    const clientVoteId = cleanText(formData.get("clientVoteId"), 32) || null;
    const clientVoteToken = cleanText(formData.get("clientVoteToken"), 128) || null;

    // Identity: the browser remembers its own vote id + private vote token
    // (localStorage) and sends both back; the id alone proves nothing. Display
    // names must be unique per event so two different "John"s (no email) can't
    // silently overwrite each other. Same browser updates its own vote; same
    // name + same non-empty email reclaims it (e.g. new device or cleared
    // storage, issuing a fresh token); otherwise a 409 asks for another name.
    const normName = participantName.trim().toLowerCase();
    const normEmail = (participantEmail || "").trim().toLowerCase();
    const existingVotes = await db.select().from(pollVotes).where(eq(pollVotes.eventId, eventId));

    const saveEntries = async (pollVoteId: string) => {
      for (const s of voteSlots) {
        const resp = (formData.get(`slot_${s.id}`) as string) || "NO";
        if (resp === "YES" || resp === "MAYBE") {
          await db.insert(pollVoteEntries).values({
            id: generateInternalId(),
            pollVoteId,
            slotId: s.id,
            response: resp,
          });
        }
      }
    };

    const takenMessage =
      "That name already voted. If that's you, please vote from your original browser or device (or enter the same email address). Otherwise pick a different name, e.g. \"John S.\"";

    if (clientVoteId && clientVoteToken) {
      const candidate = existingVotes.find((v) => v.id === clientVoteId);
      const ownVote =
        candidate && (await secretMatches(clientVoteToken, candidate.editToken)) ? candidate : null;
      if (ownVote) {
        const renamedIntoTaken = existingVotes.some(
          (v) => v.id !== ownVote.id && (v.participantName || "").trim().toLowerCase() === normName
        );
        if (renamedIntoTaken) {
          return json({ error: takenMessage }, { status: 409 });
        }
        await db
          .update(pollVotes)
          .set({ participantName, participantEmail, updatedAt: now })
          .where(eq(pollVotes.id, ownVote.id));
        await db.delete(pollVoteEntries).where(eq(pollVoteEntries.pollVoteId, ownVote.id));
        await saveEntries(ownVote.id);

        return json({
          success: true,
          message: `Availability updated for ${participantName}!`,
          voteId: ownVote.id,
          voteToken: clientVoteToken,
        });
      }
      // Unknown/stale id or wrong token: fall through to name checks.
    }

    const nameCollision = existingVotes.find(
      (v) => (v.participantName || "").trim().toLowerCase() === normName
    );
    if (nameCollision) {
      const reclaimable =
        normEmail !== "" &&
        (nameCollision.participantEmail || "").trim().toLowerCase() === normEmail;
      if (reclaimable) {
        const reclaimToken = generateSecretToken();
        await db
          .update(pollVotes)
          .set({
            participantName,
            participantEmail,
            editToken: await hashSecretForStorage(reclaimToken),
            updatedAt: now,
          })
          .where(eq(pollVotes.id, nameCollision.id));
        await db.delete(pollVoteEntries).where(eq(pollVoteEntries.pollVoteId, nameCollision.id));
        await saveEntries(nameCollision.id);

        return json({
          success: true,
          message: `Availability updated for ${participantName}!`,
          voteId: nameCollision.id,
          voteToken: reclaimToken,
        });
      }
      return json({ error: takenMessage }, { status: 409 });
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

    await saveEntries(voteId);

    // Current consensus: frontrunner option by YES count (MAYBE breaks ties),
    // computed over all votes including the one just saved.
    let consensusLine = "";
    if (voteSlots.length > 0) {
      const slotIds = voteSlots.map((s) => s.id);
      const allEntries = await db
        .select({ slotId: pollVoteEntries.slotId, response: pollVoteEntries.response })
        .from(pollVoteEntries)
        .where(inArray(pollVoteEntries.slotId, slotIds));
      const yesCount = new Map<string, number>();
      const maybeCount = new Map<string, number>();
      for (const e of allEntries) {
        if (e.response === "YES") yesCount.set(e.slotId, (yesCount.get(e.slotId) ?? 0) + 1);
        else if (e.response === "MAYBE") maybeCount.set(e.slotId, (maybeCount.get(e.slotId) ?? 0) + 1);
      }
      const ranked = [...voteSlots].sort(
        (a, b) =>
          (yesCount.get(b.id) ?? 0) - (yesCount.get(a.id) ?? 0) ||
          (maybeCount.get(b.id) ?? 0) - (maybeCount.get(a.id) ?? 0)
      );
      const top = ranked[0];
      const topYes = yesCount.get(top.id) ?? 0;
      const topMaybe = maybeCount.get(top.id) ?? 0;
      if (topYes > 0 || topMaybe > 0) {
        const topDate = top.slotDate ?? event.eventDate;
        const topTime = top.startTime
          ? `${formatTime(top.startTime)}${top.endTime ? ` – ${formatTime(top.endTime)}` : ""}`
          : top.endTime
            ? formatTime(top.endTime)
            : "";
        const topWhen = [topDate ? formatLongDateLabel(topDate) : "", topTime]
          .filter(Boolean)
          .join(" · ");
        consensusLine = `${topWhen || top.title} (${topYes} yes${topMaybe ? `, ${topMaybe} maybe` : ""})`;
      }
    }

    if (participantEmail) {
      const manageUrl = `${url.origin}/events/${eventId}?cancel_token=${encodeURIComponent(editTokenPlain)}`;
      const eventUrl = `${url.origin}/events/${eventId}`;
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: site.fromEmail,
        to: participantEmail,
        subject: `Your vote for "${event.title}" is recorded`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
            <p>Hi ${escapeHtml(participantName)},</p>
            <p>Your availability for <strong>${escapeHtml(event.title)}</strong> is recorded.</p>
            ${event.description ? `<p><strong>Description:</strong><br>${escapeHtml(event.description).replace(/\r?\n/g, "<br>")}</p>` : ""}
            ${consensusLine ? `<p><strong>Leading option so far:</strong> ${escapeHtml(consensusLine)}</p>` : ""}
            <p><strong>Event page:</strong> <a href="${escapeHtml(eventUrl)}" style="color: #2563eb;">${escapeHtml(eventUrl)}</a></p>
            <p><a href="${escapeHtml(manageUrl)}" style="color: #dc2626;">Remove my vote</a></p>
            ${emailFooter(site)}
          </div>
        `,
      });
    }

    return json({
      success: true,
      message: `Availability recorded for ${participantName}!`,
      voteId,
      voteToken: editTokenPlain,
    });
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
    if (!isPoll) {
      return json({ error: "Only polls can be finalized." }, { status: 400 });
    }
    const winningSlotId = cleanText(formData.get("winningSlotId"), 32);
    if (!winningSlotId) {
      return json({ error: "Please choose a winning option." }, { status: 400 });
    }
    // Validate the winning slot belongs to this event (no arbitrary IDs).
    const [winningSlot] = await db
      .select({
        id: eventSlots.id,
        eventId: eventSlots.eventId,
        title: eventSlots.title,
        slotDate: eventSlots.slotDate,
        startTime: eventSlots.startTime,
        endTime: eventSlots.endTime,
      })
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

    // Notify every voter that left an email address. Emails are best-effort:
    // a failed send never fails the finalize itself (sendEmail never throws).
    const eventUrl = `${url.origin}/events/${eventId}`;
    const lockedDate = effectiveDateForSlot(winningSlot, event.eventDate);
    const lockedTimePart = winningSlot.startTime
      ? `${formatTime(winningSlot.startTime)}${winningSlot.endTime ? ` – ${formatTime(winningSlot.endTime)}` : ""}`
      : winningSlot.endTime
        ? formatTime(winningSlot.endTime)
        : "";
    const lockedTz = (event.timezone || "").trim() || "UTC";
    const lockedAt =
      lockedDate && winningSlot.startTime
        ? zonedWallTimeToUtc(lockedDate, winningSlot.startTime, lockedTz)
        : null;
    const lockedTzPart = (() => {
      const city = timezoneCity(lockedTz);
      const offset = formatUtcOffsetLabel(lockedTz, lockedAt ?? new Date());
      return offset ? `${city} · ${offset}` : city;
    })();
    const lockedBase = [lockedDate ? formatLongDateLabel(lockedDate) : "", lockedTimePart]
      .filter(Boolean)
      .join(" · ");
    const lockedWhen = lockedBase ? (lockedTzPart ? `${lockedBase} (${lockedTzPart})` : lockedBase) : lockedTzPart;
    const lockedCalendarUrl = buildGoogleCalendarUrl({
      title: event.title,
      description: event.description,
      location: event.location,
      eventDate: lockedDate,
      startTime: winningSlot.startTime,
      endTime: winningSlot.endTime,
      timeZone: event.timezone,
      url: eventUrl,
      fallbackTitle: `${site.siteName} Event`,
    });
    const voters = await db.select().from(pollVotes).where(eq(pollVotes.eventId, eventId));
    const notified = new Set<string>();
    for (const v of voters) {
      const voterEmail = (v.participantEmail || "").trim();
      if (!voterEmail || !isValidEmail(voterEmail)) continue;
      const key = voterEmail.toLowerCase();
      if (notified.has(key)) continue;
      notified.add(key);
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: site.fromEmail,
        to: voterEmail,
        subject: `Locked in: "${event.title}" — ${lockedBase || winningSlot.title}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
            <h2 style="color: #0f172a; margin-top: 0;">Meeting time locked in!</h2>
            <p>Hi ${escapeHtml(v.participantName)},</p>
            <p>The time for <strong>${escapeHtml(event.title)}</strong> has been decided:</p>
            ${lockedWhen ? `<p><strong>When:</strong> ${escapeHtml(lockedWhen)}</p>` : ""}
            ${event.location ? `<p><strong>Location:</strong> ${escapeHtml(event.location)}</p>` : ""}
            ${event.description ? `<p><strong>Description:</strong><br>${escapeHtml(event.description).replace(/\r?\n/g, "<br>")}</p>` : ""}
            <p><strong>Event page:</strong> <a href="${escapeHtml(eventUrl)}" style="color: #2563eb;">${escapeHtml(eventUrl)}</a></p>
            <p>
              <a href="${escapeHtml(lockedCalendarUrl)}" style="color: #2563eb;">Add to Google Calendar</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(url.origin)}/events/${escapeHtml(eventId)}/ics" style="color: #2563eb;">Download .ics (Apple/Outlook)</a>
            </p>
            ${emailFooter(site)}
          </div>
        `,
      });
    }

    return json({ success: true, message: "Meeting has been officially locked and finalized!" });
  }

  // 5. Update Event Details (admin only)
  if (intent === "update_event") {
    if (!(await requireAdmin())) {
      return json({ error: "Unauthorized." }, { status: 403 });
    }

    const title = cleanText(formData.get("title"), TITLE_MAX);
    const description = cleanText(formData.get("description"), DESCRIPTION_MAX) || null;
    // TIME_POLL has no top-level date (days live on the options, like create)
    // — keep the stored one instead of wiping it.
    const eventDate =
      event.type === "TIME_POLL" ? event.eventDate : cleanText(formData.get("eventDate"), 32) || null;
    const location = cleanText(formData.get("location"), LOCATION_MAX) || null;
    const organizerName = cleanText(formData.get("organizerName"), ORGANIZER_NAME_MAX);
    const timezone = normalizeTimezone(formData.get("timezone") as string | null);

    if (!title) {
      return json({ error: "Event title is required." }, { status: 400 });
    }
    if (!organizerName) {
      return json({ error: "Organizer name is required." }, { status: 400 });
    }
    if (eventDate && !isValidIsoDate(eventDate)) {
      return json({ error: "Please pick a valid event date." }, { status: 400 });
    }

    await db
      .update(events)
      .set({ title, description, eventDate, location, organizerName, timezone, updatedAt: now })
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
    if (isPoll && isFinalized) return finalizedError();
    if (event.type === "TIME_POLL") {
      if (!slotDate) {
        return json({ error: "Please pick a day for the new option." }, { status: 400 });
      }
      const pollDuration = (event as { durationMinutes?: number | null }).durationMinutes ?? null;
      if (pollDuration !== null && !startTime) {
        return json({ error: "Please pick a start time for the new option." }, { status: 400 });
      }
    } else if (!title && !startTime && !shiftName && !slotDate) {
      return json({ error: "Give the new option a title, day or time." }, { status: 400 });
    }
    const slotError = validateSlotFields(slotDateRaw, startTime, endTime);
    if (slotError) return json({ error: slotError }, { status: 400 });

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
      title: (title || autoPollTitle(title, slotDate, startTime, endTime) || shiftName || (endTime ? `${startTime} – ${endTime}` : (startTime as string)) || slotDate || "New option").slice(0, SLOT_TITLE_MAX),
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
    const titleRaw = cleanText(formData.get("slotTitle"), SLOT_TITLE_MAX);
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
    if (isPoll && isFinalized) return finalizedError();
    let title = titleRaw;
    if (event.type === "TIME_POLL") {
      // Same rules as create/poll: day is required, label is optional
      // (auto-generated "Day · time" when empty).
      if (slotDateRaw !== "" && !slotDate) {
        return json({ error: "Please pick a valid day." }, { status: 400 });
      }
      if (!slotDate) {
        return json({ error: "Day is required." }, { status: 400 });
      }
      const pollDuration = (event as { durationMinutes?: number | null }).durationMinutes ?? null;
      if (pollDuration !== null && !startTime) {
        return json({ error: "Start time is required." }, { status: 400 });
      }
      if (!title) {
        title = autoPollTitle(titleRaw, slotDate, startTime, endTime) || target.title;
      }
    }
    if (!title) {
      return json({ error: "Slot title is required." }, { status: 400 });
    }
    const slotError = validateSlotFields(slotDateRaw, startTime, endTime);
    if (slotError) return json({ error: slotError }, { status: 400 });
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
    if (isPoll && isFinalized) return finalizedError();

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

/** Shared day/time checks for organizer add/update option. Null when valid. */
function validateSlotFields(
  slotDateRaw: string,
  startTime: string | null,
  endTime: string | null
): string | null {
  if (slotDateRaw && !isValidIsoDate(slotDateRaw)) return "Please pick a valid day.";
  if ((startTime && !isValidTime(startTime)) || (endTime && !isValidTime(endTime))) {
    return "Please pick a valid time.";
  }
  if (startTime && endTime && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return "End time must be after the start time.";
  }
  return null;
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

/** Auto title for TIME_POLL options with an empty label — same format as create/poll. */
function autoPollTitle(
  _label: string,
  slotDate: string | null,
  startTime: string | null,
  endTime: string | null
): string | null {
  if (!slotDate) return startTime || null;
  const day = formatSlotDateLabel(slotDate);
  if (!startTime) return day ? `${day} · All day` : null;
  const start = formatTime(startTime);
  const end = endTime ? formatTime(endTime) : "";
  return end ? `${day} · ${start} – ${end}` : `${day} · ${start}`;
}

const EDIT_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Normalize legacy stored times ("10:00 AM", "9:00", ISO) to "HH:MM" for <input type="time">. */
function normalizeToTimeInput(t: string | null | undefined): string {
  const parsed = parseTimeString(t);
  if (!parsed) return "";
  return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
}

function endForDuration(start: string, durationMinutes: number | null | undefined): string {
  if (durationMinutes === null || durationMinutes === undefined) return "";
  if (!EDIT_TIME_RE.test(start)) return "";
  return addMinutesToTimeString(start, durationMinutes);
}

/**
 * Timezone field for the edit-details form — same TimezoneSelect as create.
 * Local state seeds from the stored value; the edit panel remounts on open.
 */
function EditTimezoneField({ initial }: { initial: string }) {
  const [tz, setTz] = useState(initial || "UTC");
  return (
    <TimezoneSelect
      id="edit-timezone"
      name="timezone"
      value={tz}
      onChange={setTz}
      accent="green"
    />
  );
}

/**
 * TIME_POLL option row — mirrors create/poll's "Add your times" layout:
 * Day * | Start * | Ends (auto) | Label, with Save/Delete actions.
 */
function PollTimeOptionRow({
  slot,
  durationMinutes,
  adminToken,
  isSubmitting,
}: {
  slot: { id: string; title: string; slotDate?: string | null; startTime?: string | null; endTime?: string | null };
  durationMinutes: number | null;
  adminToken: string | null;
  isSubmitting: boolean;
}) {
  const isAllDay = durationMinutes === null;
  const [date, setDate] = useState(slot.slotDate || "");
  const [start, setStart] = useState(() => normalizeToTimeInput(slot.startTime));
  const [label, setLabel] = useState(() => {
    const s = slot.title || "";
    // Hide auto-generated "Day · time" titles so the Label field looks
    // optional like on create; custom labels are preserved.
    if (!s) return "";
    if (/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · /.test(s)) return "";
    return s;
  });
  const end = endForDuration(start, durationMinutes);

  return (
    <Form
      method="post"
      className={`flex items-center gap-2 p-2 bg-slate-50/70 rounded-xl border border-slate-200/80 transition-all hover:border-slate-300 sm:grid ${isAllDay ? "sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_148px]" : "sm:grid-cols-[minmax(0,1.45fr)_132px_104px_minmax(0,1fr)_148px]"} sm:gap-3 sm:px-3 sm:py-2.5`}
    >
      <input type="hidden" name="intent" value="update_slot" />
      <input type="hidden" name="adminToken" value={adminToken || ""} />
      <input type="hidden" name="slotId" value={slot.id} />
      <input type="hidden" name="slotEndTime" value={isAllDay ? "" : end} />
      <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 sm:contents">
        <span className="sr-only">Option</span>
        <DatePicker
          name="slotDate"
          value={date}
          onChange={setDate}
          className="col-span-2 sm:col-span-1 min-w-0"
        />
        {!isAllDay && (
          <input
            type="time"
            required
            aria-label="Start time"
            name="slotStartTime"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-w-0"
          />
        )}
        {!isAllDay && (
          <span
            title={end ? `Ends ${formatTime(end)}` : "End time"}
            className="flex items-center h-10 text-xs font-semibold text-slate-500 whitespace-nowrap tabular-nums truncate min-w-0"
          >
            → {end ? formatTime(end) : "—"}
          </span>
        )}
        <input
          type="text"
          name="slotTitle"
          placeholder="Label (optional)"
          aria-label="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="col-span-2 w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-slate-400 min-w-0 sm:col-span-1"
        />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 sm:w-[148px]">
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
            if (!window.confirm(`Delete "${slot.title}"? Existing signups/votes for it will be removed.`)) {
              e.preventDefault();
            }
          }}
          className="px-4 py-2 rounded-2xl bg-white border border-rose-200 hover:border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-semibold shadow-sm transition-all"
        >
          Delete
        </button>
      </div>
    </Form>
  );
}

/**
 * TIME_POLL "add option" row — same Day | Start | Ends | Label order
 * as create/poll's "Add your times" step.
 */
function PollTimeNewOptionRow({
  durationMinutes,
  adminToken,
  isSubmitting,
}: {
  durationMinutes: number | null;
  adminToken: string | null;
  isSubmitting: boolean;
}) {
  const isAllDay = durationMinutes === null;
  const [date, setDate] = useState("");
  const [start, setStart] = useState("10:00");
  const [label, setLabel] = useState("");
  const end = endForDuration(start, durationMinutes);

  return (
    <Form
      method="post"
      className={`flex items-center gap-2 p-2 bg-slate-50/70 rounded-xl border border-slate-200/80 transition-all hover:border-slate-300 sm:grid ${isAllDay ? "sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_148px]" : "sm:grid-cols-[minmax(0,1.45fr)_132px_104px_minmax(0,1fr)_148px]"} sm:gap-3 sm:px-3 sm:py-2.5`}
    >
      <input type="hidden" name="intent" value="add_slot" />
      <input type="hidden" name="adminToken" value={adminToken || ""} />
      <input type="hidden" name="slotEndTime" value={isAllDay ? "" : end} />
      <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 sm:contents">
        <span className="sr-only">New option</span>
        <DatePicker
          name="slotDate"
          value={date}
          onChange={setDate}
          placeholder="Pick a day"
          className="col-span-2 sm:col-span-1 min-w-0"
        />
        {!isAllDay && (
          <input
            type="time"
            aria-label="Start time for new option"
            name="slotStartTime"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-w-0"
          />
        )}
        {!isAllDay && (
          <span
            title={end ? `Ends ${formatTime(end)}` : "End time"}
            className="flex items-center h-10 text-xs font-semibold text-slate-500 whitespace-nowrap tabular-nums truncate min-w-0"
          >
            → {end ? formatTime(end) : "—"}
          </span>
        )}
        <input
          type="text"
          name="slotTitle"
          placeholder="Label (optional)"
          aria-label="Label for new option (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="col-span-2 w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-slate-400 min-w-0 sm:col-span-1"
        />
      </div>
      <div className="flex shrink-0 items-center justify-end sm:w-[148px]">
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        >
          + Add Option
        </button>
      </div>
    </Form>
  );
}

// Viewer timezone is client-only (detectLocalTimezone reads Intl). Initial
// state is null so SSR and first client render match; the effect fills it in
// after mount, revealing the "your time" conversions without a mismatch.
function useViewerTimezone(): string | null {
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => {
    setTz(detectLocalTimezone());
  }, []);
  return tz;
}

function organizerTzOf(event: { timezone?: string | null }): string {
  const tz = (event.timezone || "").trim();
  return tz || "UTC";
}

/** Create-page format: "New York · GMT-04:00" (city + full offset at the event instant). */
function organizerTzLabel(organizerTz: string, at: Date | null): string {
  const city = timezoneCity(organizerTz);
  const offset = formatUtcOffsetLabel(organizerTz, at ?? new Date());
  return offset ? `${city} · ${offset}` : city;
}

/**
 * Dual clock display: organizer wall-clock (always) + GMT offset & viewer-local
 * conversion (client-only, only when organizer and viewer zones differ).
 * `date` is the organizer-local calendar day ("YYYY-MM-DD").
 */
function DualSlotTime({
  organizerTz,
  viewerTz,
  date,
  startTime,
  endTime,
  className,
}: {
  organizerTz: string;
  viewerTz: string | null;
  date: string | null;
  startTime: string | null | undefined;
  endTime: string | null | undefined;
  className?: string;
}) {
  const orgLabel = useMemo(() => {
    if (!startTime && !endTime) return "All day";
    const base = startTime
      ? `${formatTime(startTime)}${endTime ? ` – ${formatTime(endTime)}` : ""}`
      : formatTime(endTime);
    return base;
  }, [startTime, endTime]);

  const orgAt = useMemo(
    () => (date && startTime ? zonedWallTimeToUtc(date, startTime, organizerTz) : null),
    [date, startTime, organizerTz]
  );
  // Timezone suffixes only when organizer and viewer differ — otherwise the
  // bare wall-clock time is unambiguous. Uses city + GMT offset
  // ("New York · GMT-04:00") to match the header format (never abbreviations
  // like "EDT").
  const showTz = Boolean(viewerTz && viewerTz !== organizerTz);
  const orgOffset = useMemo(
    () => (showTz && orgAt ? organizerTzLabel(organizerTz, orgAt) : null),
    [showTz, orgAt, organizerTz]
  );

  const viewer = useMemo(() => {
    if (!viewerTz || viewerTz === organizerTz || !date || !startTime) return null;
    const utcStart = zonedWallTimeToUtc(date, startTime, organizerTz);
    if (!utcStart) return null;
    const startLabel = formatInstantTimeInZone(utcStart, viewerTz);
    if (!startLabel) return null;
    let endLabel: string | null = null;
    if (endTime) {
      const utcEnd = zonedWallTimeToUtc(date, endTime, organizerTz);
      // Overnight edge: end wall-clock earlier than start means next day.
      const adjusted =
        utcEnd && utcEnd.getTime() <= utcStart.getTime()
          ? new Date(utcEnd.getTime() + 24 * 60 * 60 * 1000)
          : utcEnd;
      endLabel = adjusted ? formatInstantTimeInZone(adjusted, viewerTz) : null;
    }
    const viewerDateLabel = formatInstantDateInZone(utcStart, viewerTz);
    const viewerOffset = organizerTzLabel(viewerTz, utcStart);
    // Show the viewer day when the conversion lands on a different calendar
    // day than the organizer day (common across the date line).
    const orgDay = (() => {
      try {
        return new Intl.DateTimeFormat("en-US", {
          timeZone: organizerTz,
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(utcStart);
      } catch {
        return null;
      }
    })();
    return {
      text: endLabel ? `${startLabel} – ${endLabel}` : startLabel,
      dateNote: viewerDateLabel && orgDay && viewerDateLabel !== orgDay ? viewerDateLabel : null,
      abbr: viewerOffset,
    };
  }, [viewerTz, organizerTz, date, startTime, endTime]);

  return (
    <span className={className}>
      <span>
        {orgLabel}
        {orgOffset ? ` ${orgOffset}` : ""}
      </span>
      {viewer && (
        <span className="block text-[11px] font-medium opacity-80">
          {viewer.text}
          {viewer.abbr ? ` ${viewer.abbr}` : ""} in your time
          {viewer.dateNote ? ` · ${viewer.dateNote}` : ""}
        </span>
      )}
    </span>
  );
}

export default function EventView() {
  const {
    event: serverEvent,
    slots: serverSlots,
    signups: serverSignups,
    isAdmin,
    adminToken,
    pollData: serverPollData,
    pendingCancel,
    turnstileSiteKey,
    origin,
    siteName,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; message?: string; error?: string; voteId?: string; voteToken?: string; needsVerification?: boolean }>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const cancelTokenParam = searchParams.get("cancel_token");
  // Time-trap baseline: set once per page view. Submitted as formStartedAt so
  // the server can tell a 300ms bot replay from a human who read the page.
  const [pageLoadedAt] = useState(() => Date.now());
  // Only mount Turnstile when the server actually challenged us — this is
  // what keeps guests frictionless 99% of the time.
  const needsHumanCheck = Boolean(actionData?.needsVerification);

  // ------------------------------------------------------------------
  // Real-time sync (polling): re-run the event loader in the background
  // with a useFetcher so rosters / tallies stay fresh while the page is
  // open. No new infra: each poll is one loader read (~votes + entries +
  // slots + event). Polls only while the tab is visible, back off to ~25s
  // after 60s without interaction, and revalidate immediately after a save.
  // ------------------------------------------------------------------
  const pollFetcher = useFetcher<typeof loader>();
  const pollFetcherRef = useRef(pollFetcher);
  pollFetcherRef.current = pollFetcher;
  const lastActivityRef = useRef(Date.now());
  const lastPollRef = useRef(Date.now());
  const prevNavStateRef = useRef(navigation.state);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Merging happens here so every consumer below (signup roster, poll
  // matrix, tallies, consensus banner, finalize state) sees live data.
  // Local draft state (userVotes, voterName) is untouched — only server
  // snapshots are swapped.
  const live = pollFetcher.data ?? null;
  const event = live?.event ?? serverEvent;
  const slots = live?.slots ?? serverSlots;
  const initialSignups = live?.signups ?? serverSignups;
  const pollData = live?.pollData ?? serverPollData;

  useEffect(() => {
    if (pollFetcher.data) setLastSyncedAt(Date.now());
  }, [pollFetcher.data]);

  // Any interaction marks the tab active again (drives the idle backoff).
  useEffect(() => {
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("mousemove", markActive, opts);
    window.addEventListener("keydown", markActive, opts);
    window.addEventListener("touchstart", markActive, opts);
    window.addEventListener("click", markActive, opts);
    window.addEventListener("scroll", markActive, opts);
    return () => {
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("touchstart", markActive);
      window.removeEventListener("click", markActive);
      window.removeEventListener("scroll", markActive);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const pollUrl = `/events/${serverEvent.id}?poll=1`;
    const tryPoll = () => {
      if (stopped) return;
      // Pause entirely while the tab is hidden — no wasted reads/requests.
      if (typeof document !== "undefined" && document.hidden) return;
      const f = pollFetcherRef.current;
      if (f.state !== "idle") return;
      const now = Date.now();
      const idleFor = now - lastActivityRef.current;
      // Active: ~7s cadence; idle (>60s no input): ~25s cadence.
      const interval = idleFor > 60_000 ? 25_000 : 7_000;
      if (now - lastPollRef.current < interval) return;
      lastPollRef.current = now;
      f.load(pollUrl);
    };
    // Tick faster than the cadence and gate on elapsed time, so the idle
    // backoff switches without resetting timers.
    const timer = window.setInterval(tryPoll, 2000);
    document.addEventListener("visibilitychange", tryPoll);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tryPoll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverEvent.id]);

  // Revalidate immediately after any form save completes, so the author's
  // own vote/signup (and concurrent admin edits) appear without waiting
  // for the next poll tick.
  useEffect(() => {
    if (prevNavStateRef.current === "submitting" && navigation.state === "idle") {
      lastPollRef.current = Date.now();
      pollFetcherRef.current.load(`/events/${serverEvent.id}?poll=1`);
    }
    prevNavStateRef.current = navigation.state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation.state, serverEvent.id]);

  const justCreated = Boolean(searchParams.get("created"));
  const justCancelled = Boolean(searchParams.get("cancelled"));
  const cancelError = Boolean(searchParams.get("cancel_error"));
  const [selectedSlotForSignup, setSelectedSlotForSignup] = useState<{ id: string; title: string } | null>(null);
  // Close the signup modal on success; keep it open on error/challenge so
  // the on-demand Turnstile stays visible for a retry.
  useEffect(() => {
    if (actionData?.success && selectedSlotForSignup) setSelectedSlotForSignup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  // Floating toast for action feedback (success/error). The old inline banner
  // at the top of the page was off-screen after submitting a form further
  // down, so confirmations like "Your spot has been confirmed" were missed.
  // A fixed-viewport toast is always visible regardless of scroll position.
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string; key: number } | null>(null);
  useEffect(() => {
    if (actionData?.message) {
      setToast({ kind: "success", text: actionData.message, key: Date.now() });
    } else if (actionData?.error && !actionData?.needsVerification) {
      setToast({ kind: "error", text: actionData.error, key: Date.now() });
    }
  }, [actionData]);
  // Auto-dismiss the toast after 6s; manual close via the X button.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const [showEdit, setShowEdit] = useState(false);
  // QR is derived on demand from the event URL, so older events need no
  // backfill. If the image fails to load (unknown/expired event, generation
  // error), hide the badge silently instead of showing a broken-image box.
  const [qrHidden, setQrHidden] = useState(false);
  // Reset on client-side navigation between events (same component instance).
  useEffect(() => {
    setQrHidden(false);
  }, [event.id]);

  // Active poll vote states for interactive row: Record<slotId, 'NO' | 'YES' | 'MAYBE'>
  const [userVotes, setUserVotes] = useState<Record<string, "NO" | "YES" | "MAYBE">>({});
  const [voterName, setVoterName] = useState("");
  const [voterEmail, setVoterEmail] = useState("");
  const [showAllVotesMobile, setShowAllVotesMobile] = useState(false);

  // The browser remembers its own vote id + private vote token so repeat saves
  // update it instead of creating duplicates. Stored as JSON {id, token}; a
  // legacy bare id (no token) is ignored — that voter reclaims via email.
  // Read in an effect (not the initializer) to avoid a hydration mismatch.
  const voteStorageKey = `mm_poll_vote_${event.id}`;
  const [clientVoteId, setClientVoteId] = useState<string | null>(null);
  const [clientVoteToken, setClientVoteToken] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(voteStorageKey);
      if (!raw || !raw.startsWith("{")) return;
      const parsed = JSON.parse(raw) as { id?: string; token?: string };
      if (!parsed.id || !parsed.token) return;
      const stored = parsed.id;
      setClientVoteId(stored);
      setClientVoteToken(parsed.token);
      const own = pollData?.votes.find((v) => v.id === stored);
      if (own) {
        setVoterName((prev) => prev || own.participantName);
        const next: Record<string, "NO" | "YES" | "MAYBE"> = {};
        Object.entries(own.responses).forEach(([slotId, resp]) => {
          if (resp === "YES" || resp === "MAYBE") next[slotId] = resp;
        });
        setUserVotes((prev) => (Object.keys(prev).length === 0 ? next : prev));
      }
    } catch {
      // private mode / blocked storage: voting still works, just no prefill
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember our vote id after a successful save.
  useEffect(() => {
    if (actionData?.success && actionData?.voteId && actionData?.voteToken) {
      try {
        window.localStorage.setItem(
          voteStorageKey,
          JSON.stringify({ id: actionData.voteId, token: actionData.voteToken })
        );
      } catch {
        // ignore storage failures
      }
      setClientVoteId(actionData.voteId);
      setClientVoteToken(actionData.voteToken);
    }
  }, [actionData, voteStorageKey]);

  const ownVote =
    clientVoteId && pollData ? pollData.votes.find((v) => v.id === clientVoteId) ?? null : null;

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

  // SSR-safe absolute links: `origin` comes from the loader (request URL),
  // so server and client render identical hrefs/values (no hydration
  // mismatch). Never use window.location directly in render.
  const publicLink = `${origin}/events/${event.id}`;
  // QR image for the header (PNG so right-click copy/save yields a PNG file;
  // generated by a Workers-native encoder — no Node APIs needed). The bare
  // /qr URL is a titled page.
  const qrSrc = `/events/${event.id}/qr?format=png`;
  // Built from the verified token (loader), never the address bar: the loader
  // strips ?admin= from the URL, so copying the current URL would lose it.
  const adminLink = adminToken
    ? `${origin}/events/${event.id}?admin=${encodeURIComponent(adminToken)}`
    : publicLink;
  const calendarSlot = useMemo(
    () => pickCalendarSlot(slots, event.winningSlotId),
    [slots, event.winningSlotId]
  );
  const icsHref =
    isAdmin && adminToken
      ? `/events/${event.id}/ics?admin=${encodeURIComponent(adminToken)}`
      : `/events/${event.id}/ics`;
  const googleCalendarHref = useMemo(() => {
    return buildGoogleCalendarUrl({
      title: event.title,
      description: event.description,
      location: event.location,
      eventDate: calendarSlot ? effectiveDateForSlot(calendarSlot, event.eventDate) : event.eventDate,
      startTime: calendarSlot?.startTime ?? null,
      endTime: calendarSlot?.endTime ?? null,
      timeZone: organizerTzOf(event as { timezone?: string | null }),
      url: origin ? `${origin}/events/${event.id}` : null,
      fallbackTitle: `${siteName} Event`,
    });
  }, [event.title, event.description, event.location, event.eventDate, event.id, event.timezone, calendarSlot, origin, siteName]);

  // Timezones: organizer-selected (server data, SSR-safe) + viewer-local
  // (client-only, null until mounted — no hydration mismatch).
  const organizerTz = useMemo(
    () => organizerTzOf(event as { timezone?: string | null }),
    [(event as { timezone?: string | null }).timezone]
  );
  const viewerTz = useViewerTimezone();
  const showViewerTz = Boolean(viewerTz && viewerTz !== organizerTz);
  const headerTzAt = useMemo(() => {
    const date = calendarSlot
      ? effectiveDateForSlot(calendarSlot, event.eventDate)
      : event.eventDate;
    const start = calendarSlot?.startTime ?? null;
    if (date && start) return zonedWallTimeToUtc(date, start, organizerTz);
    const firstTimed = slots.find((s) => {
      const d = ((s as { slotDate?: string | null }).slotDate || event.eventDate) as string | null;
      return d && s.startTime ? zonedWallTimeToUtc(d, s.startTime, organizerTz) : null;
    });
    if (firstTimed) {
      const d =
        ((firstTimed as { slotDate?: string | null }).slotDate || event.eventDate) as string | null;
      if (d && firstTimed.startTime) return zonedWallTimeToUtc(d, firstTimed.startTime, organizerTz);
    }
    return null;
  }, [calendarSlot, event.eventDate, slots, organizerTz]);

  // Live-sync badge: SSR-safe (no Date.now() in render — lastSyncedAt is only
  // ever set client-side after a poll resolves, so server HTML matches).
  const syncing = pollFetcher.state !== "idle";
  const liveBadgeTitle = lastSyncedAt
    ? `Auto-updates every few seconds. Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}.`
    : "Auto-updates every few seconds while this tab is visible.";
  const liveBadge = (
    <span
      title={liveBadgeTitle}
      aria-live="off"
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full"
    >
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${syncing ? "animate-ping" : "animate-pulse"}`}
        />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      Live{syncing ? " · syncing…" : ""}
    </span>
  );

  // Sticky nav summary (same as create screens): once the event header card
  // scrolls under the nav, show readonly info in the global header.
  // TIME_POLL has no event date — title only. SIGNUP_SHEET shows title + date.
  const stickyDate = event.type === "TIME_POLL" ? "" : event.eventDate || "";
  const titleSentinelRef = useRef<HTMLDivElement>(null);
  useCreateStickyHeader(event.title || "", stickyDate, titleSentinelRef);

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
                  value={publicLink}
                  className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono text-slate-600 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      publicLink,
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
                  value={adminLink}
                  className="w-full bg-white px-3 py-2 rounded-xl border border-amber-200 text-xs font-mono text-amber-800 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(adminLink, "admin")
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
      {/* Floating toast notification — always visible regardless of scroll.
          Success confirmations (e.g. "Your spot has been confirmed") and
          errors from any form action surface here; inline errors below are
          kept as a persistent fallback. */}
      {toast && (
        <div
          key={toast.key}
          role={toast.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`fixed bottom-6 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md p-4 rounded-2xl border shadow-lg flex items-center gap-2.5 text-sm font-semibold animate-toast-in ${
            toast.kind === "error"
              ? "bg-rose-50 border-rose-200/80 text-rose-800"
              : "bg-green-50 border-green-200/80 text-green-800"
          }`}
        >
          {toast.kind === "error" ? (
            <TriangleAlert className="w-4 h-4 shrink-0" />
          ) : (
            <CircleCheck className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {actionData?.error && !needsHumanCheck && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-sm font-semibold flex items-center gap-2.5 animate-fade-in">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span>{actionData.error}</span>
        </div>
      )}

      {/* Event Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-5">
        <div className="min-w-0 flow-root">
          {qrHidden ? null : (
          <a
            href={`/events/${event.id}/qr`}
            title="Open QR code"
            className="float-right ml-3 mb-3"
          >
            <img
              src={qrSrc}
              alt={`QR code for ${event.title} — scan to open this event`}
              title="Scan to open this event"
              width={104}
              height={104}
              loading="lazy"
              onError={() => setQrHidden(true)}
              className="block w-[88px] h-[88px] sm:w-[104px] sm:h-[104px] rounded-2xl border border-slate-200 bg-white p-1 shadow-sm"
            />
          </a>
          )}
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
            {/* TIME_POLL has no event date — options carry their own days. */}
            {event.type !== "TIME_POLL" && event.eventDate && (
              <span
                title={
                  showViewerTz
                    ? `All times on this page are listed in the organizer's timezone (${organizerTz}).`
                    : undefined
                }
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100/90 px-3 py-1.5 rounded-full border border-slate-200/80"
              >
                <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
                {new Date(event.eventDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                {showViewerTz ? ` · ${organizerTzLabel(organizerTz, headerTzAt)}` : ""}
              </span>
            )}
            {(event.type === "TIME_POLL" || !event.eventDate) && showViewerTz && viewerTz && (
              <span
                title={`All times on this page are listed in the organizer's timezone (${organizerTz}).`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100/90 px-3 py-1.5 rounded-full border border-slate-200/80"
              >
                <Globe className="w-3.5 h-3.5 text-slate-500" />
                Event time: {organizerTzLabel(organizerTz, headerTzAt)}
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
            {showViewerTz && viewerTz && (
              <span
                title="Your local timezone — converted times appear under each option."
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-200/80"
              >
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                Your time: {organizerTzLabel(viewerTz, headerTzAt)} — converted below
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 pt-0.5">
            Anyone with the link can see names/notes. Organizer can delete anytime below.
          </p>
        </div>
        </div>

        {/* Quick Action Buttons — 2-column grid to avoid sidebar blank space */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() =>
              copyToClipboard(
                publicLink,
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

      {/* Sentinel: show title (+ date for sign-up sheets) in nav header once the event header scrolls out of view */}
      <div ref={titleSentinelRef} aria-hidden="true" className="h-px w-full" />

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
              {event.type === "TIME_POLL" ? (
                <div>
                  <label htmlFor="edit-timezone" className="block text-xs font-semibold text-slate-700 mb-1.5">Timezone</label>
                  <EditTimezoneField initial={(event as { timezone?: string | null }).timezone || "UTC"} />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Date</label>
                  <DatePicker
                    name="eventDate"
                    defaultValue={event.eventDate || ""}
                  />
                </div>
              )}
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
            {event.type === "TIME_POLL" ? (
              <div className="space-y-2">
                {/* Header shares the row grid template so Day/Start/Ends/Label line up — same as create/poll. */}
                {(event as { durationMinutes?: number | null }).durationMinutes === null ? (
                  <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_148px] sm:gap-3 sm:px-3 text-[10px] uppercase font-bold tracking-wide text-slate-400">
                    <span>Day *</span>
                    <span>Label</span>
                    <span />
                  </div>
                ) : (
                  <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.45fr)_132px_104px_minmax(0,1fr)_148px] sm:gap-3 sm:px-3 text-[10px] uppercase font-bold tracking-wide text-slate-400">
                    <span>Day *</span>
                    <span>Start *</span>
                    <span>Ends</span>
                    <span>Label</span>
                    <span />
                  </div>
                )}
                {slots.map((s) => (
                  <PollTimeOptionRow
                    key={s.id}
                    slot={s as { id: string; title: string; slotDate?: string | null; startTime?: string | null; endTime?: string | null }}
                    durationMinutes={(event as { durationMinutes?: number | null }).durationMinutes ?? null}
                    adminToken={adminToken}
                    isSubmitting={isSubmitting}
                  />
                ))}
              </div>
            ) : (
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
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Task *</label>
                      <input
                        type="text"
                        name="slotTitle"
                        required
                        defaultValue={s.title}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      />
                    </div>
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
            )}

            {/* Add new slot */}
            {event.type === "TIME_POLL" ? (
              <PollTimeNewOptionRow
                durationMinutes={(event as { durationMinutes?: number | null }).durationMinutes ?? null}
                adminToken={adminToken}
                isSubmitting={isSubmitting}
              />
            ) : (
            <Form
              method="post"
              className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-end bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 transition-all"
            >
              <input type="hidden" name="intent" value="add_slot" />
              <input type="hidden" name="adminToken" value={adminToken || ""} />
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
                <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Shift (opt.)</label>
                    <input
                      type="text"
                      name="slotShiftName"
                      placeholder="e.g. Morning"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                    />
                  </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">New task</label>
                  <input
                    type="text"
                    name="slotTitle"
                    placeholder="e.g. Setup crew"
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
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] shrink-0 disabled:opacity-50"
              >
                + Add Option
              </button>
            </Form>
            )}
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
            <h2 className="text-xl font-bold text-slate-900 tracking-tight inline-flex items-center gap-2">
              Available Shifts & Tasks
              {liveBadge}
            </h2>
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
                      <p className="text-xs text-slate-500 inline-flex items-start gap-1.5 font-semibold">
                        <Clock className="w-3.5 h-3.5 mt-px shrink-0" />
                        <DualSlotTime
                          organizerTz={organizerTz}
                          viewerTz={viewerTz}
                          date={event.eventDate}
                          startTime={group.startTime}
                          endTime={group.endTime}
                        />
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
            <div className="bg-gradient-to-r from-blue-50/70 to-indigo-50/70 border border-blue-200/80 rounded-2xl px-4 py-3 sm:px-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
              <div className="space-y-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 uppercase tracking-wider">
                  <Star className="w-3.5 h-3.5" /> Consensus Leader
                </div>
                {(() => {
                  const dayLabel = slotDayLabel[topSlot.slot.id] || "Undated";
                  const timeLabel =
                    topSlot.slot.startTime || topSlot.slot.endTime
                      ? `${formatTime(topSlot.slot.startTime)}${topSlot.slot.endTime ? ` – ${formatTime(topSlot.slot.endTime)}` : ""}`
                      : "All day";
                  const autoTitle = `${dayLabel} · ${timeLabel}`;
                  const rawTitle = (topSlot.slot.title || "").trim();
                  const customLabel = rawTitle && rawTitle !== autoTitle ? topSlot.slot.title : "";
                  return (
                    <>
                      <div className="text-base font-extrabold text-slate-900 leading-snug">
                        {dayLabel} ·{" "}
                        <span className="text-blue-700">
                          <DualSlotTime
                            organizerTz={organizerTz}
                            viewerTz={viewerTz}
                            date={(topSlot.slot as { slotDate?: string | null }).slotDate || event.eventDate}
                            startTime={topSlot.slot.startTime}
                            endTime={topSlot.slot.endTime}
                          />
                        </span>
                      </div>
                      {customLabel && <div className="text-xs text-slate-500 truncate">{customLabel}</div>}
                    </>
                  );
                })()}
                <div className="text-xs text-slate-600">
                  {topSlot.tally.yes} available • {topSlot.tally.maybe} maybe
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
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>
                    {pollData.votes.length} {pollData.votes.length === 1 ? "response" : "responses"} so far
                  {event.status !== "FINALIZED" && (
                    <span className="hidden sm:inline"> · Tap a cell to cycle No → Yes → Maybe</span>
                  )}
                  {event.status !== "FINALIZED" && (
                    <span className="sm:hidden"> · Tap an option below</span>
                  )}
                  </span>
                  {liveBadge}
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
                    Email <span className="font-normal text-slate-400">(recommended, for edit link)</span>
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
                {ownVote ? (
                  <p className="text-[11px] text-slate-500 sm:col-span-2">
                    {`You're updating your previous vote as ${ownVote.participantName}.`}
                  </p>
                ) : actionData?.error?.includes("That name already") ? (
                  <p className="text-[11px] text-slate-500 sm:col-span-2">
                    Names must be unique: if your name is taken, use e.g. &quot;John S.&quot;
                  </p>
                ) : null}
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
                  <div key={s.id} className={`px-3 py-2 space-y-1.5 ${isWinning ? "bg-purple-50/50" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-x-1.5 gap-y-1 min-w-0 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
                          {dayLabel}
                        </span>
                        <span className="font-bold text-slate-900 text-sm leading-tight">
                          <DualSlotTime
                            organizerTz={organizerTz}
                            viewerTz={viewerTz}
                            date={(s as { slotDate?: string | null }).slotDate || event.eventDate}
                            startTime={s.startTime}
                            endTime={s.endTime}
                          />
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-px rounded-full shrink-0">
                          <Check className="w-3 h-3" /> {t.yes} Yes
                        </span>
                        {t.maybe > 0 && (
                          <span className="inline-flex items-center text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-px rounded-full shrink-0">
                            +{t.maybe}
                          </span>
                        )}
                        {isTop && pollData.votes.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-px rounded-full shrink-0">
                            <Star className="w-3 h-3" /> Leader
                          </span>
                        )}
                        {isWinning && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-purple-800 bg-purple-100 border border-purple-200 px-1.5 py-px rounded-full shrink-0">
                            <Trophy className="w-3 h-3" /> Final
                          </span>
                        )}
                      </div>
                      {customLabel && (
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">{customLabel}</div>
                      )}
                    </div>

                    {event.status !== "FINALIZED" ? (
                      <div
                        role="group"
                        aria-label={`Your availability for ${slotDayLabel[s.id]} ${timeLabel}`}
                        className="grid grid-cols-3 gap-1.5"
                      >
                        <button
                          type="button"
                          aria-pressed={cur === "YES"}
                          onClick={() => setSlotVote(s.id, "YES")}
                          className={`min-h-[36px] rounded-xl border font-bold text-xs transition-all active:scale-[0.97] inline-flex items-center justify-center gap-1 ${
                            cur === "YES"
                              ? "bg-green-600 border-green-600 text-white shadow-sm"
                              : "bg-white border-slate-200 text-slate-500 hover:border-green-400 hover:text-green-700"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          Yes
                        </button>
                        <button
                          type="button"
                          aria-pressed={cur === "MAYBE"}
                          onClick={() => setSlotVote(s.id, "MAYBE")}
                          className={`min-h-[36px] rounded-xl border font-bold text-xs transition-all active:scale-[0.97] inline-flex items-center justify-center gap-1 ${
                            cur === "MAYBE"
                              ? "bg-amber-400 border-amber-400 text-slate-900 shadow-sm"
                              : "bg-white border-slate-200 text-slate-500 hover:border-amber-400 hover:text-amber-700"
                          }`}
                        >
                          <span className="text-xs leading-none font-extrabold">~</span>
                          <span>Maybe</span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={cur === "NO"}
                          onClick={() => setSlotVote(s.id, "NO")}
                          className={`min-h-[36px] rounded-xl border font-bold text-xs transition-all active:scale-[0.97] inline-flex items-center justify-center gap-1 ${
                            cur === "NO"
                              ? "bg-slate-800 border-slate-800 text-white shadow-sm"
                              : "bg-white border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700"
                          }`}
                        >
                          <X className="w-3.5 h-3.5" />
                          No
                        </button>
                      </div>
                    ) : null}

                    {(yesVoters.length > 0 || maybeVoters.length > 0) && (
                      <details className="text-[11px] text-slate-500">
                        <summary className="cursor-pointer font-semibold text-slate-600 py-1 flex items-center">
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
                                {vYes} Yes · {Object.values(v.responses).filter((r) => r === "MAYBE").length} Maybe
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
                            <DualSlotTime
                              organizerTz={organizerTz}
                              viewerTz={viewerTz}
                              date={(s as { slotDate?: string | null }).slotDate || event.eventDate}
                              startTime={s.startTime}
                              endTime={s.endTime}
                              className="inline-block"
                            />
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
                            ? `${yesCount} Yes${maybeCount ? ` · ${maybeCount} Maybe` : ""}`
                            : "Tap a cell to vote"}
                        </div>
                      </td>

                      {slots.map((s) => {
                        const cur = userVotes[s.id] || "NO";
                        const label = cur === "YES" ? "Yes" : cur === "MAYBE" ? "Maybe" : "No";
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
                      Total Yes / (Maybe)
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
                    <span>Maybe</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-lg border border-slate-300 bg-slate-800 text-white inline-flex items-center justify-center"><X className="w-3 h-3" /></span>
                    <span>Unavailable</span>
                  </span>
                  {(yesCount > 0 || maybeCount > 0) && (
                    <span className="font-bold text-slate-700">
                      You: {yesCount} Yes{maybeCount ? ` · ${maybeCount} Maybe` : ""}
                    </span>
                  )}
                </div>

                <Form
                  method="post"
                  className="flex flex-col gap-3 sm:items-end"
                  onSubmit={(e) => {
                    if (!voterName.trim()) {
                      e.preventDefault();
                      document.getElementById("voter-name")?.focus();
                      alert("Please enter your name first!");
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="vote_poll" />
                  <input type="hidden" name="clientVoteId" value={clientVoteId || ""} />
                  <input type="hidden" name="clientVoteToken" value={clientVoteToken || ""} />
                  <input type="hidden" name="participantName" value={voterName} />
                  <input type="hidden" name="participantEmail" value={voterEmail} />
                  <input type="hidden" name="formStartedAt" value={pageLoadedAt} />
                  {/* Honeypot: humans never see it, bots autofill it. */}
                  <div className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden" aria-hidden="true">
                    <label>
                      Company website (leave blank)
                      <input type="text" name="company_website" autoComplete="off" tabIndex={-1} />
                    </label>
                  </div>

                  {slots.map((s) => (
                    <input
                      key={s.id}
                      type="hidden"
                      name={`slot_${s.id}`}
                      value={userVotes[s.id] || "NO"}
                    />
                  ))}

                  {needsHumanCheck && (
                    <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right">
                      Lots of activity from your network — one quick check, then you&apos;re through.
                    </p>
                  )}
                  {actionData?.error && (
                    <p
                      role="alert"
                      className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 sm:max-w-sm sm:text-right"
                    >
                      {actionData.error}
                    </p>
                  )}
                  {/* Success confirmations surface via the floating toast (always visible). */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3">
                    {needsHumanCheck && turnstileSiteKey && (
                      <div className="flex justify-end sm:items-center [&:empty]:hidden [&:has(.cf-turnstile:empty)]:hidden">
                        <Turnstile siteKey={turnstileSiteKey} action="poll-vote" resetKey={navigation.state} />
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full sm:w-auto min-h-[52px] px-7 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? "Saving..." : <>{ownVote ? "Update My Availability" : "Save My Availability"} <ArrowRight className="w-4 h-4" /></>}
                    </button>
                  </div>
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

            <Form method="post" className="space-y-4 text-xs">
              <input type="hidden" name="intent" value="signup" />
              <input type="hidden" name="slotId" value={selectedSlotForSignup.id} />
              <input type="hidden" name="formStartedAt" value={pageLoadedAt} />
              {/* Honeypot: humans never see it, bots autofill it. */}
              <div className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden" aria-hidden="true">
                <label>
                  Company website (leave blank)
                  <input type="text" name="company_website" autoComplete="off" tabIndex={-1} />
                </label>
              </div>

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
                  Your Email (Recommended, for calendar invite & edit link)
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

              {needsHumanCheck && actionData?.error && (
                <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {actionData.error}
                </p>
              )}
              {needsHumanCheck && turnstileSiteKey && (
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
