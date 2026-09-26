// Event closing: derived from dates on every request, enforced server-side.
// No migration or cron — loader + action recompute it on each read/write,
// and adding a future date reopens automatically.
//
// Two instants per slot:
// - CLOSE: guest writes stop. Timed slots close at START (signing up for a
//   9–5 shift at 4:55 PM makes no sense); all-day slots close at end of day.
// - END: the slot is fully over. Between close and end a timed slot is
//   "Happening now"; after end it is past ("Done", collapsed, uneditable).

import { parseTimeString } from "./calendar";
import { zonedWallTimeToUtc } from "./timezones";
import { isValidIsoDate } from "./validation";

export interface ExpiryEventLike {
  eventDate?: string | null;
  timezone?: string | null;
}

export interface ExpirySlotLike {
  id: string;
  slotDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

/** Slots closing within this window get a "Closes in Xh" warning. */
export const CLOSING_SOON_MS = 24 * 3600_000;

function isIsoDay(value: string | null | undefined): value is string {
  return !!value && isValidIsoDate(value);
}

/** YYYY-MM-DD plus one day, or null for a bad date. */
export function addOneDayIso(dateStr: string): string | null {
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return new Date(check.getTime() + 86400_000).toISOString().slice(0, 10);
}

function organizerDay(
  slot: Pick<ExpirySlotLike, "slotDate">,
  eventDate?: string | null
): string | null {
  const raw = (slot.slotDate || eventDate || "").trim();
  return isIsoDay(raw) ? raw : null;
}

/** End of an organizer-local day: midnight starting the next day. */
function endOfDayInstant(date: string, tz: string): Date | null {
  const next = addOneDayIso(date);
  if (!next) return null;
  return zonedWallTimeToUtc(next, "00:00", tz);
}

/** Last millisecond of an organizer-local day (labels read the day itself). */
function endOfDayLastMs(date: string, tz: string): Date | null {
  const end = endOfDayInstant(date, tz);
  return end ? new Date(end.getTime() - 1) : null;
}

/**
 * UTC instant guest writes stop for a slot: its start time when it has one,
 * else the end of its day. Null when the slot has no usable date.
 */
export function slotCloseInstant(
  slot: Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">,
  eventDate?: string | null,
  timezone?: string | null
): Date | null {
  const date = organizerDay(slot, eventDate);
  if (!date) return null;
  const tz = (timezone || "").trim() || "UTC";
  if (parseTimeString(slot.startTime)) {
    return zonedWallTimeToUtc(date, slot.startTime, tz);
  }
  return endOfDayLastMs(date, tz);
}

/**
 * UTC instant a slot is fully over. Timed slots use their end time (start +
 * 1h when only a start is given); all-day slots end at midnight starting the
 * next day in the organizer's timezone. Null when unusable.
 */
export function slotEndInstant(
  slot: Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">,
  eventDate?: string | null,
  timezone?: string | null
): Date | null {
  const date = organizerDay(slot, eventDate);
  if (!date) return null;
  const tz = (timezone || "").trim() || "UTC";

  const start = parseTimeString(slot.startTime);
  const end = parseTimeString(slot.endTime);
  if (end) {
    const endInstant = zonedWallTimeToUtc(date, slot.endTime, tz);
    if (!endInstant) return null;
    if (start) {
      const startInstant = zonedWallTimeToUtc(date, slot.startTime, tz);
      if (startInstant && endInstant.getTime() <= startInstant.getTime()) {
        // Overnight shift (22:00 – 02:00): the wall-clock end is next day.
        // Convert on the next calendar day so a DST transition keeps the
        // wall-clock time — a fixed +24h slips an hour on fall-back.
        const next = addOneDayIso(date);
        return (next && zonedWallTimeToUtc(next, slot.endTime, tz)) || endInstant;
      }
    }
    return endInstant;
  }
  if (start) {
    const startInstant = zonedWallTimeToUtc(date, slot.startTime, tz);
    if (!startInstant) return null;
    return new Date(startInstant.getTime() + 3600_000);
  }
  // All-day: the last millisecond of the organizer-local day, so "Ended"
  // labels read the day itself (not midnight starting the next day) while a
  // timed shift genuinely ending at midnight keeps its real 12:00 AM.
  return endOfDayLastMs(date, tz);
}

/** UTC instant sign-ups / voting fully stop (latest slot close). */
export function eventCloseInstant(
  event: ExpiryEventLike,
  slots: Array<Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">>
): Date | null {
  let latest: Date | null = null;
  for (const s of slots) {
    const close = slotCloseInstant(s, event.eventDate, event.timezone);
    if (close && (!latest || close.getTime() > latest.getTime())) latest = close;
  }
  if (latest) return latest;
  if (isIsoDay((event.eventDate || "").trim())) {
    return slotCloseInstant({ slotDate: null, startTime: null, endTime: null }, event.eventDate, event.timezone);
  }
  return null;
}

/** UTC instant the whole event is fully over (latest slot end). */
export function eventEndInstant(
  event: ExpiryEventLike,
  slots: Array<Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">>
): Date | null {
  let latest: Date | null = null;
  for (const s of slots) {
    const end = slotEndInstant(s, event.eventDate, event.timezone);
    if (end && (!latest || end.getTime() > latest.getTime())) latest = end;
  }
  if (latest) return latest;
  if (isIsoDay((event.eventDate || "").trim())) {
    return slotEndInstant({ slotDate: null, startTime: null, endTime: null }, event.eventDate, event.timezone);
  }
  return null;
}

/** True once a slot stops taking sign-ups / votes. */
export function isSlotClosed(
  slot: Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">,
  eventDate?: string | null,
  timezone?: string | null,
  now: Date = new Date()
): boolean {
  const close = slotCloseInstant(slot, eventDate, timezone);
  return close !== null && close.getTime() <= now.getTime();
}

/** True between a timed slot's start and end. All-day slots never are. */
export function isSlotHappeningNow(
  slot: Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">,
  eventDate?: string | null,
  timezone?: string | null,
  now: Date = new Date()
): boolean {
  const close = slotCloseInstant(slot, eventDate, timezone);
  const end = slotEndInstant(slot, eventDate, timezone);
  return (
    close !== null &&
    end !== null &&
    close.getTime() <= now.getTime() &&
    now.getTime() < end.getTime() &&
    end.getTime() > close.getTime()
  );
}

/** True once a slot has fully happened (history — organizer record only). */
export function isSlotPast(
  slot: Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">,
  eventDate?: string | null,
  timezone?: string | null,
  now: Date = new Date()
): boolean {
  const end = slotEndInstant(slot, eventDate, timezone);
  return end !== null && end.getTime() <= now.getTime();
}

/** True once every slot is closed. Undated events never close. */
export function isEventClosed(
  event: ExpiryEventLike,
  slots: Array<Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">>,
  now: Date = new Date()
): boolean {
  const close = eventCloseInstant(event, slots);
  return close !== null && close.getTime() <= now.getTime();
}

/** True once the event has fully happened. Undated events never are. */
export function isEventPast(
  event: ExpiryEventLike,
  slots: Array<Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">>,
  now: Date = new Date()
): boolean {
  const end = eventEndInstant(event, slots);
  return end !== null && end.getTime() <= now.getTime();
}

/** IDs of slots no longer taking sign-ups / votes. */
export function closedSlotIds(
  event: ExpiryEventLike,
  slots: ExpirySlotLike[],
  now: Date = new Date()
): string[] {
  return slots
    .filter((s) => isSlotClosed(s, event.eventDate, event.timezone, now))
    .map((s) => s.id);
}

/** IDs of slots that fully happened (collapsed "Done" history). */
export function pastSlotIds(
  event: ExpiryEventLike,
  slots: ExpirySlotLike[],
  now: Date = new Date()
): string[] {
  return slots
    .filter((s) => isSlotPast(s, event.eventDate, event.timezone, now))
    .map((s) => s.id);
}

/** Ms until a slot closes, or null when already closed / undated. */
export function msUntilSlotClose(
  slot: Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">,
  eventDate?: string | null,
  timezone?: string | null,
  now: Date = new Date()
): number | null {
  const close = slotCloseInstant(slot, eventDate, timezone);
  if (!close) return null;
  const ms = close.getTime() - now.getTime();
  return ms > 0 ? ms : null;
}

/** Organizer-local today (YYYY-MM-DD). Falls back to UTC. */
export function todayInZone(tz: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Compact countdown: 3h, 25m. Null when over an hour would need days. */
export function closesInLabel(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.round(ms / 60000))}m`;
}

/** Relative countdowns switch to absolute times beyond this window. */
export const COUNTDOWN_ABSOLUTE_MS = 6 * 3600_000;

/**
 * Time phrase for a closing instant: relative ("in 3h") under 6h, absolute
 * in the organizer's zone beyond that ("tomorrow at 9 AM"). Callers add
 * their verb ("Closes …", "Sign-ups close …"). Absolute phrases never go
 * stale in background tabs.
 */
export function closingPhraseForInstant(close: Date, tz: string, now: Date): string {
  const ms = close.getTime() - now.getTime();
  if (ms < COUNTDOWN_ABSOLUTE_MS) return `in ${closesInLabel(ms)}`;
  const zone = tz || "UTC";
  try {
    const closeDay = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(close);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(close);
    const today = todayInZone(zone, now);
    const dayWord =
      closeDay === today
        ? "today"
        : closeDay === addOneDayIso(today)
          ? "tomorrow"
          : new Intl.DateTimeFormat("en-US", {
              timeZone: zone,
              weekday: "short",
              month: "short",
              day: "numeric",
            }).format(close);
    return `${dayWord} at ${time}`;
  } catch {
    return `in ${closesInLabel(ms)}`;
  }
}

/**
 * Closing phrase for a slot ("in 3h", "tomorrow at 9 AM"). Null when closed
 * or undated.
 */
export function closingPhraseForSlot(
  slot: Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">,
  eventDate?: string | null,
  timezone?: string | null,
  now: Date = new Date()
): string | null {
  const close = slotCloseInstant(slot, eventDate, timezone);
  if (!close || close.getTime() <= now.getTime()) return null;
  return closingPhraseForInstant(close, (timezone || "").trim() || "UTC", now);
}

/**
 * "Oct 3, 6:00 PM" for an instant in the organizer's zone, so guests in
 * other timezones see when something closed. Null when invalid. Pure from
 * props — SSR-safe.
 */
export function formatOrganizerInstant(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return null;
  }
}
