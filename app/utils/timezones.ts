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
