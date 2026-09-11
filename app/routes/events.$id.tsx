import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, useNavigation, useSearchParams, Form } from "@remix-run/react";
import { eq, and } from "drizzle-orm";
import { useState, useMemo } from "react";
import { getDb, events, eventSlots, signups, pollVotes, pollVoteEntries } from "~/db";
import { sendEmail } from "~/utils/email";

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database; RESEND_API_KEY?: string };
  const db = getDb(env.DB);
  const eventId = params.id;

  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  // Fetch event
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw new Response("Event not found", { status: 404 });
  }

  // Check admin access
  const url = new URL(request.url);
  const adminTokenQuery = url.searchParams.get("admin");
  const isAdmin = Boolean(adminTokenQuery && adminTokenQuery === event.adminToken);

  // Fetch slots
  const slots = await db
    .select()
    .from(eventSlots)
    .where(eq(eventSlots.eventId, eventId))
    .orderBy(eventSlots.displayOrder);

  if (event.type === "SIGNUP_SHEET") {
    // Fetch signups
    const eventSignups = await db
      .select()
      .from(signups)
      .where(and(eq(signups.eventId, eventId), eq(signups.status, "CONFIRMED")));

    return json({
      event,
      slots,
      signups: eventSignups,
      isAdmin,
      adminToken: isAdmin ? event.adminToken : null,
      pollData: null,
    });
  } else {
    // TIME_POLL: Fetch votes and entries
    const votes = await db.select().from(pollVotes).where(eq(pollVotes.eventId, eventId));
    const entries = await db
      .select({
        id: pollVoteEntries.id,
        pollVoteId: pollVoteEntries.pollVoteId,
        slotId: pollVoteEntries.slotId,
        response: pollVoteEntries.response,
      })
      .from(pollVoteEntries);

    // Map votes with their entry responses
    const votesWithResponses = votes.map((v) => {
      const vEntries = entries.filter((e) => e.pollVoteId === v.id);
      const responses: Record<string, string> = {};
      vEntries.forEach((e) => {
        responses[e.slotId] = e.response;
      });
      return {
        id: v.id,
        participantName: v.participantName,
        participantEmail: v.participantEmail,
        editToken: v.editToken,
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

    return json({
      event,
      slots,
      signups: [],
      isAdmin,
      adminToken: isAdmin ? event.adminToken : null,
      pollData: {
        votes: votesWithResponses,
        tallies: slotTallies,
      },
    });
  }
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database; RESEND_API_KEY?: string };
  const db = getDb(env.DB);
  const eventId = params.id;

  if (!eventId) {
    return json({ error: "Missing event ID." }, { status: 400 });
  }

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    return json({ error: "Event not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const now = new Date().toISOString();
  const url = new URL(request.url);

  // 1. Volunteer Slot Sign Up
  if (intent === "signup") {
    const slotId = formData.get("slotId") as string;
    const participantName = (formData.get("participantName") as string)?.trim();
    const participantEmail = (formData.get("participantEmail") as string)?.trim() || null;
    const comment = (formData.get("comment") as string)?.trim() || "";

    if (!slotId || !participantName) {
      return json({ error: "Name is required to sign up." }, { status: 400 });
    }

    // Check capacity
    const [targetSlot] = await db.select().from(eventSlots).where(eq(eventSlots.id, slotId)).limit(1);
    if (!targetSlot) {
      return json({ error: "Slot not found." }, { status: 404 });
    }

    const currentSignups = await db
      .select()
      .from(signups)
      .where(and(eq(signups.slotId, slotId), eq(signups.status, "CONFIRMED")));

    if (targetSlot.capacity > 0 && currentSignups.length >= targetSlot.capacity) {
      return json({ error: "Sorry, this slot just filled up!" }, { status: 400 });
    }

    const signupId = crypto.randomUUID();
    const editToken = crypto.randomUUID();

    await db.insert(signups).values({
      id: signupId,
      slotId,
      eventId,
      participantName,
      participantEmail,
      editToken,
      customFields: JSON.stringify({ comment }),
      status: "CONFIRMED",
      createdAt: now,
    });

    // Send confirmation email to volunteer if email provided
    if (participantEmail) {
      const cancelUrl = `${url.origin}/events/${eventId}?cancel_token=${editToken}`;
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        to: participantEmail,
        subject: `Confirmed: "${targetSlot.title}" for ${event.title}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
            <h2 style="color: #0f172a; margin-top: 0;">You're signed up! 🎉</h2>
            <p>Hi ${participantName},</p>
            <p>You have secured your spot for <strong>${targetSlot.title}</strong> at <strong>${event.title}</strong>.</p>
            ${event.location ? `<p><strong>Location:</strong> ${event.location}</p>` : ""}
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin: 24px 0;">
              <p style="margin: 0 0 10px 0; font-size: 13px;"><strong>Need to cancel?</strong></p>
              <a href="${cancelUrl}" style="color: #dc2626; font-size: 13px;">Cancel this sign-up</a>
            </div>
            <p><a href="${url.origin}/events/${eventId}/ics" style="color: #2563eb;">📥 Download Calendar Invite (.ics)</a></p>
            <p style="margin-top: 24px; font-weight: 600;">— ManyMano</p>
          </div>
        `,
      });
    }

    return json({ success: true, message: `Thank you ${participantName}! Your spot has been confirmed.` });
  }

  // 2. Cancel Signup
  if (intent === "cancel_signup") {
    const signupId = formData.get("signupId") as string;
    const adminToken = formData.get("adminToken") as string;
    const editToken = formData.get("editToken") as string;

    const [existing] = await db.select().from(signups).where(eq(signups.id, signupId)).limit(1);
    if (!existing) {
      return json({ error: "Signup entry not found." }, { status: 404 });
    }

    const isAuthorized =
      (adminToken && adminToken === event.adminToken) ||
      (editToken && editToken === existing.editToken);

    if (!isAuthorized) {
      return json({ error: "Unauthorized to cancel this signup." }, { status: 403 });
    }

    await db.delete(signups).where(eq(signups.id, signupId));
    return json({ success: true, message: "Signup cancelled." });
  }

  // 3. Meeting Poll Vote
  if (intent === "vote_poll") {
    const participantName = (formData.get("participantName") as string)?.trim();
    const participantEmail = (formData.get("participantEmail") as string)?.trim() || null;

    if (!participantName) {
      return json({ error: "Your name is required to vote." }, { status: 400 });
    }

    const voteId = crypto.randomUUID();
    const editToken = crypto.randomUUID();

    await db.insert(pollVotes).values({
      id: voteId,
      eventId,
      participantName,
      participantEmail,
      editToken,
      createdAt: now,
      updatedAt: now,
    });

    const slots = await db.select().from(eventSlots).where(eq(eventSlots.eventId, eventId));
    for (const s of slots) {
      const resp = (formData.get(`slot_${s.id}`) as string) || "NO";
      if (resp === "YES" || resp === "MAYBE") {
        await db.insert(pollVoteEntries).values({
          id: crypto.randomUUID(),
          pollVoteId: voteId,
          slotId: s.id,
          response: resp,
        });
      }
    }

    return json({ success: true, message: `Availability recorded for ${participantName}!` });
  }

  // 4. Finalize Poll
  if (intent === "finalize_poll") {
    const adminToken = formData.get("adminToken") as string;
    const winningSlotId = formData.get("winningSlotId") as string;

    if (adminToken !== event.adminToken) {
      return json({ error: "Unauthorized." }, { status: 403 });
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

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function EventView() {
  const { event, slots, signups: initialSignups, isAdmin, adminToken, pollData } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; message?: string; error?: string }>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const justCreated = Boolean(searchParams.get("created"));
  const [selectedSlotForSignup, setSelectedSlotForSignup] = useState<{ id: string; title: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Active poll vote states for interactive row: Record<slotId, 'NO' | 'YES' | 'MAYBE'>
  const [userVotes, setUserVotes] = useState<Record<string, "NO" | "YES" | "MAYBE">>({});

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

  const copyToClipboard = (text: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedLink(label);
      setTimeout(() => setCopiedLink(null), 2500);
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

  return (
    <div className="space-y-10 py-2">
      {/* Event Created Banner with 1-Click Copy Links */}
      {justCreated && isAdmin && (
        <div className="bg-white border-2 border-emerald-500/80 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg font-bold">
              🎉
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
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shrink-0 transition-colors shadow-sm"
                >
                  {copiedLink === "public" ? "Copied! ✓" : "Copy"}
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
                  className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shrink-0 transition-colors shadow-sm"
                >
                  {copiedLink === "admin" ? "Copied! ✓" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Notification */}
      {actionData?.message && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-sm font-semibold flex items-center gap-2.5 animate-fade-in">
          <span>✓</span>
          <span>{actionData.message}</span>
        </div>
      )}
      {actionData?.error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-sm font-semibold flex items-center gap-2.5 animate-fade-in">
          <span>⚠️</span>
          <span>{actionData.error}</span>
        </div>
      )}

      {/* Event Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                {event.type === "SIGNUP_SHEET" ? "Volunteer Sign-Up Sheet" : "Meeting Availability Poll"}
              </span>
              <span
                className={`text-xs px-3 py-1 rounded-full font-semibold border ${
                  event.status === "FINALIZED"
                    ? "bg-purple-50 text-purple-700 border-purple-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                {event.status === "FINALIZED" ? "Meeting Finalized 🎯" : "Open for Responses"}
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              {event.title}
            </h1>

            {event.description && (
              <p className="text-sm text-slate-600 max-w-2xl leading-relaxed whitespace-pre-wrap font-normal">
                {event.description}
              </p>
            )}

            <div className="flex flex-wrap gap-5 pt-1 text-xs text-slate-500">
              {event.location && (
                <div className="flex items-center gap-1.5">
                  <span>📍</span>
                  <span className="font-semibold text-slate-700">{event.location}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span>👤</span>
                <span>Organized by: <strong className="text-slate-800">{event.organizerName}</strong></span>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap md:flex-col gap-2.5 shrink-0 pt-1">
            <button
              type="button"
              onClick={() =>
                copyToClipboard(
                  `${typeof window !== "undefined" ? window.location.origin : ""}/events/${event.id}`,
                  "share"
                )
              }
              className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-slate-700 transition-all shadow-sm flex items-center justify-center gap-2 hover:bg-slate-50"
            >
              <span>🔗</span>
              <span>{copiedLink === "share" ? "Link Copied! ✓" : "Share Link"}</span>
            </button>

            <a
              href={`/events/${event.id}/ics`}
              download
              className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-blue-200/80 bg-blue-50/50 hover:bg-blue-50 text-blue-700 transition-all shadow-sm flex items-center justify-center gap-2"
            >
              <span>📅</span>
              <span>Add to Calendar (.ics)</span>
            </a>

            {isAdmin && (
              <a
                href={`/events/${event.id}/export`}
                download
                className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-all shadow-sm flex items-center justify-center gap-2"
              >
                <span>📥</span>
                <span>Export CSV Roster</span>
              </a>
            )}
          </div>
        </div>

        {/* Admin Bar */}
        {isAdmin && (
          <div className="pt-5 border-t border-dashed border-amber-200/90 bg-amber-50/40 -mx-8 -mb-8 sm:-mx-10 sm:-mb-10 p-6 sm:p-8 rounded-b-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs font-bold text-amber-900">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
              <span>Organizer Admin Mode Active</span>
            </div>
            <span className="text-xs text-amber-700/90">
              You are viewing with your private admin token. You can cancel entries and finalize options.
            </span>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* SECTION 1: VOLUNTEER SIGNUP SHEET VIEW                                */}
      {/* ===================================================================== */}
      {event.type === "SIGNUP_SHEET" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Available Slots & Roles</h2>
            <span className="text-xs font-medium text-slate-500">
              {initialSignups.length} confirmed {initialSignups.length === 1 ? "signup" : "signups"}
            </span>
          </div>

          <div className="space-y-5">
            {slots.map((slot) => {
              const slotSignups = initialSignups.filter((s) => Boolean(s && s.slotId === slot.id));
              const isFull = slot.capacity > 0 && slotSignups.length >= slot.capacity;
              const spotsLeft = slot.capacity > 0 ? slot.capacity - slotSignups.length : 999;
              const fillPercent =
                slot.capacity > 0 ? Math.min(100, Math.round((slotSignups.length / slot.capacity) * 100)) : 0;

              return (
                <div
                  key={slot.id}
                  className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.05)] transition-all space-y-6"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-2 max-w-xl">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-bold text-lg text-slate-900">{slot.title}</h3>
                        {slot.capacity > 0 ? (
                          <span
                            className={`text-xs px-3 py-1 rounded-full font-semibold border ${
                              isFull
                                ? "bg-slate-100 text-slate-500 border-slate-200"
                                : spotsLeft <= 1
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
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

                      {(slot.startTime || slot.endTime) && (
                        <p className="text-xs text-slate-500">
                          ⏰ {slot.startTime} {slot.endTime ? `– ${slot.endTime}` : ""}
                        </p>
                      )}

                      {/* Visual capacity progress bar */}
                      {slot.capacity > 0 && (
                        <div className="w-48 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
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
                      onClick={() => setSelectedSlotForSignup({ id: slot.id, title: slot.title })}
                      className={`px-6 py-3 rounded-2xl text-xs font-bold transition-all shadow-sm shrink-0 ${
                        isFull
                          ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                          : "bg-blue-600 text-white hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98]"
                      }`}
                    >
                      {isFull ? "Full" : "Sign Up →"}
                    </button>
                  </div>

                  {/* Confirmed Roster Container */}
                  <div className="bg-[#fafafc] rounded-2xl p-4 sm:p-5 border border-slate-100">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                      Confirmed Attendees ({slotSignups.length} {slot.capacity > 0 ? `of ${slot.capacity}` : ""})
                    </div>

                    {slotSignups.length === 0 ? (
                      <div className="text-xs text-slate-400 italic py-1">
                        No one has signed up for this slot yet. Claim the first spot!
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
                                    title="Cancel volunteer entry"
                                    className="text-slate-400 hover:text-rose-600 text-xs px-1 font-bold transition-colors"
                                  >
                                    ✕
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
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SECTION 2: MEETING TIME FINDER (Classic Doodle Matrix)                 */}
      {/* ===================================================================== */}
      {event.type === "TIME_POLL" && pollData && (
        <div className="space-y-6">
          {/* Top Consensus Winner Banner */}
          {topSlot && (
            <div className="bg-gradient-to-r from-blue-50/70 to-indigo-50/70 border border-blue-200/80 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-sm">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 text-xs font-bold text-blue-700 uppercase tracking-wider">
                  <span>⭐ Consensus Leader</span>
                </div>
                <div className="text-xl font-extrabold text-slate-900">{topSlot.slot.title}</div>
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
                    className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-2xl shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Lock This Time as Final Meeting 🎯
                  </button>
                </Form>
              )}
            </div>
          )}

          {/* Matrix Grid Card */}
          <div className="bg-white border border-slate-200/80 rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-slate-700 font-bold">
                    <th className="p-4 sm:p-5 w-52 min-w-[200px] sticky left-0 bg-slate-50 border-r border-slate-200/80">
                      Participants ({pollData.votes.length})
                    </th>
                    {slots.map((s) => {
                      const isWinning = event.winningSlotId === s.id;
                      return (
                        <th
                          key={s.id}
                          className={`p-4 text-center border-r border-slate-200/80 min-w-[150px] ${
                            isWinning ? "bg-purple-50/60 text-purple-900" : ""
                          }`}
                        >
                          <div className="font-bold text-slate-900">{s.title}</div>
                          {isWinning && (
                            <span className="inline-block mt-1 text-[10px] px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold">
                              Selected Meeting Time 🏆
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
                        {v.participantName}
                      </td>
                      {slots.map((s) => {
                        const resp = v.responses[s.id] || "NO";
                        return (
                          <td key={s.id} className="p-3 text-center border-r border-slate-100">
                            {resp === "YES" && (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-emerald-500 text-white font-bold text-sm shadow-sm">
                                ✔
                              </span>
                            )}
                            {resp === "MAYBE" && (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-amber-400 text-slate-900 font-bold text-xs shadow-sm">
                                (✔)
                              </span>
                            )}
                            {resp === "NO" && (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 text-slate-400 font-bold text-xs">
                                –
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Active Voting Row */}
                  {event.status !== "FINALIZED" && (
                    <tr className="bg-blue-50/30 border-t-2 border-blue-400/80">
                      <td className="p-4 sticky left-0 bg-blue-50/70 border-r border-slate-200/80 space-y-2">
                        <input
                          id="new-voter-name"
                          type="text"
                          required
                          placeholder="Your Name *"
                          className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-blue-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                        <input
                          id="new-voter-email"
                          type="email"
                          placeholder="Email (optional)"
                          className="w-full text-[11px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </td>

                      {slots.map((s) => {
                        const cur = userVotes[s.id] || "NO";
                        return (
                          <td key={s.id} className="p-3 text-center border-r border-slate-200/80">
                            <button
                              type="button"
                              onClick={() => cycleSlotVote(s.id)}
                              className={`w-9 h-9 rounded-xl font-bold text-xs transition-all shadow-sm ${
                                cur === "YES"
                                  ? "bg-emerald-500 text-white scale-105"
                                  : cur === "MAYBE"
                                  ? "bg-amber-400 text-slate-900 scale-105"
                                  : "bg-white border border-slate-300 hover:border-blue-500 text-slate-400"
                              }`}
                            >
                              {cur === "YES" ? "✔" : cur === "MAYBE" ? "(✔)" : "–"}
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
                          {isTop && <span className="ml-1 text-sm">⭐</span>}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Matrix Voting Footer */}
            {event.status !== "FINALIZED" && (
              <div className="p-5 sm:p-6 bg-[#fafafc] border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-lg bg-emerald-500 text-white inline-flex items-center justify-center font-bold text-[10px]">✔</span>
                    <span>Available</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-lg bg-amber-400 text-slate-900 inline-flex items-center justify-center font-bold text-[10px]">(✔)</span>
                    <span>If need be</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-lg border border-slate-300 bg-white text-slate-400 inline-flex items-center justify-center font-bold text-[10px]">–</span>
                    <span>Unavailable</span>
                  </span>
                </div>

                <Form
                  method="post"
                  onSubmit={(e) => {
                    const nameInput = document.getElementById("new-voter-name") as HTMLInputElement;
                    const emailInput = document.getElementById("new-voter-email") as HTMLInputElement;
                    if (!nameInput?.value.trim()) {
                      e.preventDefault();
                      alert("Please enter your name first!");
                      return;
                    }
                    const form = e.currentTarget;
                    const nameField = form.querySelector('input[name="participantName"]') as HTMLInputElement;
                    const emailField = form.querySelector('input[name="participantEmail"]') as HTMLInputElement;
                    if (nameField) nameField.value = nameInput.value;
                    if (emailField) emailField.value = emailInput?.value || "";
                  }}
                >
                  <input type="hidden" name="intent" value="vote_poll" />
                  <input type="hidden" name="participantName" value="" />
                  <input type="hidden" name="participantEmail" value="" />

                  {slots.map((s) => (
                    <input
                      key={s.id}
                      type="hidden"
                      name={`slot_${s.id}`}
                      value={userVotes[s.id] || "NO"}
                    />
                  ))}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full sm:w-auto px-7 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  >
                    {isSubmitting ? "Saving..." : "Save My Availability →"}
                  </button>
                </Form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Volunteer Signup Dialog Modal */}
      {selectedSlotForSignup && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-xl text-slate-900">Claim Volunteer Spot</h3>
              <button
                type="button"
                onClick={() => setSelectedSlotForSignup(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg p-1"
              >
                ✕
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

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedSlotForSignup(null)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-sm transition-colors"
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
