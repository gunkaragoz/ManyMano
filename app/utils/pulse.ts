// Pulse aggregation — public, aggregate-only stats for /pulse + /api/pulse.
// No PII ever leaves D1: counts, day buckets (UTC), timezone names, response mix.

export const PULSE_DAY_OPTIONS = [7, 30, 90] as const;
export const PULSE_DEFAULT_DAYS = 30;
export const PULSE_MAX_DAYS = 90; // capped well within the retention window

export function clampPulseDays(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (n === 7 || n === 30 || n === 90) return n;
  return PULSE_DEFAULT_DAYS;
}

export interface PulseDayPoint {
  day: string; // YYYY-MM-DD (UTC)
  label: string; // "Sep 9"
  events: number;
  signups: number;
  votes: number;
}

export interface PulseTimezoneRow {
  timezone: string;
  city: string;
  region: string;
  offsetLabel: string | null;
  offsetMinutes: number | null;
  count: number;
  pct: number;
}

export interface PulseStats {
  days: number;
  generatedAt: string;
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD
  totals: {
    events: number;
    signupSheets: number;
    polls: number;
    slots: number;
    signups: number;
    votes: number;
    responses: number;
    yes: number;
    maybe: number;
    finalized: number;
    timezones: number;
  };
  active7d: { events: number; signups: number; votes: number };
  deltas: {
    // current window vs previous equal-length window, in percentage points-ish pct change
    events: number | null;
    signups: number | null;
    votes: number | null;
  };
  daily: PulseDayPoint[];
  timezones: PulseTimezoneRow[];
  regions: Array<{ region: string; count: number; pct: number }>;
  offsetSpread: { min: number | null; max: number | null; bins: Array<{ label: string; count: number }> };
  engagement: {
    avgSignupsPerSheet: number;
    avgVotesPerPoll: number;
    avgSlotsPerEvent: number;
    finalizePct: number;
    yesPct: number;
    maybePct: number;
  };
}

type D1 = D1Database;

async function count(d1: D1, sql: string, ...params: unknown[]): Promise<number> {
  try {
    const row = await d1
      .prepare(sql)
      .bind(...(params as never[]))
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

async function groupedDayCounts(
  d1: D1,
  table: string,
  cutoffIso: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await d1
      .prepare(
        `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM ${table} WHERE created_at >= ?1 GROUP BY day`
      )
      .bind(cutoffIso)
      .all<{ day: string; n: number }>();
    for (const r of res.results ?? []) {
      if (r?.day) out.set(r.day, r.n ?? 0);
    }
  } catch {
    // fresh DB / missing table -> empty map
  }
  return out;
}

function dayRange(days: number, now: Date): string[] {
  const out: string[] = [];
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function shortLabel(isoDay: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = isoDay.split("-").map(Number);
  if (!m || !d) return isoDay;
  return `${months[m - 1]} ${d}`;
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Offset minutes east of UTC for a zone at `at`. Null when unknown. Never throws. */
function offsetMinutesSafe(tz: string, at: Date): number | null {
  try {
    if (tz === "UTC") return 0;
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
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

function offsetLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `GMT${sign}${hh}:${mm}`;
}

function cityOf(tz: string): string {
  if (tz === "UTC") return "UTC";
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

function regionOf(tz: string): string {
  const parts = tz.split("/");
  return parts.length > 1 ? parts[0].replace(/_/g, " ") : "UTC";
}

export async function getPulseStats(d1: D1, days: number, now = new Date()): Promise<PulseStats> {
  const windowDays = clampPulseDays(days);
  const generatedAt = now.toISOString();
  const cutoffIso = new Date(now.getTime() - windowDays * 86400_000).toISOString();
  const prevCutoffIso = new Date(now.getTime() - windowDays * 2 * 86400_000).toISOString();
  const weekCutoffIso = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const dayKeys = dayRange(windowDays, now);

  const [
    totalEvents,
    signupSheets,
    polls,
    finalized,
    totalSlots,
    totalSignups,
    totalVotes,
    totalResponses,
    yesTotal,
    maybeTotal,
    distinctTzRows,
    rawTzRows,
    eventsByDay,
    signupsByDay,
    votesByDay,
    activeEvents7,
    activeSignups7,
    activeVotes7,
    curEvents,
    prevEvents,
    curSignups,
    prevSignups,
    curVotes,
    prevVotes,
  ] = await Promise.all([
    count(d1, "SELECT COUNT(*) AS n FROM events"),
    count(d1, "SELECT COUNT(*) AS n FROM events WHERE type = 'SIGNUP_SHEET'"),
    count(d1, "SELECT COUNT(*) AS n FROM events WHERE type = 'TIME_POLL'"),
    count(d1, "SELECT COUNT(*) AS n FROM events WHERE status = 'FINALIZED'"),
    count(d1, "SELECT COUNT(*) AS n FROM event_slots"),
    count(d1, "SELECT COUNT(*) AS n FROM signups WHERE status = 'CONFIRMED'"),
    count(d1, "SELECT COUNT(*) AS n FROM poll_votes"),
    count(d1, "SELECT COUNT(*) AS n FROM poll_vote_entries"),
    count(d1, "SELECT COUNT(*) AS n FROM poll_vote_entries WHERE response = 'YES'"),
    count(d1, "SELECT COUNT(*) AS n FROM poll_vote_entries WHERE response = 'MAYBE'"),
    (async () => {
      try {
        const r = await d1
          .prepare("SELECT COUNT(DISTINCT timezone) AS n FROM events")
          .first<{ n: number }>();
        return r?.n ?? 0;
      } catch {
        return 0;
      }
    })(),
    (async () => {
      try {
        const r = await d1
          .prepare(
            "SELECT timezone AS tz, COUNT(*) AS n FROM events GROUP BY timezone ORDER BY n DESC LIMIT 10"
          )
          .all<{ tz: string; n: number }>();
        return r.results ?? [];
      } catch {
        return [];
      }
    })(),
    groupedDayCounts(d1, "events", cutoffIso),
    groupedDayCounts(d1, "signups", cutoffIso),
    groupedDayCounts(d1, "poll_votes", cutoffIso),
    count(d1, "SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1", weekCutoffIso),
    count(d1, "SELECT COUNT(*) AS n FROM signups WHERE created_at >= ?1", weekCutoffIso),
    count(d1, "SELECT COUNT(*) AS n FROM poll_votes WHERE created_at >= ?1", weekCutoffIso),
    count(d1, "SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1", cutoffIso),
    count(
      d1,
      "SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1 AND created_at < ?2",
      prevCutoffIso,
      cutoffIso
    ),
    count(d1, "SELECT COUNT(*) AS n FROM signups WHERE created_at >= ?1", cutoffIso),
    count(
      d1,
      "SELECT COUNT(*) AS n FROM signups WHERE created_at >= ?1 AND created_at < ?2",
      prevCutoffIso,
      cutoffIso
    ),
    count(d1, "SELECT COUNT(*) AS n FROM poll_votes WHERE created_at >= ?1", cutoffIso),
    count(
      d1,
      "SELECT COUNT(*) AS n FROM poll_votes WHERE created_at >= ?1 AND created_at < ?2",
      prevCutoffIso,
      cutoffIso
    ),
  ]);

  const daily: PulseDayPoint[] = dayKeys.map((day) => ({
    day,
    label: shortLabel(day),
    events: eventsByDay.get(day) ?? 0,
    signups: signupsByDay.get(day) ?? 0,
    votes: votesByDay.get(day) ?? 0,
  }));

  // Timezone rows (server-safe formatting, no dependency on timezones.ts).
  const tzTotal = rawTzRows.reduce((s, r) => s + (r.n ?? 0), 0) || 1;
  const timezones: PulseTimezoneRow[] = rawTzRows
    .filter((r) => r.tz)
    .map((r) => {
      const tz = r.tz.trim() || "UTC";
      const off = offsetMinutesSafe(tz, now);
      return {
        timezone: tz,
        city: cityOf(tz),
        region: regionOf(tz),
        offsetLabel: offsetLabel(off),
        offsetMinutes: off,
        count: r.n ?? 0,
        pct: Math.round(((r.n ?? 0) / Math.max(1, totalEvents)) * 100),
      };
    })
    .slice(0, 8);
  void tzTotal;

  // Region rollup across ALL event timezones (not just top 8).
  let regionCounts = new Map<string, number>();
  try {
    const all = await d1
      .prepare("SELECT timezone AS tz, COUNT(*) AS n FROM events GROUP BY timezone")
      .all<{ tz: string; n: number }>();
    for (const r of all.results ?? []) {
      const region = regionOf((r.tz || "UTC").trim() || "UTC");
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + (r.n ?? 0));
    }
  } catch {
    regionCounts = new Map();
  }
  const regions = [...regionCounts.entries()]
    .map(([region, cnt]) => ({
      region,
      count: cnt,
      pct: totalEvents > 0 ? Math.round((cnt / totalEvents) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // UTC-offset coverage: min/max + coarse bins for the histogram strip.
  const offsets = timezones.map((t) => t.offsetMinutes).filter((o): o is number => o !== null);
  const min = offsets.length ? Math.min(...offsets) : null;
  const max = offsets.length ? Math.max(...offsets) : null;
  const binDefs = ["UTC-12..-8", "UTC-7..-4", "UTC-3..-1", "UTC±0..+2", "UTC+3..+6", "UTC+7..+10", "UTC+11..+14"];
  const bins = binDefs.map((label) => ({ label, count: 0 }));
  try {
    const all = await d1.prepare("SELECT DISTINCT timezone AS tz FROM events").all<{ tz: string }>();
    for (const r of all.results ?? []) {
      const off = offsetMinutesSafe((r.tz || "UTC").trim() || "UTC", now);
      if (off === null) continue;
      const h = off / 60;
      const idx = h <= -8 ? 0 : h <= -4 ? 1 : h <= -1 ? 2 : h <= 2 ? 3 : h <= 6 ? 4 : h <= 10 ? 5 : 6;
      bins[idx].count += 1;
    }
  } catch {
    // leave bins empty
  }

  const engagement = {
    avgSignupsPerSheet: signupSheets > 0 ? Math.round((totalSignups / signupSheets) * 10) / 10 : 0,
    avgVotesPerPoll: polls > 0 ? Math.round((totalVotes / polls) * 10) / 10 : 0,
    avgSlotsPerEvent: totalEvents > 0 ? Math.round((totalSlots / totalEvents) * 10) / 10 : 0,
    finalizePct: polls > 0 ? Math.round((finalized / polls) * 100) : 0,
    yesPct: totalResponses > 0 ? Math.round((yesTotal / totalResponses) * 100) : 0,
    maybePct: totalResponses > 0 ? Math.round((maybeTotal / totalResponses) * 100) : 0,
  };

  return {
    days: windowDays,
    generatedAt,
    rangeStart: dayKeys[0] ?? generatedAt.slice(0, 10),
    rangeEnd: dayKeys[dayKeys.length - 1] ?? generatedAt.slice(0, 10),
    totals: {
      events: totalEvents,
      signupSheets,
      polls,
      slots: totalSlots,
      signups: totalSignups,
      votes: totalVotes,
      responses: totalResponses,
      yes: yesTotal,
      maybe: maybeTotal,
      finalized,
      timezones: distinctTzRows,
    },
    active7d: { events: activeEvents7, signups: activeSignups7, votes: activeVotes7 },
    deltas: {
      events: pctChange(curEvents, prevEvents),
      signups: pctChange(curSignups, prevSignups),
      votes: pctChange(curVotes, prevVotes),
    },
    daily,
    timezones,
    regions,
    offsetSpread: { min, max, bins },
    engagement,
  };
}
