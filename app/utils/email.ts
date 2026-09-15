import { escapeHtml } from "./sanitize";

export interface SendEmailParams {
  apiKey?: string;
  /** Required — caller must pass the configured FROM_EMAIL. No fallback. */
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  /** True when no RESEND_API_KEY is set and nothing was actually sent. */
  skipped?: boolean;
  /** Set when Resend answered 429 quota-exhausted (see app/utils/quota.ts). */
  quotaExhausted?: "daily" | "monthly" | null;
  /** Resend-reported used quota from response headers (free plan), if present. */
  resendDailyUsed?: number | null;
  resendMonthlyUsed?: number | null;
}

function parseQuotaHeader(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function sendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
}: SendEmailParams): Promise<SendEmailResult> {
  if (!apiKey) {
    // Intentionally omit recipient/subject: server logs are not the place for PII.
    console.log(`[Email disabled] Skipped outbound email (no RESEND_API_KEY).`);
    return { success: true, skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    // Free-plan quota telemetry for app/utils/quota.ts alerts. Header names
    // per Resend docs; absent on some plans — hence all-nullable.
    const resendDailyUsed = parseQuotaHeader(res.headers.get("x-resend-daily-quota"));
    const resendMonthlyUsed = parseQuotaHeader(res.headers.get("x-resend-monthly-quota"));

    if (!res.ok) {
      // Do not log recipient PII or full provider body; keep a status-only line.
      console.error(`Resend API error: status ${res.status}`);
      let quotaExhausted: "daily" | "monthly" | null = null;
      if (res.status === 429) {
        try {
          const body = (await res.clone().json()) as { name?: string };
          const name = (body?.name ?? "").toLowerCase();
          if (name.includes("daily")) quotaExhausted = "daily";
          else if (name.includes("monthly")) quotaExhausted = "monthly";
        } catch {
          // Error shape unknown — still report the failure, just without scope.
        }
      }
      return {
        success: false,
        error: `Email provider error (${res.status})`,
        quotaExhausted,
        resendDailyUsed,
        resendMonthlyUsed,
      };
    }

    return { success: true, quotaExhausted: null, resendDailyUsed, resendMonthlyUsed };
  } catch (err: any) {
    console.error("Failed to send email.");
    return { success: false, error: "Email send failed" };
  }
}

/**
 * Shared branded footer for all outbound emails. Config-driven (no hardcoded
 * brand): first sentence of the tagline + bare domain of the site URL, e.g.
 * "ManyMano · Free sign-up sheets and meeting polls" / "manymano.com".
 */
export function emailFooter(site: { siteName: string; siteTagline: string; siteUrl: string }): string {
  const shortTagline = (site.siteTagline.split(".")[0] || site.siteTagline).trim();
  let host = site.siteUrl;
  try {
    host = new URL(site.siteUrl).hostname;
  } catch {
    // Keep the raw URL as display text when it can't be parsed.
  }
  return `
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
      <p style="margin: 0 0 4px 0;">${escapeHtml(site.siteName)} · ${escapeHtml(shortTagline)}</p>
      <p style="margin: 0;"><a href="${escapeHtml(site.siteUrl)}" style="color: #2563eb;">${escapeHtml(host)}</a></p>
    </div>
  `;
}
