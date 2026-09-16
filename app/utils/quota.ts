// Free-tier quota tracking + webhook alerts.
//
// Problem: Resend Free stops sending at 100/day / 3,000/month (429, sending
// paused) and Cloudflare Free fails D1/Workers queries past daily limits —
// with no bill, just errors. Cloudflare emails the account owner at ~90% on
// its own, but Resend has no proactive alert: it only returns
// `x-resend-daily-quota` / `x-resend-monthly-quota` response headers (free
// plan) and 429s when exhausted. This module closes that gap:
//
// - Every successful send increments UTC day/month counters in D1
//   (atomic upserts, so concurrent signups can't lose counts).
// - When usage crosses 80/90/100% (or Resend reports exhaustion), a single
//   Discord/Slack webhook fires per threshold per period (atomic claim, so
//   concurrent requests can't double-alert).
// - Emailing the alert via the mail provider itself would be self-defeating
//   once the quota is gone — hence a Discord/Slack incoming webhook (set
//   ALERT_WEBHOOK_URL). The same JSON payload carries both `text` (Slack)
//   and `content` (Discord), so one URL works for either.
//
// Limits are provider-aware (see getEmailLimits): Resend free defaults,
// SMTP/SES-sized defaults, or explicit EMAIL_DAILY_LIMIT /
// EMAIL_MONTHLY_LIMIT overrides.
//
// Everything here is best-effort and never throws: quota tracking must never
// break signups, votes, or event creation.

import type { EmailProvider } from "./email";
import { providerLabel } from "./email";

export const RESEND_DAILY_LIMIT = 100;
export const RESEND_MONTHLY_LIMIT = 3000;

/**
 * Default alert baseline for the smtp provider (SES-sized production
 * starting point: ~50k/day). SES/SMTP limits vary per account — override
 * with EMAIL_DAILY_LIMIT / EMAIL_MONTHLY_LIMIT (see getEmailLimits).
 */
export const SMTP_DEFAULT_DAILY_LIMIT = 50000;
export const SMTP_DEFAULT_MONTHLY_LIMIT = 1500000;

export interface EmailLimits {
  dailyLimit: number;
  monthlyLimit: number;
}

/** Env keys for quota-limit overrides (both optional). */
export interface EmailLimitsEnv {
  EMAIL_DAILY_LIMIT?: string;
  EMAIL_MONTHLY_LIMIT?: string;
}

function parseLimit(raw: string | undefined, fallback: number): number {
  const n = parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve alert limits: explicit EMAIL_DAILY_LIMIT / EMAIL_MONTHLY_LIMIT
 * win, otherwise per-provider defaults (Resend free vs SMTP/SES-sized).
 */
export function getEmailLimits(provider: EmailProvider, env?: EmailLimitsEnv): EmailLimits {
  const fallback =
    provider === "smtp"
      ? { dailyLimit: SMTP_DEFAULT_DAILY_LIMIT, monthlyLimit: SMTP_DEFAULT_MONTHLY_LIMIT }
      : { dailyLimit: RESEND_DAILY_LIMIT, monthlyLimit: RESEND_MONTHLY_LIMIT };
  return {
    dailyLimit: parseLimit(env?.EMAIL_DAILY_LIMIT, fallback.dailyLimit),
    monthlyLimit: parseLimit(env?.EMAIL_MONTHLY_LIMIT, fallback.monthlyLimit),
  };
}

/** Pct-of-quota thresholds that each fire at most one webhook per period. */
export const QUOTA_ALERT_THRESHOLDS = [80, 90, 100] as const;

export interface EmailSendResult {
  success: boolean;
  provider: EmailProvider;
  /** True when no provider credentials are set and nothing was actually sent. */
  skipped?: boolean;
  /** Set when Resend answered 429 quota-exhausted. */
  quotaExhausted?: "daily" | "monthly" | null;
  /** Provider-reported used quota (Resend free-plan headers), if present. */
  providerDailyUsed?: number | null;
  providerMonthlyUsed?: number | null;
}

export interface EmailUsage {
  daily: number;
  monthly: number;
  dailyPct: number;
  monthlyPct: number;
}

export function utcDayString(now = new Date()): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC — matches Resend's UTC day)
}

export function utcMonthString(now = new Date()): string {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

function pct(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

function dailyKey(day = utcDayString()): string {
  return `email:daily:${day}`;
}

function monthlyKey(month = utcMonthString()): string {
  return `email:monthly:${month}`;
}

async function getCount(d1: D1Database, key: string): Promise<number> {
  try {
    const row = await d1.prepare("SELECT count FROM usage_counters WHERE key = ?1").bind(key).first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function getEmailUsage(
  d1: D1Database,
  now = new Date(),
  limits: EmailLimits = { dailyLimit: RESEND_DAILY_LIMIT, monthlyLimit: RESEND_MONTHLY_LIMIT }
): Promise<EmailUsage> {
  const [daily, monthly] = await Promise.all([
    getCount(d1, dailyKey(utcDayString(now))),
    getCount(d1, monthlyKey(utcMonthString(now))),
  ]);
  return {
    daily,
    monthly,
    dailyPct: pct(daily, limits.dailyLimit),
    monthlyPct: pct(monthly, limits.monthlyLimit),
  };
}

/** Atomic +1 of a counter, returning the new value. */
async function incrementCounter(d1: D1Database, key: string, nowIso: string): Promise<number> {
  const row = await d1
    .prepare(
      `INSERT INTO usage_counters (key, count, updated_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET count = count + 1, updated_at = ?2
       RETURNING count`
    )
    .bind(key, nowIso)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

/**
 * Record one sent email. When the provider's own headers report a higher
 * used number (sends from before this tracking existed, or another sender
 * on the same key), the counter jumps to the server truth so alerts stay
 * accurate.
 */
export async function recordEmailSent(
  d1: D1Database,
  result: EmailSendResult,
  now = new Date(),
  limits: EmailLimits = { dailyLimit: RESEND_DAILY_LIMIT, monthlyLimit: RESEND_MONTHLY_LIMIT }
): Promise<EmailUsage> {
  const nowIso = now.toISOString();
  const day = dailyKey(utcDayString(now));
  const month = monthlyKey(utcMonthString(now));

  let [daily, monthly] = await Promise.all([
    incrementCounter(d1, day, nowIso),
    incrementCounter(d1, month, nowIso),
  ]);

  // Reconcile with Resend server truth (max wins, per counter).
  const bumps: Array<{ key: string; to: number }> = [];
  if (result.providerDailyUsed != null && result.providerDailyUsed > daily) {
    bumps.push({ key: day, to: result.providerDailyUsed });
    daily = result.providerDailyUsed;
  }
  if (result.providerMonthlyUsed != null && result.providerMonthlyUsed > monthly) {
    bumps.push({ key: month, to: result.providerMonthlyUsed });
    monthly = result.providerMonthlyUsed;
  }
  for (const b of bumps) {
    try {
      await d1
        .prepare("UPDATE usage_counters SET count = ?1, updated_at = ?2 WHERE key = ?3")
        .bind(b.to, nowIso, b.key)
        .run();
    } catch {
      // Reconciliation is advisory — the local count is already recorded.
    }
  }

  return {
    daily,
    monthly,
    dailyPct: pct(daily, limits.dailyLimit),
    monthlyPct: pct(monthly, limits.monthlyLimit),
  };
}

async function claimAlert(d1: D1Database, alertKey: string, nowIso: string): Promise<boolean> {
  try {
    const res = await d1
      .prepare(
        `INSERT INTO usage_counters (key, count, updated_at) VALUES (?1, 1, ?2)
         ON CONFLICT(key) DO NOTHING`
      )
      .bind(alertKey, nowIso)
      .run();
    return (res.meta?.changes ?? 0) === 1;
  } catch {
    return false;
  }
}

async function postWebhook(webhookUrl: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` = Slack incoming webhooks, `content` = Discord webhooks.
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`Quota webhook failed: status ${res.status}`);
      return false;
    }
    return true;
  } catch {
    console.error("Quota webhook failed to send.");
    return false;
  }
}

/**
 * Fire at-most-once-per-period webhooks for crossed thresholds.
 * Returns the alert labels sent (e.g. ["daily:90", "monthly:80"]).
 */
export async function checkQuotaAlerts(
  d1: D1Database,
  opts: {
    webhookUrl?: string;
    appName?: string;
    usage: EmailUsage;
    quotaExhausted?: "daily" | "monthly" | null;
    provider?: EmailProvider;
    limits?: EmailLimits;
    now?: Date;
  }
): Promise<string[]> {
  const sent: string[] = [];
  const webhookUrl = (opts.webhookUrl ?? "").trim();
  if (!webhookUrl) return sent;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const app = (opts.appName ?? "ManyMano").trim() || "ManyMano";
  const label = providerLabel(opts.provider ?? "resend");
  const limits = opts.limits ?? {
    dailyLimit: RESEND_DAILY_LIMIT,
    monthlyLimit: RESEND_MONTHLY_LIMIT,
  };

  const checks: Array<{
    scope: "daily" | "monthly";
    used: number;
    limit: number;
    pctValue: number;
    period: string;
  }> = [
    {
      scope: "daily",
      used: opts.usage.daily,
      limit: limits.dailyLimit,
      pctValue: opts.usage.dailyPct,
      period: utcDayString(now),
    },
    {
      scope: "monthly",
      used: opts.usage.monthly,
      limit: limits.monthlyLimit,
      pctValue: opts.usage.monthlyPct,
      period: utcMonthString(now),
    },
  ];

  for (const c of checks) {
    for (const threshold of QUOTA_ALERT_THRESHOLDS) {
      if (c.pctValue < threshold) continue;
      const alertKey = `email:alert:${c.scope}:${threshold}:${c.period}`;
      if (!(await claimAlert(d1, alertKey, nowIso))) continue; // already alerted
      const message =
        `⚠️ ${app} email quota: ${c.used}/${c.limit} ${c.scope} (${c.pctValue}%). ` +
        (threshold >= 100
          ? `Sending will pause until the quota resets — consider upgrading ${label}.`
          : `Heads up — approaching the ${label} limit.`);
      if (await postWebhook(webhookUrl, message)) sent.push(`${c.scope}:${threshold}`);
    }
  }

  if (opts.quotaExhausted) {
    const scope = opts.quotaExhausted;
    const period = scope === "daily" ? utcDayString(now) : utcMonthString(now);
    const alertKey = `email:alert:${scope}:exhausted:${period}`;
    if (await claimAlert(d1, alertKey, nowIso)) {
      const message =
        `🛑 ${app} email quota EXHAUSTED (${scope}). ${label} reported the quota is spent — ` +
        "no confirmation emails are going out. App keeps working (links + .ics downloads unaffected).";
      if (await postWebhook(webhookUrl, message)) sent.push(`${scope}:exhausted`);
    }
  }

  return sent;
}

/**
 * Top-level helper for route actions: record the send and alert if needed.
 * Never throws — call it right after `sendEmail(...)` and forget about it.
 */
export async function trackEmailUsage(
  d1: D1Database,
  opts: {
    webhookUrl?: string;
    appName?: string;
    result: EmailSendResult;
    provider?: EmailProvider;
    limits?: EmailLimits;
    now?: Date;
  }
): Promise<EmailUsage | null> {
  try {
    if (opts.result.skipped) return null;
    const now = opts.now ?? new Date();
    const provider = opts.provider ?? opts.result.provider ?? "resend";
    const limits = opts.limits ?? {
      dailyLimit: RESEND_DAILY_LIMIT,
      monthlyLimit: RESEND_MONTHLY_LIMIT,
    };
    const usage = await recordEmailSent(d1, opts.result, now, limits);
    await checkQuotaAlerts(d1, {
      webhookUrl: opts.webhookUrl,
      appName: opts.appName,
      usage,
      quotaExhausted: opts.result.success ? null : (opts.result.quotaExhausted ?? null),
      provider,
      limits,
      now,
    });
    return usage;
  } catch (err) {
    console.error("Quota tracking failed (non-fatal).");
    return null;
  }
}
