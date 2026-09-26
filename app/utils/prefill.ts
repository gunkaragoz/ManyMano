// Prefill for the create forms: templates and "Make a copy".
//
// Both sources produce one normalized, serializable shape per flow, with every
// date stored RELATIVE to an anchor ("the next Monday", "the 5th Monday",
// "3 days after the first option"). The create page resolves that shape into
// concrete form state on the client — against today on the event's own
// calendar — and validates the result by simulating exactly what the form
// would post and what the unchanged create action would do with it.
//
// Copies are exact or refused: a sheet whose structure the create form can't
// reproduce comes back as { unsupported, reason } instead of an approximation.
// The one disclosed exception is an all-day poll, which the create form can
// no longer make: it is copied as a 1-hour poll and the page says so.
//
// Nothing here reads the clock, generates random ids, or touches the DB.
import {
  MAX_SERIES_DAYS,
  addDays,
  expandDates,
  maxSeriesEnd,
  parseDateSpec,
  parseDayFilter,
  dayFilterMatches,
  serializeDayFilter,
  weekdayOf,
  weekdayOrdinalOf,
  readDateSpec,
  type DateSpec,
  type RepeatRule,
} from "~/utils/recurrence";
import {
  dateFieldsFor,
  dateLimitError,
  dayChoicesFor,
  daysForShift,
  defaultSelection,
  selectionFromSpec,
  selectionToSpec,
  type DateSelection,
} from "~/utils/formDates";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  MAX_SLOTS_PER_EVENT,
  MAX_TASKS_PER_DATE,
  SHIFT_NAME_MAX,
  SLOT_TITLE_MAX,
  TITLE_MAX,
  cleanText,
  isValidIsoDate,
  isValidTime,
  timeToMinutes,
} from "~/utils/validation";
import { addMinutesToTimeString } from "~/utils/calendar";
import { pollDefaultTitle } from "~/utils/pollTitles";

// ---------------------------------------------------------------------------
// Create-form state (shared with the create routes)
// ---------------------------------------------------------------------------

export type SignupDetails = {
  title: string;
  eventDate: string;
  description: string;
  location: string;
  organizerName: string;
  organizerEmail: string;
  timezone: string;
};

export type SignupShift = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  /** Days this shift runs on (date or weekday keys). Missing = every date. */
  days?: string[] | null;
  tasks: Array<{ id: number; title: string; capacity: number }>;
};

export type PollDetails = {
  title: string;
  description: string;
  location: string;
  organizerName: string;
  organizerEmail: string;
  timezone: string;
};

export type PollDayRow = {
  id: number;
  date: string;
  startTime: string;
  label: string;
};

// ---------------------------------------------------------------------------
// Normalized prefill
// ---------------------------------------------------------------------------

export type PrefillSource =
  | { kind: "template"; slug: string; name: string }
  | { kind: "clone"; eventId: string; title: string };

/**
 * Where the first date lands, relative to "today" on the event's calendar.
 * `ordinal` follows weekdayOrdinalOf(): 1–4, or 5 for a fifth occurrence
 * (which the monthly rule then reads as "last").
 */
export type RelativeAnchor =
  | { kind: "undated" }
  | { kind: "offset"; offsetDays: number }
  | { kind: "weekday"; weekday: number; minOffsetDays: number }
  | { kind: "monthlyNth"; weekday: number; ordinal: number; minOffsetDays: number };

export type RelativeDateSpec =
  | { mode: "single" }
  /** Inclusive: 5 = Monday–Friday. */
  | { mode: "range"; spanDays: number }
  | { mode: "repeat"; rule: RepeatRule; ends: { after: number } | { offsetDays: number } };

export type RelativeDayFilter =
  | { kind: "all" }
  /** Day offsets from the first date (range sheets). */
  | { kind: "dateOffsets"; values: number[] }
  /** 0 = Sunday (repeating sheets). */
  | { kind: "weekdays"; values: number[] };

export type PrefillDetails = {
  title: string;
  description: string;
  location: string;
  /** null = use the browser's timezone (templates). */
  timezone: string | null;
};

export type PrefillNote = "allDayToHour";

export type SignupPrefill = {
  source: PrefillSource;
  details: PrefillDetails;
  anchor: RelativeAnchor;
  dates: RelativeDateSpec;
  shifts: Array<{
    name: string;
    startTime: string;
    endTime: string;
    days: RelativeDayFilter;
    tasks: Array<{ title: string; capacity: number }>;
  }>;
};

export type PollPrefill = {
  source: PrefillSource;
  details: PrefillDetails;
  anchor: Exclude<RelativeAnchor, { kind: "undated" }>;
  /** Never null: the create form has no all-day option. */
  durationMinutes: number;
  options: Array<{ dayOffset: number; startTime: string; label: string }>;
  notes: PrefillNote[];
};

export type Unsupported = { unsupported: true; reason: string };

/**
 * What a create page's loader hands the page. "missing" and "unsupported"
 * are notices: the page keeps whatever draft it already has.
 */
export type PrefillLoad<P> =
  | { status: "none" }
  | { status: "ready"; prefill: P }
  | { status: "missing"; source: "template" | "clone" }
  | { status: "unsupported"; reason: string; eventId: string };

function unsupported(reason: string): Unsupported {
  return { unsupported: true, reason };
}

export function isUnsupported<T extends object>(value: T | Unsupported): value is Unsupported {
  return "unsupported" in value;
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/** Whole calendar days from `from` to `to` ("YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** The earliest date on or after `from` that satisfies `test` (bounded scan). */
function firstDateFrom(from: string, test: (date: string) => boolean): string | null {
  // Fifth occurrences of a weekday can be a few months apart; 3 years is far
  // more than any rule needs and keeps a malformed anchor from spinning.
  for (let i = 0, d = from; i < 1100; i++, d = addDays(d, 1)) {
    if (test(d)) return d;
  }
  return null;
}

/** The concrete first date for an anchor, or "" for an undated sheet. */
export function resolveAnchor(anchor: RelativeAnchor, today: string): string | null {
  switch (anchor.kind) {
    case "undated":
      return "";
    case "offset":
      return addDays(today, anchor.offsetDays);
    case "weekday":
      return firstDateFrom(addDays(today, anchor.minOffsetDays), (d) => weekdayOf(d) === anchor.weekday);
    case "monthlyNth":
      return firstDateFrom(
        addDays(today, anchor.minOffsetDays),
        (d) => weekdayOf(d) === anchor.weekday && weekdayOrdinalOf(d) === anchor.ordinal
      );
  }
}

/** The timezone a prefill resolves in: its own, else the browser's, else UTC. */
export function prefillTimezone(details: PrefillDetails, detected: string | null | undefined): string {
  return details.timezone || detected || "UTC";
}

// ---------------------------------------------------------------------------
// Simulating the sign-up form + create action
// ---------------------------------------------------------------------------

export type SimulatedSlotRow = {
  /** Effective date ("" for an undated single-day sheet). */
  date: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  title: string;
  capacity: number;
};

/**
 * What the sign-up create form would post for this state, run through the
 * create action's own parsing and checks. Returns the slot rows the action
 * would insert, in display order, or the error it would answer with.
 *
 * Mirrors app/routes/create.signup.tsx (form serialisation + action). The one
 * check left out is "that time already passed today", which needs the clock;
 * every prefill anchors on tomorrow or later, so it can't fire.
 */
export function simulateSignupSubmission(
  state: { details: SignupDetails; shifts: SignupShift[]; dateSel: DateSelection },
  today: string
): { rows: SimulatedSlotRow[] } | { error: string } {
  const { details, shifts, dateSel } = state;

  // --- form: what gets posted -------------------------------------------
  const start = details.eventDate || today;
  const formSpec = selectionToSpec(dateSel, start);
  const sheetDates =
    formSpec.mode === "single" ? [start] : expandDates(formSpec, start, MAX_SERIES_DAYS + 1);
  const choiceKeys = dayChoicesFor(dateSel, sheetDates).map((c) => c.key);
  const posted = shifts.flatMap((shift) =>
    shift.tasks.map((task) => ({
      title: task.title,
      capacity: String(task.capacity),
      startTime: shift.startTime,
      endTime: shift.endTime,
      shiftName: shift.name,
      days: (daysForShift(shift.days, choiceKeys) || []).join(",") || "all",
    }))
  );
  const fields = new Map(dateFieldsFor(dateSel, start));

  // --- action -----------------------------------------------------------
  const title = cleanText(details.title, TITLE_MAX);
  const eventDate = cleanText(start, 32) || null;
  if (!title) return { error: "The event needs a title." };
  if (eventDate && !isValidIsoDate(eventDate)) return { error: "The first date isn't a valid date." };
  if (eventDate && eventDate < today) return { error: "The first date has already passed." };

  const validSlots = posted
    .map((p, idx) => {
      const startTime = cleanText(p.startTime, 16) || null;
      const endTime = cleanText(p.endTime, 16) || null;
      const shiftName = cleanText(p.shiftName, SHIFT_NAME_MAX) || null;
      let slotTitle = cleanText(p.title, SLOT_TITLE_MAX);
      if (!slotTitle && (startTime || shiftName)) {
        slotTitle = (shiftName || (endTime ? `${startTime} – ${endTime}` : (startTime as string))).slice(
          0,
          SLOT_TITLE_MAX
        );
      }
      const rawCap = parseInt(p.capacity || "1", 10);
      const capacity = Number.isFinite(rawCap) ? Math.min(Math.max(rawCap, 1), 999) : 1;
      return { title: slotTitle, shiftName, capacity, startTime, endTime, displayOrder: idx, days: parseDayFilter(p.days) };
    })
    .filter((s) => s.title.length > 0)
    .slice(0, MAX_TASKS_PER_DATE);

  if (validSlots.length === 0) return { error: "There are no tasks to copy." };
  for (const s of validSlots) {
    if ((s.startTime && !isValidTime(s.startTime)) || (s.endTime && !isValidTime(s.endTime))) {
      return { error: `"${s.title}" has a time the form can't use.` };
    }
    if (s.startTime && s.endTime && timeToMinutes(s.endTime) <= timeToMinutes(s.startTime)) {
      return { error: `"${s.title}" ends before it starts (overnight shifts can't be copied yet).` };
    }
  }
  const daysByTask = new Map<string, string>();
  for (const s of validSlots) {
    const k = `${s.shiftName || ""}||${s.startTime || ""}||${s.endTime || ""}||${s.title.toLowerCase()}`;
    const d = serializeDayFilter(s.days);
    if (daysByTask.has(k) && daysByTask.get(k) !== d) {
      return { error: `"${s.title}" appears twice in the same shift on different days.` };
    }
    daysByTask.set(k, d);
  }
  if (posted.length > MAX_TASKS_PER_DATE) {
    return { error: `It has more than ${MAX_TASKS_PER_DATE} different tasks.` };
  }

  const specResult = parseDateSpec((name) => fields.get(name) ?? null, eventDate || "");
  if ("error" in specResult) return { error: specResult.error };
  const dateSpec = specResult.spec;
  if (dateSpec.mode !== "single" && !eventDate) return { error: "It has several days but no first date." };
  const dates =
    dateSpec.mode === "single" ? [] : expandDates(dateSpec, eventDate as string, MAX_SERIES_DAYS + 1);
  if (dateSpec.mode !== "single" && dates.length === 0) return { error: "Its schedule doesn't include any days." };
  if (dates.length > 0 && dates[dates.length - 1] > maxSeriesEnd(eventDate as string)) {
    return { error: "It runs for more than one year." };
  }

  const rows =
    dates.length === 0
      ? validSlots.map((slot) => ({ slot, date: details.eventDate || "" }))
      : dates.flatMap((date) =>
          validSlots.filter((slot) => dayFilterMatches(slot.days, date)).map((slot) => ({ slot, date }))
        );
  if (rows.length === 0) return { error: "No task runs on any of its days." };
  const limitError = dateLimitError(dates, rows.length);
  if (limitError) return { error: limitError };

  return {
    rows: rows.map(({ slot, date }) => ({
      date,
      shiftName: slot.shiftName || "",
      startTime: slot.startTime || "",
      endTime: slot.endTime || "",
      title: slot.title,
      capacity: slot.capacity,
    })),
  };
}

/**
 * What the event page shows for a list of slot rows (in display order): one
 * section per date, each listing its shifts (name + time) in first-seen order
 * with their tasks. Two sheets with the same view are the same sheet to
 * everyone looking at it — this is what a copy must reproduce.
 */
export function signupPageView(rows: SimulatedSlotRow[]): string {
  const byDate = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const groups = byDate.get(r.date) ?? new Map<string, string[]>();
    byDate.set(r.date, groups);
    const key = `${r.shiftName.trim()}||${r.startTime}||${r.endTime}`;
    groups.set(key, [...(groups.get(key) ?? []), `${r.title}|${r.capacity}`]);
  }
  return JSON.stringify(
    [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, groups]) => [date, [...groups.entries()]])
  );
}

// ---------------------------------------------------------------------------
// Resolving a sign-up prefill into form state
// ---------------------------------------------------------------------------

export type ResolvedSignup = {
  details: SignupDetails;
  shifts: SignupShift[];
  dateSel: DateSelection;
};

function concreteSpec(dates: RelativeDateSpec, start: string): DateSpec {
  if (dates.mode === "single") return { mode: "single" };
  if (dates.mode === "range") return { mode: "range", end: addDays(start, Math.max(1, dates.spanDays) - 1) };
  const ends = "after" in dates.ends ? { after: dates.ends.after } : { on: addDays(start, dates.ends.offsetDays) };
  return { mode: "repeat", rule: dates.rule, ends };
}

function concreteDays(filter: RelativeDayFilter, start: string): string[] | null {
  if (filter.kind === "all") return null;
  if (filter.kind === "dateOffsets") return filter.values.map((o) => addDays(start, o));
  return filter.values.map((w) => `w${w}`);
}

/**
 * Form state for a prefill with its first date at `start` ("" = undated).
 * Ids are deterministic: shift n is n, its tasks n*1000+1, n*1000+2, …
 */
export function materializeSignup(p: SignupPrefill, start: string, timezone: string, today: string): ResolvedSignup {
  const spec = concreteSpec(p.dates, start || today);
  return {
    details: {
      title: p.details.title,
      eventDate: start,
      description: p.details.description,
      location: p.details.location,
      organizerName: "",
      organizerEmail: "",
      timezone,
    },
    dateSel: start ? selectionFromSpec(spec, start) : defaultSelection(today),
    shifts: p.shifts.map((s, i) => ({
      id: i + 1,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      days: concreteDays(s.days, start),
      tasks: s.tasks.map((t, j) => ({ id: (i + 1) * 1000 + j + 1, title: t.title, capacity: t.capacity })),
    })),
  };
}

/**
 * Checks the resolved state survives the form exactly: every shift's day
 * filter must post as written (the form silently widens filters its day
 * choices can't show), and the action must accept the result.
 */
function checkSignupState(state: ResolvedSignup, today: string): { rows: SimulatedSlotRow[] } | Unsupported {
  const start = state.details.eventDate || today;
  const formSpec = selectionToSpec(state.dateSel, start);
  const sheetDates =
    formSpec.mode === "single" ? [start] : expandDates(formSpec, start, MAX_SERIES_DAYS + 1);
  const choiceKeys = dayChoicesFor(state.dateSel, sheetDates).map((c) => c.key);
  for (const shift of state.shifts) {
    const intended = shift.days ?? null;
    const posted = daysForShift(intended, choiceKeys);
    if (JSON.stringify(intended) !== JSON.stringify(posted)) {
      return unsupported("Some shifts run on days the create form can't pick.");
    }
  }
  const sim = simulateSignupSubmission(state, today);
  if ("error" in sim) return unsupported(sim.error);
  return sim;
}

export function resolveSignupPrefill(
  p: SignupPrefill,
  { today, timezone }: { today: string; timezone: string }
): ResolvedSignup | Unsupported {
  const start = resolveAnchor(p.anchor, today);
  if (start === null) return unsupported("Its dates can't be moved to the future.");
  if (!start && p.dates.mode !== "single") return unsupported("It has several days but no first date.");
  const state = materializeSignup(p, start, timezone, today);
  const check = checkSignupState(state, today);
  if (isUnsupported(check)) return check;
  return state;
}

// ---------------------------------------------------------------------------
// Resolving a poll prefill into form state
// ---------------------------------------------------------------------------

export type ResolvedPoll = {
  details: PollDetails;
  days: PollDayRow[];
  durationMinutes: number;
  notes: PrefillNote[];
};

export function resolvePollPrefill(
  p: PollPrefill,
  { today, timezone }: { today: string; timezone: string }
): ResolvedPoll | Unsupported {
  const anchorDate = resolveAnchor(p.anchor, today);
  if (!anchorDate) return unsupported("Its dates can't be moved to the future.");
  if (!cleanText(p.details.title, TITLE_MAX)) return unsupported("The poll needs a title.");
  if (!Number.isInteger(p.durationMinutes) || p.durationMinutes < 5 || p.durationMinutes > 1440) {
    return unsupported("Its duration isn't one the create form can use.");
  }
  if (p.options.length === 0) return unsupported("There are no options to copy.");
  if (p.options.length > MAX_SLOTS_PER_EVENT) {
    return unsupported(`It has more than ${MAX_SLOTS_PER_EVENT} options.`);
  }
  const seen = new Set<string>();
  const days: PollDayRow[] = [];
  for (const [i, o] of p.options.entries()) {
    const date = addDays(anchorDate, o.dayOffset);
    if (!isValidIsoDate(date) || date < today) return unsupported("An option's day can't be moved to the future.");
    if (!isValidTime(o.startTime)) return unsupported("An option has no usable start time.");
    const key = `${date}|${o.startTime}`;
    if (seen.has(key)) return unsupported("Two options would land on the same day and time.");
    seen.add(key);
    days.push({ id: i + 1, date, startTime: o.startTime, label: cleanText(o.label, SLOT_TITLE_MAX) });
  }
  return {
    details: {
      title: p.details.title,
      description: p.details.description,
      location: p.details.location,
      organizerName: "",
      organizerEmail: "",
      timezone,
    },
    days,
    durationMinutes: p.durationMinutes,
    notes: p.notes,
  };
}

// ---------------------------------------------------------------------------
// Copying an existing event
// ---------------------------------------------------------------------------

/** The only event fields a copy reads. No organizer, token, or response data. */
export type SourceEvent = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  location: string | null;
  eventDate: string | null;
  timezone: string;
  durationMinutes: number | null;
  settings: string | null;
};

/** The only slot fields a copy reads. `id` only breaks display-order ties. */
export type SourceSlot = {
  id: string;
  title: string;
  shiftName: string | null;
  capacity: number;
  slotDate: string | null;
  startTime: string | null;
  endTime: string | null;
  displayOrder: number;
};

function copyDetails(event: SourceEvent): PrefillDetails {
  return {
    title: cleanText(event.title, TITLE_MAX),
    description: cleanText(event.description, DESCRIPTION_MAX),
    location: cleanText(event.location, LOCATION_MAX),
    timezone: event.timezone || "UTC",
  };
}

function sortSlots(slots: SourceSlot[]): SourceSlot[] {
  return [...slots].sort((a, b) => a.displayOrder - b.displayOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Orders items so every list's own order is kept (a topological merge), ties
 * broken by first appearance. Null when two lists disagree.
 */
function mergeOrders(lists: string[][]): string[] | null {
  const firstSeen = new Map<string, number>();
  const after = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      if (!firstSeen.has(item)) {
        firstSeen.set(item, firstSeen.size);
        after.set(item, new Set());
        indegree.set(item, 0);
      }
    }
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      if (a !== b && !after.get(a)!.has(b)) {
        after.get(a)!.add(b);
        indegree.set(b, indegree.get(b)! + 1);
      }
    }
  }
  const out: string[] = [];
  const ready = [...firstSeen.keys()].filter((k) => indegree.get(k) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => firstSeen.get(a)! - firstSeen.get(b)!);
    const next = ready.shift()!;
    out.push(next);
    for (const b of after.get(next)!) {
      indegree.set(b, indegree.get(b)! - 1);
      if (indegree.get(b) === 0) ready.push(b);
    }
  }
  return out.length === firstSeen.size ? out : null;
}

function relativeDates(spec: DateSpec, start: string): RelativeDateSpec {
  if (spec.mode === "single") return { mode: "single" };
  if (spec.mode === "range") return { mode: "range", spanDays: daysBetween(start, spec.end) + 1 };
  // Rebuilt field by field so nothing unrecognised in stored settings rides along.
  const r = spec.rule;
  const rule: RepeatRule =
    r.type === "weekly"
      ? { type: "weekly", interval: Number(r.interval) || 1, weekdays: (r.weekdays || []).map(Number) }
      : r.type === "monthlyNth"
        ? { type: "monthlyNth", interval: Number(r.interval) || 1 }
        : { type: r.type };
  const ends =
    "after" in spec.ends
      ? { after: Math.max(1, Math.round(Number(spec.ends.after))) }
      : { offsetDays: daysBetween(start, spec.ends.on) };
  return { mode: "repeat", rule, ends };
}

function copyAnchor(spec: DateSpec, start: string | null): RelativeAnchor {
  if (!start) return { kind: "undated" };
  // Tomorrow at the earliest: a copy made today can't open on a day whose
  // shifts may already have started.
  if (spec.mode === "repeat" && spec.rule.type === "monthlyNth") {
    // The monthly rule reads its ordinal from the first date, so the new
    // first date must be the same occurrence (a 5th Monday stays a 5th
    // Monday — the 4th would silently turn "last" into "fourth").
    return { kind: "monthlyNth", weekday: weekdayOf(start), ordinal: weekdayOrdinalOf(start), minOffsetDays: 1 };
  }
  // Same weekday as the original first date keeps weekly intervals aligned.
  return { kind: "weekday", weekday: weekdayOf(start), minOffsetDays: 1 };
}

/**
 * Rebuilds a sign-up sheet as a prefill, or explains why the create form
 * can't reproduce it. Accepted only if the rebuilt form, expanded at the
 * original first date, shows exactly the same days, shifts, tasks, spots and
 * order as the source.
 */
export function signupPrefillFromEvent(event: SourceEvent, rawSlots: SourceSlot[]): { prefill: SignupPrefill } | Unsupported {
  if (event.type !== "SIGNUP_SHEET") return unsupported("That event isn't a sign-up sheet.");
  const slots = sortSlots(rawSlots);
  if (slots.length === 0) return unsupported("This sheet has no tasks to copy.");
  for (const s of slots) {
    if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 999) {
      return unsupported("Some tasks have a number of spots the create form can't set.");
    }
  }

  const eventDate = event.eventDate && isValidIsoDate(event.eventDate) ? event.eventDate : null;
  const spec = readDateSpec(event.settings);
  const dated = slots.some((s) => s.slotDate);
  if (spec.mode !== "single" && !eventDate) return unsupported("Its schedule has no first date.");
  if (spec.mode === "single" && dated) return unsupported("Its days don't match its schedule.");

  const effectiveDate = (s: SourceSlot) => s.slotDate || eventDate || "";
  const shiftKeyOf = (s: SourceSlot) => `${(s.shiftName || "").trim()}||${s.startTime || ""}||${s.endTime || ""}`;
  const scheduled = spec.mode === "single" ? [eventDate || ""] : expandDates(spec, eventDate as string, MAX_SERIES_DAYS + 1);
  const scheduledSet = new Set(scheduled);
  if (slots.some((s) => !scheduledSet.has(effectiveDate(s)))) {
    return unsupported("Some tasks are on days outside its schedule.");
  }

  // Per date: shifts in first-seen order, tasks in order within each shift —
  // what the page shows. A task's identity is shift + title + which
  // occurrence of that title it is within the shift on that day.
  type Occurrence = { id: string; shiftKey: string; slot: SourceSlot };
  const perDate = new Map<string, Map<string, Occurrence[]>>();
  for (const s of slots) {
    const date = effectiveDate(s);
    const groups = perDate.get(date) ?? new Map<string, Occurrence[]>();
    perDate.set(date, groups);
    const key = shiftKeyOf(s);
    const list = groups.get(key) ?? [];
    const n = list.filter((o) => o.slot.title === s.title).length;
    list.push({ id: `${key}##${s.title}##${n}`, shiftKey: key, slot: s });
    groups.set(key, list);
  }
  const datesAsc = [...perDate.keys()].sort();

  const shiftOrder = mergeOrders(datesAsc.map((d) => [...perDate.get(d)!.keys()]));
  if (!shiftOrder) return unsupported("Its shifts are in a different order on different days.");

  const taskOrderByShift = new Map<string, string[]>();
  for (const key of shiftOrder) {
    const order = mergeOrders(datesAsc.map((d) => (perDate.get(d)!.get(key) ?? []).map((o) => o.id)));
    if (!order) return unsupported("Its tasks are in a different order on different days.");
    taskOrderByShift.set(key, order);
  }

  // Each task's days and spots.
  const info = new Map<string, { slot: SourceSlot; dates: string[]; capacities: Set<number> }>();
  for (const d of datesAsc) {
    for (const list of perDate.get(d)!.values()) {
      for (const o of list) {
        const entry = info.get(o.id) ?? { slot: o.slot, dates: [], capacities: new Set<number>() };
        entry.dates.push(d);
        entry.capacities.add(o.slot.capacity);
        info.set(o.id, entry);
      }
    }
  }
  for (const entry of info.values()) {
    if (entry.capacities.size > 1) {
      return unsupported(`"${entry.slot.title}" has a different number of spots on different days.`);
    }
  }

  const scheduledWeekdays = [...new Set(scheduled.map(weekdayOf))];
  const filterFor = (dates: string[]): RelativeDayFilter | Unsupported => {
    if (dates.length === scheduled.length) return { kind: "all" };
    if (spec.mode === "range") {
      if (scheduled.length > 31) {
        return unsupported("Some tasks run on only some days of a range longer than 31 days.");
      }
      return { kind: "dateOffsets", values: dates.map((d) => daysBetween(eventDate as string, d)) };
    }
    if (spec.mode === "repeat" && scheduledWeekdays.length > 1) {
      const weekdays = [...new Set(dates.map(weekdayOf))].sort((a, b) => a - b);
      const reproduced = scheduled.filter((d) => weekdays.includes(weekdayOf(d)));
      if (reproduced.length === dates.length && reproduced.every((d, i) => d === dates[i])) {
        return { kind: "weekdays", values: weekdays };
      }
    }
    return unsupported("Some tasks skip dates in a way the create form can't repeat.");
  };

  // Shifts in order; within a shift, a new form shift wherever the day filter
  // changes (the form holds one filter per shift).
  const shifts: SignupPrefill["shifts"] = [];
  for (const key of shiftOrder) {
    let current: SignupPrefill["shifts"][number] | null = null;
    let currentFilter = "";
    for (const id of taskOrderByShift.get(key)!) {
      const entry = info.get(id)!;
      const filter = filterFor(entry.dates);
      if (isUnsupported(filter)) return filter;
      const f = JSON.stringify(filter);
      if (!current || f !== currentFilter) {
        current = {
          name: (entry.slot.shiftName || "").trim(),
          startTime: entry.slot.startTime || "",
          endTime: entry.slot.endTime || "",
          days: filter,
          tasks: [],
        };
        currentFilter = f;
        shifts.push(current);
      }
      current.tasks.push({ title: entry.slot.title, capacity: entry.slot.capacity });
    }
  }

  const prefill: SignupPrefill = {
    source: { kind: "clone", eventId: event.id, title: cleanText(event.title, TITLE_MAX) },
    details: copyDetails(event),
    anchor: copyAnchor(spec, eventDate),
    dates: relativeDates(spec, eventDate || ""),
    shifts,
  };

  // Round-trip gate: at the ORIGINAL first date, the rebuilt form must
  // produce exactly the sheet that exists.
  const today = eventDate || "2000-01-01";
  const state = materializeSignup(prefill, eventDate || "", prefill.details.timezone || "UTC", today);
  const check = checkSignupState(state, today);
  if (isUnsupported(check)) return check;
  const source = slots.map((s) => ({
    date: effectiveDate(s),
    shiftName: s.shiftName || "",
    startTime: s.startTime || "",
    endTime: s.endTime || "",
    title: s.title,
    capacity: s.capacity,
  }));
  if (signupPageView(check.rows) !== signupPageView(source)) {
    return unsupported("Its schedule has changes the create form can't reproduce.");
  }
  return { prefill };
}

function minutesBetween(start: string, end: string): number {
  return (timeToMinutes(end) - timeToMinutes(start) + 1440) % 1440 || 1440;
}

/**
 * Rebuilds a meeting poll as a prefill. Options keep their order, times, and
 * day offsets from the earliest option; the earliest lands on the next
 * matching weekday from tomorrow. Titles the create action generated are
 * blanked so they regenerate from the new dates.
 */
export function pollPrefillFromEvent(event: SourceEvent, rawSlots: SourceSlot[]): { prefill: PollPrefill } | Unsupported {
  if (event.type !== "TIME_POLL") return unsupported("That event isn't a meeting poll.");
  const slots = sortSlots(rawSlots);
  if (slots.length === 0) return unsupported("This poll has no options to copy.");
  if (slots.length > MAX_SLOTS_PER_EVENT) return unsupported(`It has more than ${MAX_SLOTS_PER_EVENT} options.`);

  const dates = slots.map((s) => s.slotDate || event.eventDate || "");
  if (dates.some((d) => !isValidIsoDate(d))) return unsupported("An option has no usable day.");

  const notes: PrefillNote[] = [];
  let duration: number;
  const timed = slots.filter((s) => s.startTime);
  if (timed.length === 0) {
    // All day: the create form can't make these any more (disclosed change).
    duration = 60;
    notes.push("allDayToHour");
  } else if (timed.length !== slots.length) {
    return unsupported("Some options have a start time and some don't.");
  } else if (event.durationMinutes != null) {
    duration = event.durationMinutes;
  } else {
    // Older polls stored no duration; read it off the options when they agree.
    const first = slots[0];
    if (!first.startTime || !first.endTime || !isValidTime(first.startTime) || !isValidTime(first.endTime)) {
      return unsupported("An option's time can't be read.");
    }
    duration = minutesBetween(first.startTime, first.endTime);
  }
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) {
    return unsupported("Its duration isn't one the create form can use.");
  }

  const options: PollPrefill["options"] = [];
  const earliest = [...dates].sort()[0];
  const seen = new Set<string>();
  for (const [i, s] of slots.entries()) {
    const date = dates[i];
    let startTime = "10:00";
    if (s.startTime) {
      if (!isValidTime(s.startTime)) return unsupported("An option has no usable start time.");
      if (!s.endTime || s.endTime !== addMinutesToTimeString(s.startTime, duration)) {
        return unsupported("An option's end time doesn't match the poll's duration.");
      }
      startTime = s.startTime;
    }
    const dayOffset = daysBetween(earliest, date);
    const key = `${dayOffset}|${startTime}`;
    if (seen.has(key)) return unsupported("Two options would land on the same day and time.");
    seen.add(key);
    const generated = pollDefaultTitle(date, s.startTime, s.startTime ? s.endTime : null);
    options.push({ dayOffset, startTime, label: s.title === generated ? "" : s.title });
  }

  return {
    prefill: {
      source: { kind: "clone", eventId: event.id, title: cleanText(event.title, TITLE_MAX) },
      details: copyDetails(event),
      anchor: { kind: "weekday", weekday: weekdayOf(earliest), minOffsetDays: 1 },
      durationMinutes: duration,
      options,
      notes,
    },
  };
}
