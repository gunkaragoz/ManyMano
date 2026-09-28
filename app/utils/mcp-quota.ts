// Daily budgets for the public MCP endpoint (per D1 database, per UTC day).
//
// - calls:  admitted `tools/call` messages. Discovery (initialize,
//   tools/list, notifications) never touches D1, so a WebMCP bridge that
//   lists tools on every page view can't drain the budget.
// - writes: validated create attempts admitted to persistence.
//
// Admission is one atomic conditional upsert per unit (no read-then-write),
// so concurrent requests can't overshoot. Admitted units are never refunded.
// Storage errors throw so callers fail closed. Confirmed exhaustion is
// cached in the isolate until the UTC day rolls over.

import {
  QUOTA_ALERT_THRESHOLDS,
  claimAlert,
  postWebhook,
  reserveCounterBelowLimitCount,
  utcDayString,
} from "./quota";

export const MCP_DAILY_LIMIT_DEFAULT = 2000;
export const MCP_WRITE_DAILY_LIMIT_DEFAULT = 200;

export type McpScope = "calls" | "writes";

export interface McpLimits {
  calls: number;
  writes: number;
}

export interface McpLimitsEnv {
  MCP_DAILY_LIMIT?: string;
  MCP_WRITE_DAILY_LIMIT?: string;
}

function parseLimit(raw: string | undefined, fallback: number, name: string): number {
  const text = (raw ?? "").trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text) || Number(text) <= 0) {
    // A typo must not quietly mean "unlimited" or "default".
    throw new Error(`[config] ${name} must be a positive integer, got ${JSON.stringify(raw)}.`);
  }
  return Number(text);
}

/** Missing values use the defaults; malformed values throw (fail closed). */
export function getMcpLimits(env: McpLimitsEnv): McpLimits {
  return {
    calls: parseLimit(env.MCP_DAILY_LIMIT, MCP_DAILY_LIMIT_DEFAULT, "MCP_DAILY_LIMIT"),
    writes: parseLimit(env.MCP_WRITE_DAILY_LIMIT, MCP_WRITE_DAILY_LIMIT_DEFAULT, "MCP_WRITE_DAILY_LIMIT"),
  };
}

export function mcpCounterKey(scope: McpScope, now: Date): string {
  return `mcp:${scope}:daily:${utcDayString(now)}`;
}

/** Seconds until the next UTC midnight (at least 1). */
export function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

const exhausted = new Set<string>();

/** Test hook: forget cached exhaustion. */
export function resetMcpQuotaCache(): void {
  exhausted.clear();
}

export interface McpAlertOpts {
  webhookUrl?: string;
  appName?: string;
  /** Defers alert delivery past the response (ctx.waitUntil). */
  defer?: (p: Promise<unknown>) => void;
}

/**
 * Admit one unit. Returns false when the day's budget is spent; throws when
 * the counter can't be read or written.
 */
export async function reserveMcpUnit(
  d1: D1Database,
  scope: McpScope,
  limits: McpLimits,
  now: Date,
  alerts: McpAlertOpts = {}
): Promise<boolean> {
  const key = mcpCounterKey(scope, now);
  if (exhausted.has(key)) return false;
  const limit = limits[scope];
  const count = await reserveCounterBelowLimitCount(d1, key, limit, now.toISOString());
  if (count === null) {
    if (exhausted.size > 16) exhausted.clear(); // keys are per day; keep it tiny
    exhausted.add(key);
    return false;
  }
  // Exactly one admission lands on each threshold count, so only that
  // request pays for the alert claim.
  const webhookUrl = (alerts.webhookUrl ?? "").trim();
  if (webhookUrl) {
    for (const pct of QUOTA_ALERT_THRESHOLDS) {
      if (count !== Math.ceil((limit * pct) / 100)) continue;
      const task = sendMcpAlert(d1, { scope, pct, used: count, limit, now, webhookUrl, appName: alerts.appName });
      if (alerts.defer) alerts.defer(task);
      else await task;
    }
  }
  return true;
}

async function sendMcpAlert(
  d1: D1Database,
  a: { scope: McpScope; pct: number; used: number; limit: number; now: Date; webhookUrl: string; appName?: string }
): Promise<void> {
  try {
    const day = utcDayString(a.now);
    if (!(await claimAlert(d1, `mcp:alert:${a.scope}:${a.pct}:${day}`, a.now.toISOString()))) return;
    const app = (a.appName ?? "").trim() || "App";
    const what = a.scope === "calls" ? "MCP tool calls" : "MCP event creations";
    const tail =
      a.pct >= 100
        ? "Further requests are refused until 00:00 UTC."
        : "Heads up — approaching the daily limit.";
    await postWebhook(a.webhookUrl, `⚠️ ${app} ${what}: ${a.used}/${a.limit} today (${a.pct}%). ${tail}`);
  } catch {
    // Alerts are best-effort; they never change a tool result.
  }
}

export interface McpUsage {
  day: string;
  calls: number | null;
  writes: number | null;
  resetsInSeconds: number;
}

/** Aggregate counters for /api/usage. Unreadable counters are null, not 0. */
export async function getMcpUsage(d1: D1Database, now = new Date()): Promise<McpUsage> {
  const read = async (scope: McpScope): Promise<number | null> => {
    try {
      const row = await d1
        .prepare("SELECT count FROM usage_counters WHERE key = ?1")
        .bind(mcpCounterKey(scope, now))
        .first<{ count: number }>();
      return row?.count ?? 0;
    } catch {
      return null;
    }
  };
  const [calls, writes] = await Promise.all([read("calls"), read("writes")]);
  return { day: utcDayString(now), calls, writes, resetsInSeconds: secondsUntilUtcMidnight(now) };
}
