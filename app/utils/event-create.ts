// Event creation for agents (MCP). The web create routes keep their own
// form-driven path; this one takes typed input, never an organizer email,
// and sends no mail — the admin link goes back to the caller instead.
//
// normalize*() are pure (no DB, env, randomness): they validate and shape
// rows, rejecting out-of-range input rather than clamping it. insertEvent()
// writes the event and all its slots in one D1 batch, so a failure leaves
// nothing behind.

import { events, eventSlots, getDb } from "~/db";
import { hashSecretForStorage } from "./auth";
import { addMinutesToTimeString } from "./calendar";
import { todayInZone } from "./event-expiry";
import { generateInternalId, generatePublicId, generateSecretToken } from "./ids";
import { pollDefaultTitle } from "./pollTitles";
import { SINGLE_SPEC, writeDateSpec } from "./recurrence";
import { zonedWallTimeToUtc } from "./timezones";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  MAX_SLOTS_PER_EVENT,
  MAX_TASKS_PER_DATE,
  ORGANIZER_NAME_MAX,
  SLOT_TITLE_MAX,
  TIMEZONE_MAX,
  TITLE_MAX,
  cleanText,
  isValidIsoDate,
  isValidTime,
  parseTimezoneInput,
  timeToMinutes,
} from "./validation";

export const CAPACITY_MIN = 1;
export const CAPACITY_MAX = 999;
export const POLL_DURATION_MIN = 15;
export const POLL_DURATION_MAX = 1440;
/** Poll options are open to everyone, like the web create. */
const POLL_SLOT_CAPACITY = 999;
/** D1 caps a statement at 100 bound values; a slot row binds 9. */
export const SLOT_INSERT_BATCH = 10;

export interface SignupSheetInput {
  title: string;
  description?: string;
  location?: string;
  date?: string;
  timezone: string;
  organizerName: string;
  tasks: Array<{ title: string; capacity: number; startTime?: string; endTime?: string }>;
}

export interface PollInput {
  title: string;
  description?: string;
  location?: string;
  timezone: string;
  organizerName: string;
  allDay?: boolean;
  durationMinutes?: number;
  options: Array<{ date: string; startTime?: string }>;
}

export interface NormalizedSlot {
  title: string;
  slotDate: string | null;
  startTime: string | null;
  endTime: string | null;
  capacity: number;
  displayOrder: number;
}

export interface NormalizedEvent {
  type: "SIGNUP_SHEET" | "TIME_POLL";
  title: string;
  description: string | null;
  location: string | null;
  eventDate: string | null;
  organizerName: string;
  timezone: string;
  durationMinutes: number | null;
  settings: string;
  slots: NormalizedSlot[];
}

export type Normalized = { ok: true; event: NormalizedEvent } | { ok: false; error: string };

class InputError extends Error {}

function requiredText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new InputError(`${label} is required.`);
  if (value.length > max) throw new InputError(`${label} is too long (max ${max} characters).`);
  const text = cleanText(value, max);
  if (!text) throw new InputError(`${label} is required.`);
  return text;
}

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InputError(`${label} must be text.`);
  if (value.length > max) throw new InputError(`${label} is too long (max ${max} characters).`);
  return cleanText(value, max) || null;
}

function requiredTimezone(value: unknown): string {
  // parseTimezoneInput turns "" into UTC; an agent must name the zone.
  if (typeof value !== "string" || !value.trim()) throw new InputError("Timezone is required (IANA name, e.g. Europe/London).");
  if (value.length > TIMEZONE_MAX) throw new InputError("Timezone is not a valid IANA name.");
  const tz = parseTimezoneInput(value);
  if (!tz) throw new InputError("Timezone is not a valid IANA name.");
  return tz;
}

function futureDate(value: unknown, tz: string, now: Date, label: string): string {
  if (typeof value !== "string" || !isValidIsoDate(value)) {
    throw new InputError(`${label}: use a real date as YYYY-MM-DD.`);
  }
  if (value < todayInZone(tz, now)) throw new InputError(`${label}: that date has already passed.`);
  return value;
}

function time(value: unknown, label: string): string {
  if (typeof value !== "string" || !isValidTime(value)) throw new InputError(`${label}: use 24-hour HH:MM.`);
  return value;
}

/** Same-day starts must still be ahead, measured on the event's own clock. */
function assertStartNotPassed(date: string, start: string, tz: string, now: Date, label: string) {
  if (date !== todayInZone(tz, now)) return;
  const instant = zonedWallTimeToUtc(date, start, tz);
  if (instant && instant.getTime() <= now.getTime()) {
    throw new InputError(`${label}: that time already passed today.`);
  }
}

function list<T>(value: unknown, min: number, max: number, label: string): T[] {
  if (!Array.isArray(value) || value.length < min) throw new InputError(`Add at least ${min} ${label}.`);
  if (value.length > max) throw new InputError(`Too many ${label} (max ${max}).`);
  return value as T[];
}

function integerIn(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new InputError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function run(build: () => NormalizedEvent): Normalized {
  try {
    return { ok: true, event: build() };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}

export function normalizeSignupInput(input: SignupSheetInput, now: Date): Normalized {
  return run(() => {
    const title = requiredText(input.title, TITLE_MAX, "Title");
    const description = optionalText(input.description, DESCRIPTION_MAX, "Description");
    const location = optionalText(input.location, LOCATION_MAX, "Location");
    const organizerName = requiredText(input.organizerName, ORGANIZER_NAME_MAX, "Organizer name");
    const timezone = requiredTimezone(input.timezone);
    const date = input.date === undefined ? null : futureDate(input.date, timezone, now, "Date");
    const tasks = list<SignupSheetInput["tasks"][number]>(input.tasks, 1, MAX_TASKS_PER_DATE, "tasks");

    const slots = tasks.map((task, idx): NormalizedSlot => {
      const label = `Task ${idx + 1}`;
      if (!task || typeof task !== "object") throw new InputError(`${label} is invalid.`);
      const slotTitle = requiredText(task.title, SLOT_TITLE_MAX, `${label} title`);
      const capacity = integerIn(task.capacity, CAPACITY_MIN, CAPACITY_MAX, `${label} capacity`);
      const hasStart = task.startTime !== undefined;
      const hasEnd = task.endTime !== undefined;
      if (hasStart !== hasEnd) throw new InputError(`${label}: give both startTime and endTime, or neither.`);
      let startTime: string | null = null;
      let endTime: string | null = null;
      if (hasStart) {
        if (!date) throw new InputError(`${label}: times need a date on the sheet.`);
        startTime = time(task.startTime, `${label} startTime`);
        endTime = time(task.endTime, `${label} endTime`);
        if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
          throw new InputError(`${label}: endTime must be after startTime (overnight shifts aren't supported).`);
        }
        assertStartNotPassed(date, startTime, timezone, now, label);
      }
      // Single-date sheets keep slot_date NULL, like every web-made sheet.
      return { title: slotTitle, slotDate: null, startTime, endTime, capacity, displayOrder: idx };
    });

    return {
      type: "SIGNUP_SHEET",
      title,
      description,
      location,
      eventDate: date,
      organizerName,
      timezone,
      durationMinutes: null,
      settings: writeDateSpec(null, SINGLE_SPEC),
      slots,
    };
  });
}

export function normalizePollInput(input: PollInput, now: Date): Normalized {
  return run(() => {
    const title = requiredText(input.title, TITLE_MAX, "Title");
    const description = optionalText(input.description, DESCRIPTION_MAX, "Description");
    const location = optionalText(input.location, LOCATION_MAX, "Location");
    const organizerName = requiredText(input.organizerName, ORGANIZER_NAME_MAX, "Organizer name");
    const timezone = requiredTimezone(input.timezone);

    let durationMinutes: number | null;
    if (input.allDay === true) {
      if (input.durationMinutes !== undefined) throw new InputError("Use allDay or durationMinutes, not both.");
      durationMinutes = null;
    } else {
      if (input.allDay !== undefined && input.allDay !== false) throw new InputError("allDay must be true or false.");
      if (input.durationMinutes === undefined) throw new InputError("Give durationMinutes, or set allDay: true.");
      durationMinutes = integerIn(input.durationMinutes, POLL_DURATION_MIN, POLL_DURATION_MAX, "durationMinutes");
    }

    const options = list<PollInput["options"][number]>(input.options, 1, MAX_SLOTS_PER_EVENT, "options");
    const seen = new Set<string>();
    const slots = options.map((option, idx): NormalizedSlot => {
      const label = `Option ${idx + 1}`;
      if (!option || typeof option !== "object") throw new InputError(`${label} is invalid.`);
      const date = futureDate(option.date, timezone, now, label);
      if (durationMinutes === null) {
        if (option.startTime !== undefined) throw new InputError(`${label}: all-day options take no startTime.`);
        if (seen.has(date)) throw new InputError(`${label}: that day is already in the poll.`);
        seen.add(date);
        return {
          title: pollDefaultTitle(date, null, null),
          slotDate: date,
          startTime: null,
          endTime: null,
          capacity: POLL_SLOT_CAPACITY,
          displayOrder: idx,
        };
      }
      const start = time(option.startTime, `${label} startTime`);
      const key = `${date}|${start}`;
      if (seen.has(key)) throw new InputError(`${label}: that day and time is already in the poll.`);
      seen.add(key);
      assertStartNotPassed(date, start, timezone, now, label);
      // End comes from the one poll duration; wrapping past midnight is fine.
      const end = addMinutesToTimeString(start, durationMinutes);
      return {
        title: pollDefaultTitle(date, start, end),
        slotDate: date,
        startTime: start,
        endTime: end,
        capacity: POLL_SLOT_CAPACITY,
        displayOrder: idx,
      };
    });

    return {
      type: "TIME_POLL",
      title,
      description,
      location,
      eventDate: [...slots.map((s) => s.slotDate as string)].sort()[0],
      organizerName,
      timezone,
      durationMinutes,
      settings: JSON.stringify({}),
      slots,
    };
  });
}

export interface CreateIds {
  publicId: () => string;
  internalId: () => string;
  secretToken: () => string;
}

const DEFAULT_IDS: CreateIds = {
  publicId: generatePublicId,
  internalId: generateInternalId,
  secretToken: generateSecretToken,
};

const MAX_ID_ATTEMPTS = 3;

/**
 * Write one event and its slots atomically. Only a primary-key collision on
 * the event ID is retried (with a new ID): that failure is certain not to
 * have committed. Any other error propagates — never retried blindly.
 */
export async function insertEvent(
  d1: D1Database,
  event: NormalizedEvent,
  now: Date,
  ids: CreateIds = DEFAULT_IDS
): Promise<{ eventId: string; adminToken: string }> {
  const db = getDb(d1);
  const adminToken = ids.secretToken();
  const adminTokenStored = await hashSecretForStorage(adminToken);
  const nowIso = now.toISOString();

  for (let attempt = 1; ; attempt++) {
    const eventId = ids.publicId();
    const slotRows = event.slots.map((s) => ({
      id: ids.internalId(),
      eventId,
      title: s.title,
      shiftName: null,
      slotDate: s.slotDate,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      displayOrder: s.displayOrder,
    }));
    const slotInserts = [];
    for (let i = 0; i < slotRows.length; i += SLOT_INSERT_BATCH) {
      slotInserts.push(db.insert(eventSlots).values(slotRows.slice(i, i + SLOT_INSERT_BATCH)));
    }
    try {
      await db.batch([
        db.insert(events).values({
          id: eventId,
          type: event.type,
          title: event.title,
          description: event.description,
          eventDate: event.eventDate,
          location: event.location,
          organizerName: event.organizerName,
          organizerEmail: "",
          adminToken: adminTokenStored,
          status: "OPEN",
          settings: event.settings,
          timezone: event.timezone,
          durationMinutes: event.durationMinutes,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
        ...slotInserts,
      ]);
      return { eventId, adminToken };
    } catch (err) {
      const collided = /UNIQUE constraint failed: events\.id/i.test(String((err as Error)?.message ?? err));
      if (!collided || attempt >= MAX_ID_ATTEMPTS) throw err;
    }
  }
}

