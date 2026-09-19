import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data } from "react-router";
import { getDb } from "~/db";
import { safeEqual } from "~/utils/auth";
import { isValidIsoDate } from "~/utils/validation";
import { getSiteConfig } from "~/utils/site";
import { reminderDateString } from "~/utils/reminders";
import { runReminderFanout } from "~/utils/reminders-run";

// GET /api/reminders — day-before reminder fan-out (manual entry point).
//
// Production sends run on the Workers Cron Trigger (see workers/app.ts
// `scheduled` + [triggers] in wrangler.toml) — no HTTP, no secret needed.
// This endpoint remains for manual runs, backfills (?date=) and dry-runs:
//
//   GET /api/reminders?dry-run=1  (Authorization: Bearer <REMINDER_SECRET>)
//
// Query params:
//   ?secret=...   alternative to the Authorization header (for cron
//                 services that can't set headers — prefer the header).
//   ?date=YYYY-MM-DD  override "tomorrow" (testing/backfill).
//   ?dry-run=1    report what would be sent without sending or recording.
//
// Auth: REMINDER_SECRET is required. When unset the endpoint answers 503
// (fail-closed — an open reminder endpoint would let anyone burn the
// email quota). Comparison is timing-safe.
//
// Dedupe: one reminder_sends row per (event, date, kind); re-runs skip
// already-sent kinds, so retries never double-email. Partial failures are
// left unmarked so the next run retries them.

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers();
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return headers;
};

function isAuthorized(request: Request, secret: string): boolean {
  const url = new URL(request.url);
  const querySecret = (url.searchParams.get("secret") ?? "").trim();
  const header = (request.headers.get("authorization") ?? "").trim();
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  // safeEqual is timing-safe for equal-length inputs and false otherwise.
  if (querySecret && safeEqual(querySecret, secret)) return true;
  if (bearer && safeEqual(bearer, secret)) return true;
  return false;
}

interface ReminderEnv {
  DB: D1Database;
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_SECURE?: string;
  EMAIL_DAILY_LIMIT?: string;
  EMAIL_MONTHLY_LIMIT?: string;
  ALERT_WEBHOOK_URL?: string;
  REMINDER_SECRET?: string;
  FROM_EMAIL: string;
  SITE_URL: string;
  SITE_NAME: string;
  SITE_TAGLINE: string;
  SITE_DESCRIPTION: string;
  GITHUB_REPO_URL?: string;
  FOOTER_CREDIT_URL?: string;
  FOOTER_CREDIT_LABEL?: string;
  SECURITY_CONTACT?: string;
  ICS_UID_DOMAIN?: string;
  ICS_PRODID?: string;
}

async function handleReminders(request: Request, env: ReminderEnv) {
  const site = getSiteConfig(env);
  const db = getDb(env.DB);

  const secret = (env.REMINDER_SECRET ?? "").trim();
  if (!secret) {
    return data(
      { error: "Reminder endpoint is not configured (set REMINDER_SECRET). See .env.sample." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (!isAuthorized(request, secret)) {
    return data({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry-run") === "1";
  const dateRaw = (url.searchParams.get("date") ?? "").trim();
  let date = reminderDateString();
  if (dateRaw) {
    if (!isValidIsoDate(dateRaw)) {
      return data(
        { error: "Invalid ?date= — use YYYY-MM-DD." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    date = dateRaw;
  }

  let result;
  try {
    result = await runReminderFanout(db, env.DB, site, env, { date, dryRun });
  } catch {
    return data(
      { error: "Could not load reminder targets." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  return data(
    { ok: true, ...result },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getCloudflareEnv(context) as unknown as ReminderEnv;
  return handleReminders(request, env);
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getCloudflareEnv(context) as unknown as ReminderEnv;
  return handleReminders(request, env);
}
