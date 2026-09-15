import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { getSiteConfig } from "~/utils/site";
import {
  QUOTA_ALERT_THRESHOLDS,
  RESEND_DAILY_LIMIT,
  RESEND_MONTHLY_LIMIT,
  getEmailUsage,
} from "~/utils/quota";

// GET /api/usage — free-tier quota status (aggregate counts only, no PII).
//
// - `email`: live Resend send counters tracked in D1 (UTC day/month). This is
//   the limit you'll actually hit first (100/day, 3,000/month free).
// - `cloudflare`: live Workers/D1 consumption is NOT queryable from inside
//   the app without a Cloudflare API token, so this echoes the static free
//   limits + where to watch them. Cloudflare itself emails the account owner
//   at ~90% of daily usage and when D1 limits are hit.
// - `alerts`: whether ALERT_WEBHOOK_URL is set (Discord/Slack webhook fired
//   at 80/90/100% and on exhaustion — see app/utils/quota.ts).
//
// Poll this from an uptime monitor / GitHub Actions cron if you want a
// second pair of eyes outside the in-app webhook.

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers();
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return headers;
};

export async function loader({ context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as {
    DB: D1Database;
    ALERT_WEBHOOK_URL?: string;
    SITE_URL: string;
    SITE_NAME: string;
    SITE_TAGLINE: string;
    SITE_DESCRIPTION: string;
    FROM_EMAIL: string;
  };
  const site = getSiteConfig(env);

  let email = null;
  try {
    email = await getEmailUsage(env.DB);
  } catch {
    // Fresh DB before migration 0004 runs: report zeros, not a 500.
    email = { daily: 0, monthly: 0, dailyPct: 0, monthlyPct: 0 };
  }

  return json(
    {
      email: {
        ...email,
        dailyLimit: RESEND_DAILY_LIMIT,
        monthlyLimit: RESEND_MONTHLY_LIMIT,
      },
      alerts: {
        webhookConfigured: Boolean((env.ALERT_WEBHOOK_URL ?? "").trim()),
        thresholdsPct: [...QUOTA_ALERT_THRESHOLDS],
        note: "Webhook fires at most once per threshold per period (80/90/100% + exhausted).",
      },
      cloudflare: {
        note: "Live usage lives in the Cloudflare dashboard; this app can't read it without an API token. Cloudflare emails the account owner automatically at ~90% of daily limits.",
        workersFree: { requestsPerDay: 100000, cpuMsPerRequest: 10 },
        d1Free: { rowsReadPerDay: 5000000, rowsWrittenPerDay: 100000, storageGb: 5 },
        dashboard: "https://dash.cloudflare.com/ → Workers & Pages → Metrics; D1 → Overview",
      },
      site: site.siteName,
    },
    {
      headers: { "Cache-Control": "public, max-age=30" },
    }
  );
}
