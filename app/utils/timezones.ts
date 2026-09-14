// Shared IANA timezone helpers (client + server safe).
// Inclusivity goal: never restrict users to a small preset list. Any valid
// IANA zone is accepted; the UI offers the full list with search + the
// auto-detected zone pinned on top.

/** Curated fallback covering all GMT offsets + major cities per offset.
 *  Used only when `Intl.supportedValuesOf("timeZone")` is unavailable
 *  (older browsers / runtimes). City-based names stay politically neutral. */
export const FALLBACK_TIMEZONES: readonly string[] = [
  "UTC",
  "Atlantic/Azores",
  "Atlantic/Cape_Verde",
  "America/Noronha",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Halifax",
  "America/Caracas",
  "America/New_York",
  "America/Toronto",
  "America/Havana",
  "America/Bogota",
  "America/Lima",
  "America/Chicago",
  "America/Mexico_City",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Pacific/Midway",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Tongatapu",
  "Pacific/Apia",
  "Pacific/Chatham",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Rangoon",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Colombo",
  "Asia/Karachi",
  "Asia/Kabul",
  "Asia/Dubai",
  "Asia/Tehran",
  "Asia/Baku",
  "Asia/Tbilisi",
  "Asia/Yerevan",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Kyiv",
  "Europe/Bucharest",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Brussels",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Dublin",
  "Atlantic/Reykjavik",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Casablanca",
  "America/St_Johns",
];

/** Full IANA list when the runtime supports it, else the curated fallback. */
export function getAllTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof fn === "function") {
      const all = fn.call(Intl, "timeZone");
      if (Array.isArray(all) && all.length > 0) return [...all];
    }
  } catch {
    // fall through to curated list
  }
  return [...FALLBACK_TIMEZONES];
}

/** True for "UTC" or any zone Intl accepts. Never throws. */
export function isValidTimezone(tz: string): boolean {
  if (tz === "UTC") return true;
  if (!tz || tz.length > 60) return false;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** Browser's local zone, e.g. "Europe/Berlin". Null on server / when unknown. */
export function detectLocalTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimezone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/** Offset of an IANA timezone in minutes east of UTC. Null when unknown. */
export function getOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
    const asUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

/** Full offset label, e.g. "GMT+03:00". Null when unknown. */
export function formatUtcOffsetLabel(timeZone: string, at: Date = new Date()): string | null {
  const minutes = getOffsetMinutes(timeZone, at);
  if (minutes === null) return null;
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `GMT${sign}${hh}:${mm}`;
}

/** Short offset form, e.g. "GMT-4" or "GMT+5:30". Null when unknown. */
export function formatUtcOffsetShort(timeZone: string, at: Date = new Date()): string | null {
  const minutes = getOffsetMinutes(timeZone, at);
  if (minutes === null) return null;
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `GMT${sign}${h}` : `GMT${sign}${h}:${String(m).padStart(2, "0")}`;
}

/** "Europe/Berlin" -> "Berlin". "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
export function timezoneCity(timeZone: string): string {
  if (timeZone === "UTC") return "UTC";
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

/** "Europe/Berlin" -> "Europe". "UTC" -> "UTC". */
export function timezoneRegion(timeZone: string): string {
  const parts = timeZone.split("/");
  return parts.length > 1 ? parts[0].replace(/_/g, " ") : "UTC";
}

/** "Berlin (GMT+02:00)" — used for <option>-style and aria labels. */
export function formatTimezoneLabel(timeZone: string, at: Date = new Date()): string {
  const offset = formatUtcOffsetLabel(timeZone, at);
  const name = timeZone === "UTC" ? "UTC" : `${timezoneCity(timeZone)} (${timezoneRegion(timeZone)})`;
  return offset ? `${name} — ${offset}` : name;
}

/** Current wall-clock time in a zone, e.g. "04:54". Null when unknown. */
export function formatTimeInTimezone(timeZone: string, at: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(at);
  } catch {
    return null;
  }
}

/** Short zone name at an instant, e.g. "EDT", "CEST", "GMT+5:30". Null when unknown. */
export function formatTimezoneShortName(timeZone: string, at: Date = new Date()): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(at);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
    return tzPart || null;
  } catch {
    return null;
  }
}

function parseWallDateTime(
  dateStr: string | null | undefined,
  timeStr: string | null | undefined
): { year: number; month: number; day: number; hours: number; minutes: number } | null {
  if (!dateStr) return null;
  const dm = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dm) return null;
  const year = parseInt(dm[1], 10);
  const month = parseInt(dm[2], 10);
  const day = parseInt(dm[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (!timeStr) return null;
  const t = timeStr.trim();
  if (!t) return null;
  // Reuse the same accepted formats as calendar.parseTimeString (duplicated
  // here to keep this module dependency-free).
  const iso = t.match(/^\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const h = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { year, month, day, hours: h, minutes: m };
    return null;
  }
  const ampm = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s?[Mm]\.?$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const isPM = ampm[3].toLowerCase() === "p";
    if (h < 1 || h > 12 || m > 59) return null;
    h = h % 12;
    if (isPM) h += 12;
    return { year, month, day, hours: h, minutes: m };
  }
  const h24 = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { year, month, day, hours: h, minutes: m };
    return null;
  }
  const bare = t.match(/^(\d{1,2})$/);
  if (bare) {
    const h = parseInt(bare[1], 10);
    if (h >= 0 && h <= 23) return { year, month, day, hours: h, minutes: 0 };
  }
  return null;
}

/**
 * Convert a wall-clock time in `timeZone` ("YYYY-MM-DD" + "HH:MM" / "h:MM AM")
 * to the corresponding UTC instant. Returns null when the date/time can't be
 * parsed. Unknown zones fall back to UTC (matching resolveEventDates).
 *
 * Offset depends on the instant itself (DST), so refine iteratively.
 */
export function zonedWallTimeToUtc(
  dateStr: string | null | undefined,
  timeStr: string | null | undefined,
  timeZone: string | null | undefined
): Date | null {
  const parsed = parseWallDateTime(dateStr, timeStr);
  if (!parsed) return null;
  const tz = timeZone && isValidTimezone(timeZone) ? timeZone : "UTC";
  const wallAsUTC = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hours, parsed.minutes, 0);
  if (tz === "UTC") return new Date(wallAsUTC);
  // The real instant is within UTC-12..UTC+14 of the wall-as-UTC value, so
  // offsets 36h either side bracket any DST transition around it.
  const span = 36 * 60 * 60 * 1000;
  const before = getOffsetMinutes(tz, new Date(wallAsUTC - span));
  const after = getOffsetMinutes(tz, new Date(wallAsUTC + span));
  if (before === null || after === null) return new Date(wallAsUTC);
  // Earlier offset first: a repeated wall time (fall back) resolves to its
  // first occurrence.
  const candidates = [wallAsUTC - before * 60_000, wallAsUTC - after * 60_000];
  for (const c of candidates) {
    if (getOffsetMinutes(tz, new Date(c)) === (wallAsUTC - c) / 60_000) return new Date(c);
  }
  // Wall time skipped by spring-forward: shift forward by the gap
  // (02:30 → 03:30), the same direction in every zone.
  return new Date(candidates[0]);
}

/** "h:MM AM" clock time of an instant in a zone, e.g. "9:00 AM". Null when unknown. */
export function formatInstantTimeInZone(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = get("hour");
    const minute = get("minute");
    const dayPeriod = get("dayPeriod");
    if (!hour || !minute) return null;
    return dayPeriod ? `${hour}:${minute} ${dayPeriod.toUpperCase()}` : `${hour}:${minute}`;
  } catch {
    return null;
  }
}

/** Short date of an instant in a zone, e.g. "Mon, Sep 14". Null when unknown. */
export function formatInstantDateInZone(date: Date, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return null;
  }
}
