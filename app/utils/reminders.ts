// Day-before reminder emails (see GET /api/reminders).
//
// What is sent, a day before the event/shift:
//   1. Organizer: event details + per-task roster with fill counts
//      ("Setup – 1/3 volunteers", names + emails), so they see at a glance
//      what is covered and what is still open.
//   2. Participants: one reminder per person for their own shift(s) — same
//      details as the signup confirmation email (When/Location/Description,
//      event page, calendar links). Signups without an email address can't
//      be reminded and are skipped.
//   3. Finalized meetings (TIME_POLL with a locked-in winning time dated
//      tomorrow): every voter with an email gets a "tomorrow" reminder with
//      the locked-in time, and the organizer gets the attendee roster.
//      Open polls have no decided date, so they are skipped.
//
// Notes:
// - "Tomorrow" is matched on the UTC calendar day (event dates are stored
//   as organizer-local YYYY-MM-DD days; matching UTC keeps the cron simple
//   and predictable — override with ?date= for testing).
// - Stored edit tokens are hashes, so reminders can't rebuild personal
//   cancel links. They link to the event page instead, where participants
//   can manage their entry.
// - Dedupe lives in the reminder_sends table (one row per event + date +
//   kind). A retried cron run never double-emails.

import { and, eq } from "drizzle-orm";
import {
  events,
  eventSlots,
  signups,
  pollVotes,
  reminderSends,
  type AppDb,
} from "~/db";
import { buildGoogleCalendarUrl, effectiveDateForSlot, formatLongDateLabel } from "./calendar";
import { zonedWallTimeToUtc } from "./timezones";
import { isExpired, RETENTION_DAYS } from "./retention";
import { isValidEmail } from "./validation";
import { escapeHtml } from "./sanitize";
import { emailFooter } from "./email";
import type { SiteConfig } from "./site";

export type ReminderKind = "organizer" | "participants" | "organizer_24h" | "organizer_48h";

/**
 * Pre-v8 dedupe kind for the organizer mail. The scheduled runner checks it
 * as a fallback for organizer_24h so the kind rename can't double-send to
 * events marked under the old name around cutover.
 */
export const LEGACY_ORGANIZER_KIND = "organizer";

/**
 * Reminder hour in the EVENT's timezone (9:00 AM local). Later this becomes
 * a per-event setting defaulting to 9 — callers must go through
 * reminderInstant() so the override plugs in at one place.
 */
export const REMINDER_HOUR = 9;

/** YYYY-MM-DD shifted by N days (UTC calendar arithmetic — DST-safe). */
export function addDaysIso(dateStr: string, days: number): string | null {
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Reject non-days (2026-02-30): Date.UTC rolls over instead of failing.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  const out = new Date(check.getTime() + days * 86400000);
  return out.toISOString().slice(0, 10);
}

/**
 * UTC instant when a reminder fires: 9:00 AM event-local, `daysBefore`
 * days ahead of the event date. Null for bad dates (caller skips).
 * Unknown zones fall back to UTC via zonedWallTimeToUtc.
 */
export function reminderInstant(
  eventDate: string | null | undefined,
  daysBefore: number,
  timeZone: string | null | undefined
): Date | null {
  if (!eventDate) return null;
  const day = addDaysIso(eventDate, -daysBefore);
  if (!day) return null;
  return zonedWallTimeToUtc(day, `${REMINDER_HOUR}:00`, timeZone);
}

/**
 * The calendar day a reminder is keyed to: the event date for sheets,
 * the winning slot's effective date for finalized meetings (it can differ
 * on multi-day polls — keying by eventDate would double-send across the
 * endpoint and cron paths).
 */
export function targetReminderDate(target: ReminderTarget): string | null {
  if (target.kind === "signup_sheet") return target.event.eventDate;
  return effectiveDateForSlot(target.winningSlot, target.event.eventDate);
}

/**
 * True when a sign-up sheet still has open spots in a limited-capacity
 * slot. Unlimited slots (capacity <= 0) can never be understaffed.
 */
export function isUnderstaffed(target: SignupSheetTarget): boolean {
  return target.slots.some((s) => s.capacity > 0 && s.signups.length < s.capacity);
}

/** The event-local day being reminded about (YYYY-MM-DD). */
export function reminderDateString(from = new Date()): string {
  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface ReminderSlotInfo {
  id: string;
  title: string;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
  capacity: number;
  signups: Array<{ name: string; email: string | null }>;
}

export interface ReminderEventInfo {
  id: string;
  title: string;
  description: string | null;
  eventDate: string | null;
  location: string | null;
  organizerName: string;
  organizerEmail: string;
  timezone: string;
}

export interface SignupSheetTarget {
  kind: "signup_sheet";
  event: ReminderEventInfo;
  slots: ReminderSlotInfo[];
}

export interface FinalizedMeetingTarget {
  kind: "finalized_meeting";
  event: ReminderEventInfo;
  winningSlot: {
    id: string;
    title: string;
    slotDate: string | null;
    startTime: string | null;
    endTime: string | null;
  };
  voters: Array<{ name: string; email: string | null }>;
}

export type ReminderTarget = SignupSheetTarget | FinalizedMeetingTarget;

function toEventInfo(e: typeof events.$inferSelect): ReminderEventInfo {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    eventDate: e.eventDate,
    location: e.location,
    organizerName: e.organizerName,
    organizerEmail: e.organizerEmail,
    timezone: (e.timezone || "").trim() || "UTC",
  };
}

/**
 * Load every event that needs a day-before reminder for `date` (YYYY-MM-DD).
 * Expired events are skipped. Never throws for a missing reminder_sends
 * table — dedupe is checked separately so a pre-migration DB still sends.
 */
export async function collectReminderTargets(
  db: AppDb,
  date: string,
  retentionDays: number = RETENTION_DAYS
): Promise<ReminderTarget[]> {
  const targets: ReminderTarget[] = [];

  // 1. Sign-up sheets dated `date` (dateless sheets can't have a day-before).
  const sheets = await db
    .select()
    .from(events)
    .where(and(eq(events.type, "SIGNUP_SHEET"), eq(events.eventDate, date)));
  for (const e of sheets) {
    if (isExpired(e.createdAt, new Date(), retentionDays)) continue;
    const slots = await db
      .select()
      .from(eventSlots)
      .where(eq(eventSlots.eventId, e.id))
      .orderBy(eventSlots.displayOrder);
    const eventSignups = await db
      .select()
      .from(signups)
      .where(and(eq(signups.eventId, e.id), eq(signups.status, "CONFIRMED")));
    const bySlot = new Map<string, Array<{ name: string; email: string | null }>>();
    for (const s of eventSignups) {
      const list = bySlot.get(s.slotId) ?? [];
      list.push({ name: s.participantName, email: s.participantEmail });
      bySlot.set(s.slotId, list);
    }
    targets.push({
      kind: "signup_sheet",
      event: toEventInfo(e),
      slots: slots.map((s) => ({
        id: s.id,
        title: s.title,
        shiftName: (s as { shiftName?: string | null }).shiftName ?? null,
        startTime: s.startTime,
        endTime: s.endTime,
        capacity: s.capacity ?? 1,
        signups: bySlot.get(s.id) ?? [],
      })),
    });
  }

  // 2. Finalized meeting polls whose winning time falls on `date`.
  const finalized = await db
    .select()
    .from(events)
    .where(and(eq(events.type, "TIME_POLL"), eq(events.status, "FINALIZED")))
    .limit(500);
  for (const e of finalized) {
    if (!e.winningSlotId || isExpired(e.createdAt, new Date(), retentionDays)) continue;
    const slots = await db.select().from(eventSlots).where(eq(eventSlots.eventId, e.id));
    const winning = slots.find((s) => s.id === e.winningSlotId);
    if (!winning) continue;
    if (effectiveDateForSlot(winning, e.eventDate) !== date) continue;
    const votes = await db.select().from(pollVotes).where(eq(pollVotes.eventId, e.id));
    targets.push({
      kind: "finalized_meeting",
      event: toEventInfo(e),
      winningSlot: {
        id: winning.id,
        title: winning.title,
        slotDate: (winning as { slotDate?: string | null }).slotDate ?? null,
        startTime: winning.startTime,
        endTime: winning.endTime,
      },
      voters: votes.map((v) => ({ name: v.participantName, email: v.participantEmail })),
    });
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Dedupe (reminder_sends). Defensive: a DB that hasn't run migration 0006
// has no table — treat as "not sent" and let the mark fail silently (logged),
// so reminders still go out exactly like they would without dedupe.
// ---------------------------------------------------------------------------

export async function isReminderSent(
  db: AppDb,
  eventId: string,
  key: string,
  kind: ReminderKind
): Promise<boolean> {
  try {
    const rows = await db
      .select({ eventId: reminderSends.eventId })
      .from(reminderSends)
      .where(
        and(
          eq(reminderSends.eventId, eventId),
          eq(reminderSends.reminderKey, key),
          eq(reminderSends.kind, kind)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function markReminderSent(
  db: AppDb,
  eventId: string,
  key: string,
  kind: ReminderKind,
  nowIso: string
): Promise<boolean> {
  try {
    await db
      .insert(reminderSends)
      .values({ eventId, reminderKey: key, kind, sentAt: nowIso })
      .onConflictDoNothing();
    return true;
  } catch {
    console.error("[reminders] Could not record reminder send (missing migration?).");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared formatting (mirrors the signup/finalize emails in events.$id.tsx).
// ---------------------------------------------------------------------------

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

function taskLabel(slot: { title: string; shiftName?: string | null }): string {
  const shift = (slot.shiftName || "").trim();
  return shift ? `${shift} – ${slot.title}` : slot.title;
}

/** "Saturday, September 20th, 2026 · 8:00 AM – 10:00 AM" (no timezone — see below). */
export function whenLineFor(args: {
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
}): string {
  // Reminder emails deliberately carry no timezone: the stored date is the
  // organizer-local calendar day and times are wall-clock as entered, so a
  // "City · GMT±HH:MM" suffix adds noise without helping anyone act.
  // (The event page itself still shows the dual organizer/viewer clocks.)
  void args.timezone;
  const whenDatePart = args.eventDate ? formatLongDateLabel(args.eventDate) : "";
  const whenTimePart = args.startTime
    ? `${formatTime(args.startTime)}${args.endTime ? ` – ${formatTime(args.endTime)}` : ""}`
    : args.endTime
      ? formatTime(args.endTime)
      : "";
  return [whenDatePart, whenTimePart].filter(Boolean).join(" · ");
}

/** "1/3 volunteers" (capped slots) or "4 signed up" (unlimited). */
export function fillLabel(filled: number, capacity: number): string {
  if (capacity > 0) {
    const noun = capacity === 1 ? "volunteer" : "volunteers";
    return `${filled}/${capacity} ${noun}`;
  }
  return `${filled} signed up`;
}

function eventPageUrl(origin: string, eventId: string): string {
  return `${origin}/events/${eventId}`;
}

function slotCalendarLinks(opts: {
  site: SiteConfig;
  origin: string;
  event: ReminderEventInfo;
  eventId: string;
  title: string;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
}): { googleUrl: string; icsUrl: string } {
  const googleUrl = buildGoogleCalendarUrl({
    title: opts.title,
    description: opts.event.description,
    location: opts.event.location,
    eventDate: opts.eventDate,
    startTime: opts.startTime,
    endTime: opts.endTime,
    timeZone: opts.event.timezone,
    url: eventPageUrl(opts.origin, opts.eventId),
    fallbackTitle: `${opts.site.siteName} Event`,
  });
  return { googleUrl, icsUrl: `${opts.origin}/events/${opts.eventId}/ics` };
}

function descriptionBlock(description: string | null): string {
  if (!description) return "";
  return `<p><strong>Description:</strong><br>${escapeHtml(description).replace(/\r?\n/g, "<br>")}</p>`;
}

// ---------------------------------------------------------------------------
// 1. Participant shift reminder — same details as the signup confirmation.
// `tasks` are the slots this person signed up for (usually one).
// ---------------------------------------------------------------------------

export interface ParticipantTask {
  label: string;
  whenLine: string;
  googleUrl: string;
  icsUrl: string;
}

export function participantTasksForSignup(
  site: SiteConfig,
  origin: string,
  target: SignupSheetTarget,
  slotIds: string[]
): ParticipantTask[] {
  return slotIds.flatMap((slotId) => {
    const slot = target.slots.find((s) => s.id === slotId);
    if (!slot) return [];
    const label = taskLabel(slot);
    const { googleUrl, icsUrl } = slotCalendarLinks({
      site,
      origin,
      event: target.event,
      eventId: target.event.id,
      title: `${label} — ${target.event.title}`,
      eventDate: target.event.eventDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
    });
    return [
      {
        label,
        whenLine: whenLineFor({
          eventDate: target.event.eventDate,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone: target.event.timezone,
        }),
        googleUrl,
        icsUrl,
      },
    ];
  });
}

/**
 * Group confirmed signups with a usable email address by lowercase email,
 * listing each person's slot ids. Signups without an email are skipped
 * (nothing to send to); invalid addresses are skipped too.
 */
export function groupSignupRecipients(target: SignupSheetTarget): Array<{
  email: string;
  name: string;
  slotIds: string[];
}> {
  const byEmail = new Map<string, { email: string; name: string; slotIds: string[] }>();
  for (const slot of target.slots) {
    for (const s of slot.signups) {
      const email = (s.email || "").trim();
      if (!email || !isValidEmail(email)) continue;
      const key = email.toLowerCase();
      const existing = byEmail.get(key);
      if (existing) {
        if (!existing.slotIds.includes(slot.id)) existing.slotIds.push(slot.id);
      } else {
        byEmail.set(key, { email, name: s.name, slotIds: [slot.id] });
      }
    }
  }
  return [...byEmail.values()];
}

export function buildSignupParticipantEmail(
  site: SiteConfig,
  origin: string,
  target: SignupSheetTarget,
  recipientName: string,
  tasks: ParticipantTask[]
): { subject: string; html: string } {
  const e = target.event;
  const eventUrl = eventPageUrl(origin, e.id);
  const subject =
    tasks.length === 1
      ? `Reminder: "${tasks[0].label}" for ${e.title} is tomorrow`
      : `Reminder: your ${tasks.length} shifts for "${e.title}" are tomorrow`;
  const taskBlocks = tasks
    .map(
      (t) => `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 16px; border-radius: 12px; margin: 12px 0;">
          <p style="margin: 0 0 6px 0;"><strong>${escapeHtml(t.label)}</strong></p>
          ${t.whenLine ? `<p style="margin: 0 0 6px 0; font-size: 13px;"><strong>When:</strong> ${escapeHtml(t.whenLine)}</p>` : ""}
          <p style="margin: 0; font-size: 13px;">
            <a href="${escapeHtml(t.googleUrl)}" style="color: #2563eb;">Add to Google Calendar</a>
            &nbsp;·&nbsp;
            <a href="${escapeHtml(t.icsUrl)}" style="color: #2563eb;">Download .ics (Apple/Outlook)</a>
          </p>
        </div>`
    )
    .join("");
  return {
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-top: 0;">See you tomorrow!</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p>Quick reminder — you're signed up for <strong>${escapeHtml(e.title)}</strong> tomorrow.</p>
        ${taskBlocks}
        ${e.location ? `<p><strong>Location:</strong> ${escapeHtml(e.location)}</p>` : ""}
        ${descriptionBlock(e.description)}
        <p><strong>Event page:</strong> <a href="${escapeHtml(eventUrl)}" style="color: #2563eb;">${escapeHtml(eventUrl)}</a></p>
        <p style="font-size: 13px; color: #64748b;">Need to change your plans? Open the event page to manage your sign-up.</p>
        ${emailFooter(site)}
      </div>
    `,
  };
}

// ---------------------------------------------------------------------------
// 2. Organizer sheet reminder — event details + per-task fill + full roster.
// ---------------------------------------------------------------------------

export function buildSignupOrganizerEmail(
  site: SiteConfig,
  origin: string,
  target: SignupSheetTarget,
  opts?: { horizon?: "24h" | "48h" }
): { subject: string; html: string } {
  const horizon = opts?.horizon ?? "24h";
  const e = target.event;
  const eventUrl = eventPageUrl(origin, e.id);
  let filledTotal = 0;
  let capacityTotal = 0;
  let hasCapped = false;
  let hasUnlimited = false;
  const slotBlocks = target.slots
    .map((slot) => {
      const label = taskLabel(slot);
      const filled = slot.signups.length;
      filledTotal += filled;
      if (slot.capacity > 0) {
        hasCapped = true;
        capacityTotal += slot.capacity;
      } else {
        hasUnlimited = true;
      }
      const when = whenLineFor({
        eventDate: e.eventDate,
        startTime: slot.startTime,
        endTime: slot.endTime,
        timezone: e.timezone,
      });
      const roster =
        slot.signups.length > 0
          ? `<ul style="margin: 6px 0 0 0; padding-left: 20px; font-size: 13px;">${slot.signups
              .map(
                (s) =>
                  `<li>${escapeHtml(s.name)}${s.email ? ` — <a href="mailto:${escapeHtml(s.email)}" style="color: #2563eb;">${escapeHtml(s.email)}</a>` : ` <span style="color: #94a3b8;">(no email)</span>`}</li>`
              )
              .join("")}</ul>`
          : `<p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">No sign-ups yet.</p>`;
      return `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 16px; border-radius: 12px; margin: 12px 0;">
          <p style="margin: 0;"><strong>${escapeHtml(label)}</strong> — ${escapeHtml(fillLabel(filled, slot.capacity))}</p>
          ${when ? `<p style="margin: 4px 0 0 0; font-size: 13px; color: #475569;">${escapeHtml(when)}</p>` : ""}
          ${roster}
        </div>`;
    })
    .join("");
  // Mixed capped + unlimited sheets can't share one meaningful fraction
  // ("4/3 spots filled"), so fall back to a plain headcount then.
  const headline =
    hasCapped && !hasUnlimited
      ? `${filledTotal}/${capacityTotal} spots filled`
      : `${filledTotal} signed up`;
  const whenHeadline = e.eventDate ? formatLongDateLabel(e.eventDate) : "";
  const timing = horizon === "48h" ? "is in 2 days" : "is tomorrow";
  return {
    subject:
      horizon === "48h"
        ? `Only ${headline} for "${e.title}" — 2 days left to fill spots`
        : `Reminder: "${e.title}" is tomorrow — ${headline}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-top: 0;">${horizon === "48h" ? "Your event needs more volunteers" : "Your event is tomorrow"}</h2>
        <p>Hi ${escapeHtml(e.organizerName)},</p>
        <p><strong>${escapeHtml(e.title)}</strong>${whenHeadline ? ` is on <strong>${escapeHtml(whenHeadline)}</strong>` : ` ${timing}`} — ${escapeHtml(headline)}.</p>
        ${e.location ? `<p><strong>Location:</strong> ${escapeHtml(e.location)}</p>` : ""}
        ${descriptionBlock(e.description)}
        ${slotBlocks}
        <p><strong>Event page:</strong> <a href="${escapeHtml(eventUrl)}" style="color: #2563eb;">${escapeHtml(eventUrl)}</a></p>
        ${emailFooter(site)}
      </div>
    `,
  };
}

// ---------------------------------------------------------------------------
// 3. Finalized meeting reminders (organizer + voters).
// ---------------------------------------------------------------------------

function meetingWhen(
  target: FinalizedMeetingTarget
): { date: string | null; whenLine: string; whenBase: string } {
  const date = target.winningSlot.slotDate ?? target.event.eventDate;
  const whenLine = whenLineFor({
    eventDate: date,
    startTime: target.winningSlot.startTime,
    endTime: target.winningSlot.endTime,
    timezone: target.event.timezone,
  });
  const timePart = target.winningSlot.startTime
    ? `${formatTime(target.winningSlot.startTime)}${target.winningSlot.endTime ? ` – ${formatTime(target.winningSlot.endTime)}` : ""}`
    : target.winningSlot.endTime
      ? formatTime(target.winningSlot.endTime)
      : "";
  const whenBase = [date ? formatLongDateLabel(date) : "", timePart]
    .filter(Boolean)
    .join(" · ");
  return { date, whenLine, whenBase };
}

/** Deduped voter emails (lowercased). Votes without a usable email are skipped. */
export function groupMeetingRecipients(target: FinalizedMeetingTarget): Array<{
  email: string;
  name: string;
}> {
  const seen = new Map<string, { email: string; name: string }>();
  for (const v of target.voters) {
    const email = (v.email || "").trim();
    if (!email || !isValidEmail(email)) continue;
    const key = email.toLowerCase();
    if (!seen.has(key)) seen.set(key, { email, name: v.name });
  }
  return [...seen.values()];
}

export function buildMeetingParticipantEmail(
  site: SiteConfig,
  origin: string,
  target: FinalizedMeetingTarget,
  recipientName: string
): { subject: string; html: string } {
  const e = target.event;
  const eventUrl = eventPageUrl(origin, e.id);
  const { date, whenLine, whenBase } = meetingWhen(target);
  const { googleUrl, icsUrl } = slotCalendarLinks({
    site,
    origin,
    event: e,
    eventId: e.id,
    title: e.title,
    eventDate: date,
    startTime: target.winningSlot.startTime,
    endTime: target.winningSlot.endTime,
  });
  return {
    subject: `Reminder: "${e.title}" is tomorrow — ${whenBase || target.winningSlot.title}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-top: 0;">See you tomorrow!</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p>Quick reminder — <strong>${escapeHtml(e.title)}</strong> is happening tomorrow:</p>
        ${whenLine ? `<p><strong>When:</strong> ${escapeHtml(whenLine)}</p>` : ""}
        ${e.location ? `<p><strong>Location:</strong> ${escapeHtml(e.location)}</p>` : ""}
        ${descriptionBlock(e.description)}
        <p><strong>Event page:</strong> <a href="${escapeHtml(eventUrl)}" style="color: #2563eb;">${escapeHtml(eventUrl)}</a></p>
        <p>
          <a href="${escapeHtml(googleUrl)}" style="color: #2563eb;">Add to Google Calendar</a>
          &nbsp;·&nbsp;
          <a href="${escapeHtml(icsUrl)}" style="color: #2563eb;">Download .ics (Apple/Outlook)</a>
        </p>
        ${emailFooter(site)}
      </div>
    `,
  };
}

export function buildMeetingOrganizerEmail(
  site: SiteConfig,
  origin: string,
  target: FinalizedMeetingTarget
): { subject: string; html: string } {
  const e = target.event;
  const eventUrl = eventPageUrl(origin, e.id);
  const { whenLine, whenBase } = meetingWhen(target);
  const roster =
    target.voters.length > 0
      ? `<ul style="margin: 6px 0 0 0; padding-left: 20px; font-size: 13px;">${target.voters
          .map(
            (v) =>
              `<li>${escapeHtml(v.name)}${v.email ? ` — <a href="mailto:${escapeHtml(v.email)}" style="color: #2563eb;">${escapeHtml(v.email)}</a>` : ` <span style="color: #94a3b8;">(no email)</span>`}</li>`
          )
          .join("")}</ul>`
      : `<p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">No votes recorded.</p>`;
  const headcount = `${target.voters.length} voter${target.voters.length === 1 ? "" : "s"}`;
  return {
    subject: `Reminder: "${e.title}" is tomorrow — ${whenBase || target.winningSlot.title} (${headcount})`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-top: 0;">Your meeting is tomorrow</h2>
        <p>Hi ${escapeHtml(e.organizerName)},</p>
        <p><strong>${escapeHtml(e.title)}</strong> is locked in for tomorrow (${escapeHtml(headcount)}):</p>
        ${whenLine ? `<p><strong>When:</strong> ${escapeHtml(whenLine)}</p>` : ""}
        ${e.location ? `<p><strong>Location:</strong> ${escapeHtml(e.location)}</p>` : ""}
        ${descriptionBlock(e.description)}
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 16px; border-radius: 12px; margin: 12px 0;">
          <p style="margin: 0;"><strong>Attendees</strong></p>
          ${roster}
        </div>
        <p><strong>Event page:</strong> <a href="${escapeHtml(eventUrl)}" style="color: #2563eb;">${escapeHtml(eventUrl)}</a></p>
        ${emailFooter(site)}
      </div>
    `,
  };
}
