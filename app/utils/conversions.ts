// Conversion counters for the SEO loop (see seo/README.md).
//
// One conversion = one event created. Counted per UTC day, event type,
// channel and landing page in usage_counters (same table as the email quota
// counters), so no migration and no per-person data:
//
//   conv:YYYY-MM-DD:<SIGNUP_SHEET|TIME_POLL>:<channel>:<landing path>
//
// Read back as aggregates by GET /api/conversions and scripts/seo/weekly.mjs.

import { normalizeChannel, normalizeLandingPath, type Channel } from "~/utils/attribution";
import { TEMPLATES, templatePath } from "~/utils/templates";

export type ConversionType = "SIGNUP_SHEET" | "TIME_POLL";

const KEY_PREFIX = "conv:";

/** Server-side landing check: template pages must name a real template. */
export function resolveLanding(raw: unknown): string {
  const landing = normalizeLandingPath(typeof raw === "string" ? raw : null);
  if (/^\/(signup-sheet|meeting-poll)\//.test(landing) && !TEMPLATES.some((t) => templatePath(t) === landing)) {
    return "other";
  }
  return landing;
}

export function conversionKey(day: string, type: ConversionType, channel: Channel, landing: string): string {
  return `${KEY_PREFIX}${day}:${type}:${channel}:${landing}`;
}

export function parseConversionKey(
  key: string
): { day: string; type: ConversionType; channel: Channel; landing: string } | null {
  const m = key.match(/^conv:(\d{4}-\d{2}-\d{2}):(SIGNUP_SHEET|TIME_POLL):([a-z]+):(.+)$/);
  if (!m) return null;
  return { day: m[1], type: m[2] as ConversionType, channel: normalizeChannel(m[3]), landing: m[4] };
}

/** Count one created event. Never throws: attribution must not break creation. */
export async function recordConversion(
  d1: D1Database,
  type: ConversionType,
  formData: FormData,
  now = new Date()
): Promise<void> {
  try {
    const key = conversionKey(
      now.toISOString().slice(0, 10),
      type,
      normalizeChannel(formData.get("attrChannel")),
      resolveLanding(formData.get("attrLanding"))
    );
    await d1
      .prepare(
        `INSERT INTO usage_counters (key, count, updated_at) VALUES (?1, 1, ?2)
         ON CONFLICT(key) DO UPDATE SET count = count + 1, updated_at = ?2`
      )
      .bind(key, now.toISOString())
      .run();
  } catch {
    // Advisory only.
  }
}

export type ConversionRow = { day: string; type: ConversionType; channel: Channel; landing: string; count: number };

export const CONVERSIONS_MAX_DAYS = 90;

export function clampConversionDays(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return 28;
  return Math.min(n, CONVERSIONS_MAX_DAYS);
}

/** All conversion rows for the last `days` UTC days, today included. */
export async function getConversions(d1: D1Database, days: number, now = new Date()): Promise<ConversionRow[]> {
  const start = new Date(now.getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  // Keys sort lexically by day, so a range on the key is a range on the date.
  const { results } = await d1
    .prepare("SELECT key, count FROM usage_counters WHERE key >= ?1 AND key < ?2 ORDER BY key")
    .bind(`${KEY_PREFIX}${start}`, `${KEY_PREFIX}9`)
    .all<{ key: string; count: number }>();
  const rows: ConversionRow[] = [];
  for (const r of results ?? []) {
    const parsed = parseConversionKey(r.key);
    if (parsed) rows.push({ ...parsed, count: r.count });
  }
  return rows;
}
