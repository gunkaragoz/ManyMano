import { describe, expect, it } from "vitest";
import { parseTimeString } from "~/utils/calendar";
import { getEmailLimits, QUOTA_ALERT_THRESHOLDS } from "~/utils/quota";
import {
  getEmailSenderConfig,
  resolveEmailProvider,
  resolveSmtpConfig,
} from "~/utils/email";

describe("calendar time parsing", () => {
  it("parses 24h, 12h and ISO times", () => {
    expect(parseTimeString("08:00")).toEqual({ hours: 8, minutes: 0 });
    expect(parseTimeString("9:00 AM")).toEqual({ hours: 9, minutes: 0 });
    expect(parseTimeString("2026-10-17T14:00:00Z")).toEqual({ hours: 14, minutes: 0 });
    expect(parseTimeString("2026-10-17")).toBeNull();
    expect(parseTimeString("25:00")).toBeNull();
    expect(parseTimeString("")).toBeNull();
  });
});

describe("email sender config (staging no-mail contract)", () => {
  it("defaults to resend and fail-fasts on unknown provider", () => {
    expect(resolveEmailProvider({})).toBe("resend");
    expect(() => resolveEmailProvider({ EMAIL_PROVIDER: "pigeon" })).toThrow();
  });

  it("skips when credentials are absent (this is how staging stays silent)", () => {
    const cfg = getEmailSenderConfig({});
    expect(cfg.provider).toBe("resend");
    expect(cfg.apiKey ?? "").toBe("");
    expect(resolveSmtpConfig({})).toBeNull();
    // Incomplete SMTP also resolves to null (skip, not throw).
    expect(resolveSmtpConfig({ SMTP_HOST: "h", SMTP_USERNAME: "u" })).toBeNull();
  });

  it("resolves SMTP ports", () => {
    const cfg = resolveSmtpConfig({ SMTP_HOST: "h", SMTP_USERNAME: "u", SMTP_PASSWORD: "p" });
    expect(cfg?.port).toBe(587);
    expect(cfg?.secure).toBe(false);
  });

  it("uses provider-aware quota defaults", () => {
    expect(getEmailLimits("resend", {}).dailyLimit).toBe(100);
    expect(getEmailLimits("smtp", {}).dailyLimit).toBe(50000);
    expect([...QUOTA_ALERT_THRESHOLDS]).toEqual([80, 90, 100]);
  });
});
