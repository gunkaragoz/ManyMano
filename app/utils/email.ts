import { escapeHtml } from "./sanitize";

/** Outbound mail provider. `resend` (default) or any SMTP server (incl. Amazon SES via its SMTP endpoint). */
export type EmailProvider = "resend" | "smtp";

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Implicit TLS (port 465). When false the client uses STARTTLS (port 587). */
  secure: boolean;
}

/** Env keys read by the email sender (all optional — see .env.sample). */
export interface EmailSenderEnv {
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_SECURE?: string;
}

export interface SendEmailParams {
  /** Defaults to `resend`. Use getEmailSenderConfig(env) to resolve from env. */
  provider?: EmailProvider;
  /** Resend API key. When empty on the resend provider the send is skipped. */
  apiKey?: string;
  /** SMTP connection. When null on the smtp provider the send is skipped. */
  smtp?: SmtpConfig | null;
  /** Required — caller must pass the configured FROM_EMAIL. No fallback. */
  from: string;
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback. Derived from `html` when omitted. */
  text?: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  provider: EmailProvider;
  /** True when no provider credentials are set and nothing was actually sent. */
  skipped?: boolean;
  /** Set when Resend answered 429 quota-exhausted (see app/utils/quota.ts). */
  quotaExhausted?: "daily" | "monthly" | null;
  /** Provider-reported used quota (Resend free-plan headers), if present. */
  providerDailyUsed?: number | null;
  providerMonthlyUsed?: number | null;
}

/** Human label for logs, alerts and /api/usage. */
export function providerLabel(provider: EmailProvider): string {
  return provider === "smtp" ? "SMTP" : "Resend";
}

/**
 * Resolve the active provider from EMAIL_PROVIDER. Unset/empty defaults to
 * `resend`. Unknown values throw (fail-fast, like getSiteConfig) so a typo
 * can never silently send through the wrong provider.
 */
export function resolveEmailProvider(env: EmailSenderEnv): EmailProvider {
  const raw = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (!raw || raw === "resend") return "resend";
  if (raw === "smtp") return "smtp";
  throw new Error(
    `[config] Unknown EMAIL_PROVIDER ${JSON.stringify(env.EMAIL_PROVIDER)}. ` +
      `Use "resend" (default) or "smtp". See .env.sample.`
  );
}

/**
 * Resolve SMTP connection config. Returns null when incomplete (host,
 * username and password are all required) — the send is then skipped, same
 * as a missing RESEND_API_KEY. Port defaults to 587 (STARTTLS); implicit
 * TLS is used for port 465 unless SMTP_SECURE overrides it explicitly.
 */
export function resolveSmtpConfig(env: EmailSenderEnv): SmtpConfig | null {
  const host = (env.SMTP_HOST ?? "").trim();
  const username = (env.SMTP_USERNAME ?? "").trim();
  const password = (env.SMTP_PASSWORD ?? "").trim();
  if (!host || !username || !password) return null;
  const portRaw = (env.SMTP_PORT ?? "").trim();
  const port = portRaw ? parseInt(portRaw, 10) : 587;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`[config] Invalid SMTP_PORT ${JSON.stringify(env.SMTP_PORT)}. Use 587 (STARTTLS) or 465 (implicit TLS).`);
  }
  const secureRaw = (env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secure = secureRaw ? secureRaw === "true" || secureRaw === "1" || secureRaw === "yes" : port === 465;
  return { host, port, username, password, secure };
}

/** One-liner for route actions: spread the result into sendEmail(...). */
export function getEmailSenderConfig(env: EmailSenderEnv): {
  provider: EmailProvider;
  apiKey?: string;
  smtp?: SmtpConfig | null;
} {
  return {
    provider: resolveEmailProvider(env),
    apiKey: env.RESEND_API_KEY,
    smtp: resolveSmtpConfig(env),
  };
}

/** Split `"Display Name <addr@example.com>"` into name + bare address. */
function parseMailbox(from: string): { name?: string; email: string } {
  const angled = from.match(/^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (angled) {
    const name = (angled[1] || "").trim().replace(/^["']|["']$/g, "").trim();
    return name ? { name, email: angled[2] } : { email: angled[2] };
  }
  return { email: from.trim() };
}

/** Minimal HTML → plain-text fallback for SMTP `text` part. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseQuotaHeader(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function sendViaResend({
  apiKey,
  from,
  to,
  subject,
  html,
}: {
  apiKey?: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  if (!apiKey) {
    // Intentionally omit recipient/subject: server logs are not the place for PII.
    console.log(`[Email disabled] Skipped outbound email (no RESEND_API_KEY).`);
    return { success: true, skipped: true, provider: "resend" };
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
    const providerDailyUsed = parseQuotaHeader(res.headers.get("x-resend-daily-quota"));
    const providerMonthlyUsed = parseQuotaHeader(res.headers.get("x-resend-monthly-quota"));

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
        provider: "resend",
        quotaExhausted,
        providerDailyUsed,
        providerMonthlyUsed,
      };
    }

    return { success: true, quotaExhausted: null, provider: "resend", providerDailyUsed, providerMonthlyUsed };
  } catch (err: any) {
    console.error("Failed to send email.");
    return { success: false, error: "Email send failed", provider: "resend" };
  }
}

async function sendViaSmtp({
  smtp,
  from,
  to,
  subject,
  html,
  text,
}: {
  smtp?: SmtpConfig | null;
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendEmailResult> {
  if (!smtp) {
    // Same skip semantics as a missing RESEND_API_KEY: warn (explicit
    // provider, incomplete config) but keep the app working via links + .ics.
    console.warn(
      `[Email disabled] EMAIL_PROVIDER=smtp but SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD are incomplete — skipped outbound email.`
    );
    return { success: true, skipped: true, provider: "smtp" };
  }

  try {
    // Lazy import: `worker-mailer` needs the Workers TCP sockets API
    // (`cloudflare:sockets`), unavailable under plain `vite dev` (Node
    // runtime). The import itself succeeds there; connect() throws, which
    // is caught below — SMTP sending requires `wrangler pages dev` or a
    // deployed Pages build. Never throws to the caller.
    const { WorkerMailer } = await import("worker-mailer");
    await WorkerMailer.send(
      {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        // Defaults: STARTTLS upgrade when offered (port 587), as SES and
        // most providers expect. Port 465 uses implicit TLS via `secure`.
        startTls: !smtp.secure,
        credentials: { username: smtp.username, password: smtp.password },
        authType: ["plain", "login"],
      },
      {
        from: parseMailbox(from),
        to: to.trim(),
        subject,
        text: (text ?? "").trim() || htmlToText(html),
        html,
      }
    );
    return { success: true, quotaExhausted: null, provider: "smtp" };
  } catch (err: any) {
    // Status-only log: no recipient PII, no credential material.
    console.error(`SMTP send failed (${smtp.host}:${smtp.port}).`);
    return { success: false, error: "Email send failed", provider: "smtp" };
  }
}

export async function sendEmail({
  provider = "resend",
  apiKey,
  smtp,
  from,
  to,
  subject,
  html,
  text,
}: SendEmailParams): Promise<SendEmailResult> {
  if (provider === "smtp") {
    return sendViaSmtp({ smtp, from, to, subject, html, text });
  }
  return sendViaResend({ apiKey, from, to, subject, html });
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
