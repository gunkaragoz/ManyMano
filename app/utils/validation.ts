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
/** Max tasks a multi-date sign-up sheet may define per date (same cap, per day). */
export const MAX_TASKS_PER_DATE = 31;
/** Max dates one sheet may span (date range or repeat series). */
export const MAX_DATES_PER_EVENT = 60;
/** Hard cap on generated slot rows (dates x tasks) for one sheet. */
export const MAX_SLOT_ROWS_PER_EVENT = 300;
/** Max votes/signups listed per event write path (abuse cap). */
export const MAX_VOTES_PER_EVENT = 1000;

import { isValidTimezone } from "./timezones";

/** Historical preset list (kept for backwards compat — not a restriction). */
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

/** "YYYY-MM-DD" that names a real calendar day (rejects 2026-02-30). */
export function isValidIsoDate(value: string | null | undefined): boolean {
  const m = (value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** True when the day is before yesterday (UTC) — covers every timezone's "today". */
export function isPastIsoDate(value: string): boolean {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return value < yesterday;
}

const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 24h "HH:MM". */
export function isValidTime(value: string | null | undefined): boolean {
  return TIME_24H_RE.test(value || "");
}

export function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Strict variant of normalizeTimezone for create forms: empty → UTC,
 * unknown zone → null so the caller can show an error instead of guessing.
 */
export function parseTimezoneInput(tz: string | null | undefined): string | null {
  const t = (tz || "").trim();
  if (!t) return "UTC";
  if (t.length > TIMEZONE_MAX || !isValidTimezone(t)) return null;
  return t;
}

export function normalizeTimezone(tz: string | null | undefined): string {
  const t = (tz || "").trim().slice(0, TIMEZONE_MAX);
  // Inclusive: accept any valid IANA zone (full list in the picker),
  // not just the historical preset above.
  if (t && isValidTimezone(t)) return t;
  return "UTC";
}

/** Truncate-and-trim helper for free-text fields. */
export function cleanText(input: unknown, max: number): string {
  return String(input ?? "")
    .trim()
    .slice(0, max);
}
