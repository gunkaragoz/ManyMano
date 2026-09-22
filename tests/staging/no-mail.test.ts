// Staging no-mail gate — proves staging CANNOT send outbound email.
//
// Why: staging is a prod copy where we exercise create/update flows with
// synthetic events. Reminder/signup/organizer mails must never reach real
// users. Suppression is by configuration (empty provider creds + empty
// webhook, see plan §7.4), verified here in three layers:
//
//   1. Static: staging env has no RESEND_API_KEY / SMTP_* / ALERT_WEBHOOK_URL.
//   2. Unit: getEmailSenderConfig(staging) resolves to skip-mode, and
//      sendEmail() returns { skipped: true } without network.
//   3. Live (opt-in): the staging host answers /api/usage with zero counters
//      and /api/reminders dry-run reports no sends.
//
// The live section only runs when STAGING_URL is set; otherwise it is skipped
// so default `vitest run` stays hermetic. The harness refuses to run against
// the prod SITE_URL (must contain "stg", "staging", "preview" or "localhost").
import { describe, expect, it } from "vitest";
import { getEmailSenderConfig, sendEmail } from "~/utils/email";
import { resolveSmtpConfig } from "~/utils/email";

const STAGING_URL = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
const LIVE = Boolean(STAGING_URL);

function assertIsStagingHost(url: string) {
  const host = new URL(url).hostname;
  const ok =
    host.includes("stg") ||
    host.includes("staging") ||
    host.includes("preview") ||
    host === "localhost" ||
    host === "127.0.0.1";
  expect(ok, `REFUSING to run staging mail gate against non-staging host ${host}`).toBe(true);
}

describe("staging mail suppression (static)", () => {
  it("has no provider credentials or alert webhook in this environment", () => {
    // These run wherever the test runs (CI included): if anyone injects a
    // real key into the staging job, fail loudly instead of sending mail.
    expect(process.env.RESEND_API_KEY ?? "", "RESEND_API_KEY must be empty in staging").toBe("");
    expect(process.env.SMTP_HOST ?? "", "SMTP_HOST must be empty in staging").toBe("");
    expect(process.env.SMTP_USERNAME ?? "", "SMTP_USERNAME must be empty in staging").toBe("");
    expect(process.env.SMTP_PASSWORD ?? "", "SMTP_PASSWORD must be empty in staging").toBe("");
    expect(process.env.ALERT_WEBHOOK_URL ?? "", "ALERT_WEBHOOK_URL must be empty in staging").toBe("");
  });

  it("sender config resolves to skip-mode", () => {
    const cfg = getEmailSenderConfig({
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_USERNAME: process.env.SMTP_USERNAME,
      SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      SMTP_SECURE: process.env.SMTP_SECURE,
    });
    expect(cfg.provider).toBe("resend");
    expect(cfg.apiKey ?? "").toBe("");
    expect(resolveSmtpConfig({})).toBeNull();
  });

  it("sendEmail() short-circuits without network", async () => {
    const res = await sendEmail({
      ...getEmailSenderConfig({}),
      from: "ManyMano Staging <no-reply@stg.example.com>",
      to: "stg-smoke@example.com",
      subject: "staging gate",
      html: "<p>never sent</p>",
    });
    expect(res.skipped).toBe(true);
    expect(res.success).toBe(true);
  });
});

describe.skipIf(!LIVE)("staging mail suppression (live)", () => {
  it("targets a staging host, never prod", () => {
    assertIsStagingHost(STAGING_URL);
  });

  it("/api/usage reports zero sends", async () => {
    assertIsStagingHost(STAGING_URL);
    const res = await fetch(`${STAGING_URL}/api/usage`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email?: { daily: number; monthly: number } };
    expect(body.email?.daily ?? 0).toBe(0);
    expect(body.email?.monthly ?? 0).toBe(0);
  });

  // Manual endpoint use needs a secret; production sends run on the Cron
  // Trigger instead (no HTTP, no secret). When no secret is configured
  // (the default — staging has none), the endpoint fail-closes with 503.
  it("/api/reminders without secret sends nothing (503 fail-closed, or dry-run with secret)", async () => {
    assertIsStagingHost(STAGING_URL);
    const secret = process.env.REMINDER_SECRET ?? "";
    const res = await fetch(
      `${STAGING_URL}/api/reminders?dry-run=1&date=${tomorrowIso()}`,
      secret ? { headers: { Authorization: `Bearer ${secret}` } } : {}
    );
    if (!secret) {
      expect(res.status).toBe(503);
      return;
    }
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent?: number; events?: unknown[] };
    expect(body.sent ?? 0).toBe(0);
  });
});

function tomorrowIso(): string {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}
