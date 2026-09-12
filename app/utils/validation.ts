// Shared server-side input limits + validators.
// All create/update/vote actions must enforce these — client-side checks
// (maxlength, MAX_OPTIONS) are UX only and trivially bypassed.

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const LOCATION_MAX = 300;
export const ORGANIZER_NAME_MAX = 120;
export const PARTICIPANT_NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const COMMENT_MAX = 500;
export const TIMEZONE_MAX = 60;
export const SLOT_TITLE_MAX = 200;
export const SHIFT_NAME_MAX = 120;

/** Max options per event (poll days / signup tasks). Client also caps at 31. */
export const MAX_SLOTS_PER_EVENT = 31;
/** Max votes/signups listed per event write path (abuse cap). */
export const MAX_VOTES_PER_EVENT = 1000;

export const ALLOWED_TIMEZONES = [
  "UTC",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
] as const;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  if (!email || email.length > EMAIL_MAX) return false;
  return EMAIL_RE.test(email);
}

export function normalizeTimezone(tz: string | null | undefined): string {
  const t = (tz || "").trim().slice(0, TIMEZONE_MAX);
  if ((ALLOWED_TIMEZONES as readonly string[]).includes(t)) return t;
  return "UTC";
}

/** Truncate-and-trim helper for free-text fields. */
export function cleanText(input: unknown, max: number): string {
  return String(input ?? "")
    .trim()
    .slice(0, max);
}
