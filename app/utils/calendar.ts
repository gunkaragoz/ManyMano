import { zonedWallTimeToUtc } from "./timezones";

export interface CalendarEventParams {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  /** Event-level date, e.g. '2026-10-17' from <input type="date">. */
  eventDate?: string | null;
  /** Slot-level times, e.g. '08:00' from <input type="time"> or '9:00 AM'. */
  startTime?: string | null; // ISO string OR "HH:MM" OR "h:MM AM/PM"
  endTime?: string | null; // ISO string OR "HH:MM" OR "h:MM AM/PM"
  /** Organizer-selected IANA zone the wall-clock times are expressed in. */
  timeZone?: string | null;
  organizerName?: string | null;
  organizerEmail?: string | null;
  /** Absolute URL back to the event page (added to description + URL field). */
  url?: string | null;
}

export interface CalendarSlotLike {
  id: string;
  slotDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

export interface ResolvedDates {
  start: Date;
  end: Date;
  allDay: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse "HH:MM" / "H:MM:SS" / "h:MM AM" / "h AM" / full ISO strings. Returns UTC hours+minutes or null. */
export function parseTimeString(input: string | null | undefined): { hours: number; minutes: number } | null {
  if (!input) return null;
  const t = input.trim();
  if (!t) return null;

  // Full ISO datetime (e.g. "2026-10-17T14:00:00Z" or "2026-10-17T14:00") — extract clock time.
  // Date-only strings ("2026-10-17") carry no clock time.
  const isoDateTime = t.match(/^\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoDateTime) {
    const h = parseInt(isoDateTime[1], 10);
    const m = parseInt(isoDateTime[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { hours: h, minutes: m };
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;

  // 12-hour clock: "9:00 AM", "9 AM", "09:30pm"
  const ampm = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s?[Mm]\.?$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const isPM = ampm[3].toLowerCase() === "p";
    if (h < 1 || h > 12 || m > 59) return null;
    h = h % 12;
    if (isPM) h += 12;
    return { hours: h, minutes: m };
  }

  // 24-hour clock: "08:00", "8:00", "14:00:00"
  const h24 = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { hours: h, minutes: m };
    return null;
  }

  // Bare hour: "9" (= 09:00). Only accept 0-23 to avoid swallowing titles.
  const bare = t.match(/^(\d{1,2})$/);
  if (bare) {
    const h = parseInt(bare[1], 10);
    if (h >= 0 && h <= 23) return { hours: h, minutes: 0 };
  }

  return null;
}

function parseEventDate(input: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Combine an event date ("YYYY-MM-DD") with slot clock times into UTC Dates.
 * - date + start (+end)  -> timed event (default 1h duration)
 * - date only            -> all-day event
 * - time only / nothing  -> null (caller falls back to a draft / now)
 *
 * Wall-clock times are interpreted in `timeZone` (the organizer-selected
 * IANA zone, e.g. "America/New_York") and converted to UTC. Unknown/missing
 * zones fall back to UTC for backwards compatibility with older events.
 */
export function resolveEventDates(args: {
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timeZone?: string | null;
}): ResolvedDates | null {
  const date = parseEventDate(args.eventDate);
  if (!date) return null;

  const start = parseTimeString(args.startTime);
  if (!start) {
    // All-day: DTSTART = date, DTEND = next day (exclusive per RFC 5545).
    return {
      start: new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0)),
      end: new Date(Date.UTC(date.year, date.month - 1, date.day + 1, 0, 0, 0)),
      allDay: true,
    };
  }
  // Timezone-aware path: interpret the wall-clock in the organizer zone.
  const tz = (args.timeZone || "").trim() || "UTC";
  if (tz && tz !== "UTC") {
    try {
      const utcStart = zonedWallTimeToUtc(args.eventDate, args.startTime, tz);
      const utcEndRaw = args.endTime ? zonedWallTimeToUtc(args.eventDate, args.endTime, tz) : null;
      if (utcStart) {
        let utcEnd: Date;
        if (utcEndRaw) {
          utcEnd = utcEndRaw;
          // Overnight shift (e.g. 22:00 – 02:00) rolls to the next day.
          if (utcEnd.getTime() <= utcStart.getTime()) {
            utcEnd = new Date(utcEnd.getTime() + 24 * 60 * 60 * 1000);
          }
        } else {
          utcEnd = new Date(utcStart.getTime() + 60 * 60 * 1000);
        }
        return { start: utcStart, end: utcEnd, allDay: false };
      }
      // fall through to UTC interpretation when conversion fails
    } catch {
      // fall through to UTC interpretation
    }
  }
  const end = parseTimeString(args.endTime);
  const startDate = new Date(Date.UTC(date.year, date.month - 1, date.day, start.hours, start.minutes, 0));
  let endDate: Date;
  if (end) {
    endDate = new Date(Date.UTC(date.year, date.month - 1, date.day, end.hours, end.minutes, 0));
    // Overnight shift (e.g. 22:00 – 02:00) rolls to the next day.
    if (endDate.getTime() <= startDate.getTime()) {
      endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  }
  return { start: startDate, end: endDate, allDay: false };
}

/**
 * Pick which slot represents the event on the calendar.
 * Winning (finalized) slot first, then the earliest slot by
 * (slotDate, startTime), then simply the first slot.
 * Returns null when there are no slots.
 */
export function pickCalendarSlot<T extends CalendarSlotLike>(
  slots: T[],
  winningSlotId?: string | null
): T | null {
  if (!slots || slots.length === 0) return null;
  if (winningSlotId) {
    const win = slots.find((s) => s.id === winningSlotId);
    if (win) return win;
  }
  const withTime = slots.filter((s) => parseTimeString(s.startTime));
  if (withTime.length > 0) {
    return [...withTime].sort((a, b) => {
      const dateCmp = (a.slotDate || "").localeCompare(b.slotDate || "");
      if (dateCmp !== 0) return dateCmp;
      const ta = parseTimeString(a.startTime)!;
      const tb = parseTimeString(b.startTime)!;
      return ta.hours * 60 + ta.minutes - (tb.hours * 60 + tb.minutes);
    })[0];
  }
  const withDate = slots.filter((s) => s.slotDate);
  if (withDate.length > 0) {
    return [...withDate].sort((a, b) => (a.slotDate || "").localeCompare(b.slotDate || ""))[0];
  }
  return slots[0];
}

/** Effective event date for a slot: per-slot date wins, else the event-level date. */
export function effectiveDateForSlot(
  slot: CalendarSlotLike,
  eventDate?: string | null
): string | null {
  return slot.slotDate || eventDate || null;
}

/** Add minutes to a "HH:MM" time string. Returns "HH:MM" (wraps past midnight). */
export function addMinutesToTimeString(time: string, minutes: number): string {
  const parsed = parseTimeString(time);
  if (!parsed) return time;
  const total = parsed.hours * 60 + parsed.minutes + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Smart duration label: 15 -> "15 min", 60 -> "1 hr", 90 -> "1 hr 30 min", 120 -> "2 hrs". */
export function formatDurationLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "All day";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const hPart = h === 1 ? "1 hr" : `${h} hrs`;
  return rem === 0 ? hPart : `${hPart} ${rem} min`;
}

/** Short day label for a "YYYY-MM-DD" date, e.g. "Fri, Sep 12". Falls back to input. */
export function formatSlotDateLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Long date label for a "YYYY-MM-DD" date, e.g. "Saturday, September 20th, 2026". Falls back to input. */
export function formatLongDateLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  if (isNaN(d.getTime())) return dateStr;
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const day = parseInt(m[3], 10);
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}, ${m[1]}`;
}

/** "20261017T140000Z" — the format Google Calendar's template endpoint wants. */
export function formatDateForGoogle(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function formatDateForGoogleAllDay(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/**
 * One-click "Add to Google Calendar" link.
 * Opens calendar.google.com with the event pre-filled — no file download,
 * works on desktop + mobile, signed-in or not (prompts sign-in as needed).
 * When no date is known the `dates` param is omitted so Google opens a draft.
 *
 * `fallbackTitle` is required (pass `${siteName} Event`) — no hardcoded brand.
 */
export function buildGoogleCalendarUrl(event: {
  title: string;
  description?: string | null;
  location?: string | null;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timeZone?: string | null;
  url?: string | null;
  fallbackTitle: string;
}): string {
  if (!event.fallbackTitle) throw new Error("[config] buildGoogleCalendarUrl requires fallbackTitle.");
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", event.title || event.fallbackTitle);

  const resolved = resolveEventDates({
    eventDate: event.eventDate,
    startTime: event.startTime,
    endTime: event.endTime,
    timeZone: event.timeZone,
  });
  if (resolved) {
    if (resolved.allDay) {
      params.set(
        "dates",
        `${formatDateForGoogleAllDay(resolved.start)}/${formatDateForGoogleAllDay(resolved.end)}`
      );
    } else {
      params.set("dates", `${formatDateForGoogle(resolved.start)}/${formatDateForGoogle(resolved.end)}`);
    }
  }

  const detailsParts: string[] = [];
  if (event.description?.trim()) detailsParts.push(event.description.trim());
  if (event.url) detailsParts.push(`\n${event.url}`);
  if (detailsParts.length > 0) params.set("details", detailsParts.join("\n"));
  if (event.location?.trim()) params.set("location", event.location.trim());

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function formatDateToICS(date: Date): string {
  return formatDateForGoogle(date);
}

function formatDateToICSAllDay(date: Date): string {
  return formatDateForGoogleAllDay(date);
}

/** Escape text per RFC 5545 §3.3.11. */
function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold content lines at 75 octets per RFC 5545 §3.1. */
function foldICSLine(line: string): string {
  if (line.length <= 75) return line;
  // ASCII-safe chunking is fine here: dates/keys are ASCII and escaped text
  // is ASCII after escaping (non-ASCII UTF-8 bytes could split mid-char, but
  // parsers accept this and JS length counting keeps it simple at the edge).
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export function generateICS(event: CalendarEventParams & { prodid: string; uidDomain: string; fallbackTitle: string }): string {
  if (!event.prodid) throw new Error("[config] generateICS requires prodid (ICS_PRODID).");
  if (!event.uidDomain) throw new Error("[config] generateICS requires uidDomain (ICS_UID_DOMAIN).");
  if (!event.fallbackTitle) throw new Error("[config] generateICS requires fallbackTitle.");
  const now = new Date();
  const dtStamp = formatDateToICS(now);

  const resolved = resolveEventDates({
    eventDate: event.eventDate,
    startTime: event.startTime,
    endTime: event.endTime,
    timeZone: event.timeZone,
  });

  // Legacy callers passed full ISO datetimes in startTime/endTime — still honor those.
  let fallbackStart: Date | null = null;
  let fallbackEnd: Date | null = null;
  if (!resolved && event.startTime) {
    const parsed = new Date(event.startTime);
    if (!isNaN(parsed.getTime())) {
      fallbackStart = parsed;
      if (event.endTime) {
        const parsedEnd = new Date(event.endTime);
        fallbackEnd = isNaN(parsedEnd.getTime())
          ? new Date(parsed.getTime() + 60 * 60 * 1000)
          : parsedEnd;
      } else {
        fallbackEnd = new Date(parsed.getTime() + 60 * 60 * 1000);
      }
    }
  }

  const cleanTitle = (event.title || event.fallbackTitle).replace(/\r\n|\r|\n/g, " ");

  const descriptionParts: string[] = [];
  if (event.description?.trim()) descriptionParts.push(event.description.trim());
  if (event.url) descriptionParts.push(event.url);

  const rawLines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    event.prodid,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@${event.uidDomain}`,
    `DTSTAMP:${dtStamp}`,
  ];

  if (resolved?.allDay) {
    rawLines.push(`DTSTART;VALUE=DATE:${formatDateToICSAllDay(resolved.start)}`);
    rawLines.push(`DTEND;VALUE=DATE:${formatDateToICSAllDay(resolved.end)}`);
  } else {
    const start = resolved ? resolved.start : (fallbackStart ?? now);
    const end = resolved ? resolved.end : (fallbackEnd ?? new Date(start.getTime() + 60 * 60 * 1000));
    rawLines.push(`DTSTART:${formatDateToICS(start)}`);
    rawLines.push(`DTEND:${formatDateToICS(end)}`);
  }

  rawLines.push(`SUMMARY:${escapeICSText(cleanTitle)}`);
  if (descriptionParts.length > 0) {
    rawLines.push(`DESCRIPTION:${escapeICSText(descriptionParts.join("\n\n"))}`);
  }
  if (event.location?.trim()) {
    rawLines.push(`LOCATION:${escapeICSText(event.location.trim().replace(/\r\n|\r|\n/g, " "))}`);
  }
  if (event.organizerEmail) {
    rawLines.push(
      `ORGANIZER;CN=${escapeICSText(event.organizerName || "Organizer")}:mailto:${event.organizerEmail}`
    );
  }
  if (event.url) {
    // URI property values must NOT be escaped (RFC 5545 §3.3.13).
    rawLines.push(`URL:${event.url}`);
  }
  rawLines.push("STATUS:CONFIRMED");
  rawLines.push("END:VEVENT");
  rawLines.push("END:VCALENDAR");

  return rawLines.map(foldICSLine).join("\r\n");
}
