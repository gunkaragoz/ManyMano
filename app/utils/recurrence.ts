// Date specs for multi-day / repeating sign-up sheets.
//
// A sheet stores one DateSpec in events.settings (JSON, previously unused).
// The spec is expanded server-side into one event_slots row per (date x task),
// each carrying slot_date — the column polls already use. Sheets created before
// this feature have no spec and no slot dates, so every helper here treats
// "missing" as the historical single-day behaviour.
//
// All arithmetic is on plain "YYYY-MM-DD" calendar days (the same way
// events.event_date is treated everywhere else) — never on local Date objects,
// so a viewer's timezone can never shift a generated day.

/**
 * How far a sheet may run. A school year is the longest real schedule anyone
 * asks for ("every Tuesday, September to June"), so a sheet covers at most one
 * year from its first date — a rule an organizer can reason about, unlike a
 * bare count of dates.
 */
export const MAX_SERIES_DAYS = 365;

export type RepeatRule =
  | { type: "daily" }
  /** Monday–Friday. */
  | { type: "weekdays" }
  /** Every `interval` weeks on the given weekdays (0 = Sunday). */
  | { type: "weekly"; interval: number; weekdays: number[] }
  /** Every `interval` months on the same weekday-of-month as the start date. */
  | { type: "monthlyNth"; interval: number };

/** A series always ends: on a date, or after N occurrences. */
export type EndRule = { on: string } | { after: number };

export type DateSpec =
  | { mode: "single" }
  | { mode: "range"; end: string }
  | { mode: "repeat"; rule: RepeatRule; ends: EndRule };

export const SINGLE_SPEC: DateSpec = { mode: "single" };

/** The last date a sheet starting on `start` is allowed to reach. */
export function maxSeriesEnd(start: string): string {
  return addDays(start, MAX_SERIES_DAYS);
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const ORDINAL_WORDS = ["first", "second", "third", "fourth", "last"];
/** Safety net so a malformed spec can never spin the generator. */
const MAX_SCAN_STEPS = 2000;

function toUtc(date: string): Date | null {
  const m = date.match(ISO_RE);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (dt.getUTCFullYear() !== Number(m[1]) || dt.getUTCDate() !== Number(m[3])) return null;
  return dt;
}

function toIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** Calendar-day arithmetic: "2026-02-28" + 1 = "2026-03-01". */
export function addDays(date: string, days: number): string {
  const dt = toUtc(date);
  if (!dt) return date;
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIso(dt);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const dt = toUtc(date);
  return dt ? dt.getUTCDay() : 0;
}

/** 1st/2nd/3rd/4th occurrence of that weekday in its month; 5 means "last". */
export function weekdayOrdinalOf(date: string): number {
  const dt = toUtc(date);
  if (!dt) return 1;
  return Math.ceil(dt.getUTCDate() / 7);
}

/**
 * The `ordinal`-th `weekday` of the given month, or null when that month has
 * no such day. Ordinal 5 means the last occurrence, which always exists.
 */
function nthWeekdayOfMonth(year: number, month: number, ordinal: number, weekday: number): string | null {
  if (ordinal >= 5) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
    return toIso(last);
  }
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (ordinal - 1) * 7;
  const dt = new Date(Date.UTC(year, month, day));
  if (dt.getUTCMonth() !== ((month % 12) + 12) % 12) return null;
  return toIso(dt);
}

function normalizeWeekdays(values: number[]): number[] {
  return [...new Set(values.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
    (a, b) => a - b
  );
}

function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), 12);
}

/**
 * Every date the spec produces, in ascending order, starting at `start`.
 * Returns at most `max` dates so an over-long series can be detected by the
 * caller (ask for one more than the limit) instead of being generated in full.
 */
export function expandDates(spec: DateSpec, start: string, max = 400): string[] {
  if (!toUtc(start) || max <= 0) return [];
  if (spec.mode === "single") return [start];

  if (spec.mode === "range") {
    if (!toUtc(spec.end) || spec.end < start) return [start];
    const out: string[] = [];
    for (let d = start; d <= spec.end && out.length < max; d = addDays(d, 1)) out.push(d);
    return out;
  }

  const endOn = "on" in spec.ends ? spec.ends.on : null;
  const endAfter = "after" in spec.ends ? Math.max(1, Math.round(spec.ends.after)) : null;
  if (endOn && (!toUtc(endOn) || endOn < start)) return [start];
  const limit = Math.min(max, endAfter ?? max);
  const out: string[] = [];

  if (spec.rule.type === "monthlyNth") {
    const interval = clampInterval(spec.rule.interval);
    const weekday = weekdayOf(start);
    const ordinal = weekdayOrdinalOf(start);
    const from = toUtc(start)!;
    let year = from.getUTCFullYear();
    let month = from.getUTCMonth();
    for (let step = 0; step < MAX_SCAN_STEPS && out.length < limit; step++) {
      const candidate = nthWeekdayOfMonth(year, month, ordinal, weekday);
      month += interval;
      if (month > 11) {
        year += Math.floor(month / 12);
        month = ((month % 12) + 12) % 12;
      }
      if (!candidate || candidate < start) continue;
      if (endOn && candidate > endOn) break;
      out.push(candidate);
    }
    return out;
  }

  const weekdays =
    spec.rule.type === "weekly"
      ? normalizeWeekdays(spec.rule.weekdays)
      : spec.rule.type === "weekdays"
        ? [1, 2, 3, 4, 5]
        : null;
  if (weekdays && weekdays.length === 0) return [start];
  const interval = spec.rule.type === "weekly" ? clampInterval(spec.rule.interval) : 1;
  // Weeks are counted from the Sunday of the start date's week, so "every 2
  // weeks" stays aligned with the week the organizer picked.
  const weekAnchor = addDays(start, -weekdayOf(start));

  for (let step = 0, day = start; step < MAX_SCAN_STEPS && out.length < limit; step++, day = addDays(day, 1)) {
    if (endOn && day > endOn) break;
    if (weekdays && !weekdays.includes(weekdayOf(day))) continue;
    if (interval > 1) {
      const weekIndex = Math.floor(daysBetween(weekAnchor, day) / 7);
      if (weekIndex % interval !== 0) continue;
    }
    out.push(day);
  }
  return out;
}

function daysBetween(from: string, to: string): number {
  const a = toUtc(from);
  const b = toUtc(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** "Weekly on Thursday", "Every 2 weeks on Mon, Wed", "Monthly on the third Monday". */
export function describeSpec(spec: DateSpec, start: string): string {
  if (spec.mode === "single") return "Does not repeat";
  if (spec.mode === "range") return "Every day in the range";
  const rule = spec.rule;
  if (rule.type === "daily") return "Every day";
  if (rule.type === "weekdays") return "Every weekday (Monday to Friday)";
  if (rule.type === "weekly") {
    const days = normalizeWeekdays(rule.weekdays.length ? rule.weekdays : [weekdayOf(start)]);
    const names = days.map((d) => WEEKDAY_NAMES[d]);
    const list = names.length > 1 ? names.map((n) => n.slice(0, 3)).join(", ") : names[0];
    const every = clampInterval(rule.interval);
    return every === 1 ? `Weekly on ${list}` : `Every ${every} weeks on ${list}`;
  }
  const ordinal = ORDINAL_WORDS[Math.min(weekdayOrdinalOf(start), 5) - 1];
  const every = clampInterval(rule.interval);
  const suffix = `the ${ordinal} ${WEEKDAY_NAMES[weekdayOf(start)]}`;
  return every === 1 ? `Monthly on ${suffix}` : `Every ${every} months on ${suffix}`;
}

/**
 * Repeat presets, written from the date the organizer picked. "Does not
 * repeat" is not one of them — that is the One day mode, not a repeat rule.
 */
export function presetsFor(start: string, defaultEnd: string): { key: string; label: string; spec: DateSpec }[] {
  const weekday = weekdayOf(start);
  const ordinal = ORDINAL_WORDS[Math.min(weekdayOrdinalOf(start), 5) - 1];
  const ends: EndRule = { on: defaultEnd };
  return [
    { key: "daily", label: "Every day", spec: { mode: "repeat", rule: { type: "daily" }, ends } },
    {
      key: "weekly",
      label: `Weekly on ${WEEKDAY_NAMES[weekday]}`,
      spec: { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [weekday] }, ends },
    },
    {
      key: "monthly",
      label: `Monthly on the ${ordinal} ${WEEKDAY_NAMES[weekday]}`,
      spec: { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends },
    },
    {
      key: "weekdays",
      label: "Every weekday (Monday to Friday)",
      spec: { mode: "repeat", rule: { type: "weekdays" }, ends },
    },
  ];
}

/**
 * Which days a shift runs on. null = every date (the default, and what every
 * pre-existing sheet means). Dates are used for a range, weekdays for a repeat.
 */
export type DayFilter =
  | { kind: "dates"; values: string[] }
  | { kind: "weekdays"; values: number[] }
  | null;

/** Parses the per-task `slotDays` field: "all", "2026-11-17,2026-11-19" or "w1,w3". */
export function parseDayFilter(raw: string | null | undefined): DayFilter {
  const value = (raw || "").trim();
  if (!value || value === "all") return null;
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.every((p) => /^w[0-6]$/.test(p))) {
    const values = normalizeWeekdays(parts.map((p) => Number(p.slice(1))));
    return values.length ? { kind: "weekdays", values } : null;
  }
  const values = [...new Set(parts.filter((p) => ISO_RE.test(p)))].sort();
  return values.length ? { kind: "dates", values } : null;
}

export function dayFilterMatches(filter: DayFilter, date: string): boolean {
  if (!filter) return true;
  if (filter.kind === "dates") return filter.values.includes(date);
  return filter.values.includes(weekdayOf(date));
}

export function serializeDayFilter(filter: DayFilter): string {
  if (!filter) return "all";
  return filter.kind === "dates" ? filter.values.join(",") : filter.values.map((w) => `w${w}`).join(",");
}

function isRepeatRule(value: unknown): value is RepeatRule {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "daily" || type === "weekdays" || type === "weekly" || type === "monthlyNth";
}

/** Reads the spec back out of events.settings. Anything unrecognised → single. */
export function readDateSpec(settings: string | null | undefined): DateSpec {
  if (!settings) return SINGLE_SPEC;
  let parsed: unknown;
  try {
    parsed = JSON.parse(settings);
  } catch {
    return SINGLE_SPEC;
  }
  const dates = (parsed as { dates?: unknown } | null)?.dates as Partial<DateSpec> | undefined;
  if (!dates || typeof dates !== "object") return SINGLE_SPEC;
  if (dates.mode === "range" && typeof (dates as { end?: unknown }).end === "string") {
    return { mode: "range", end: (dates as { end: string }).end };
  }
  if (dates.mode === "repeat") {
    const rule = (dates as { rule?: unknown }).rule;
    const ends = (dates as { ends?: unknown }).ends as EndRule | undefined;
    const endsOk =
      !!ends &&
      typeof ends === "object" &&
      ((typeof (ends as { on?: unknown }).on === "string") ||
        typeof (ends as { after?: unknown }).after === "number");
    if (isRepeatRule(rule) && endsOk) return { mode: "repeat", rule, ends: ends as EndRule };
  }
  return SINGLE_SPEC;
}

/** Merges the spec into existing settings JSON instead of replacing it. */
export function writeDateSpec(settings: string | null | undefined, spec: DateSpec): string {
  let base: Record<string, unknown> = {};
  if (settings) {
    try {
      const parsed = JSON.parse(settings);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {};
    }
  }
  if (spec.mode === "single") delete base.dates;
  else base.dates = spec;
  return JSON.stringify(base);
}

/**
 * Builds a spec from create-form fields. Returns an error message instead of
 * throwing so the action can answer with a 400 the same way it does elsewhere.
 */
export function parseDateSpec(
  get: (name: string) => string | null,
  start: string
): { spec: DateSpec } | { error: string } {
  const mode = (get("dateMode") || "single").trim();
  if (mode === "single") return { spec: SINGLE_SPEC };

  if (mode === "range") {
    const end = (get("dateEnd") || "").trim();
    if (!toUtc(end)) return { error: "Pick a valid end date." };
    if (end < start) return { error: "The end date must be on or after the start date." };
    return { spec: { mode: "range", end } };
  }

  if (mode !== "repeat") return { error: "Unsupported date option." };

  const type = (get("repeatType") || "").trim();
  let rule: RepeatRule;
  if (type === "daily") rule = { type: "daily" };
  else if (type === "weekdays") rule = { type: "weekdays" };
  else if (type === "monthlyNth") rule = { type: "monthlyNth", interval: clampInterval(Number(get("repeatInterval") || 1)) };
  else if (type === "weekly") {
    const weekdays = normalizeWeekdays(
      (get("repeatWeekdays") || "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
    );
    rule = {
      type: "weekly",
      interval: clampInterval(Number(get("repeatInterval") || 1)),
      weekdays: weekdays.length ? weekdays : [weekdayOf(start)],
    };
  } else return { error: "Pick how the sheet should repeat." };

  const endMode = (get("repeatEndMode") || "on").trim();
  let ends: EndRule;
  if (endMode === "after") {
    const count = Math.round(Number(get("repeatCount") || 0));
    if (!Number.isFinite(count) || count < 1) return { error: "Enter how many times the sheet repeats." };
    ends = { after: count };
  } else {
    const on = (get("repeatEndDate") || "").trim();
    if (!toUtc(on)) return { error: "Pick a valid date for when the repeat ends." };
    if (on < start) return { error: "The repeat must end on or after the first date." };
    ends = { on };
  }

  return { spec: { mode: "repeat", rule, ends } };
}
