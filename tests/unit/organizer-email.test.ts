import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_ALREADY_SAVED,
  EMAIL_SAVED_AND_SENT,
  EMAIL_SAVED_NOT_SENT,
  ORGANIZER_EMAIL_CHANGES_PER_HOUR,
  buildOrganizerLinkEmail,
  organizerEmailLimitKey,
  organizerLinks,
  parseOrganizerEmailInput,
  sameEmail,
  saveOrganizerEmail,
  type SaveOrganizerEmailDeps,
} from "~/utils/organizer-email";
import { isSameOriginRequest } from "~/utils/auth";
import { isEmailDeliveryConfigured, type SendEmailResult } from "~/utils/email";
import { reserveCounterBelowLimit } from "~/utils/quota";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const SITE = { siteName: "ManyMano", siteTagline: "tag", siteUrl: "https://example.com" };
const SENT: SendEmailResult = { success: true, provider: "resend" };

function deps(over: Partial<SaveOrganizerEmailDeps> = {}) {
  const d = {
    isSameOrigin: vi.fn(() => true),
    requireAdmin: vi.fn(async () => true),
    assessBot: vi.fn(() => ({ verdict: "allow" as const })),
    mailConfigured: true,
    turnstileConfigured: true,
    ipRateLimitOk: vi.fn(() => true),
    reserveEventChange: vi.fn(async () => true),
    verifyTurnstile: vi.fn(async () => true),
    saveEmail: vi.fn(async (_email: string) => {}),
    budgetAvailable: vi.fn(async () => true),
    sendLinkEmail: vi.fn(async (_email: string) => SENT),
    trackUsage: vi.fn(async (_r: SendEmailResult) => {}),
    ...over,
  };
  return d;
}

const input = (raw: unknown, currentEmail = "") => ({ raw, currentEmail });

describe("parseOrganizerEmailInput", () => {
  it("trims and accepts a valid address", () => {
    expect(parseOrganizerEmailInput("  sam@example.com ")).toEqual({ ok: true, email: "sam@example.com" });
  });

  it("rejects missing, empty and non-string input", () => {
    for (const raw of [null, undefined, "", "   ", 42, {}]) {
      expect(parseOrganizerEmailInput(raw).ok).toBe(false);
    }
  });

  it("rejects an overlong address instead of truncating it", () => {
    const long = `${"a".repeat(64)}@${"b".repeat(186)}.com`; // 255 chars
    const r = parseOrganizerEmailInput(long);
    expect(r).toEqual({ ok: false, error: "That email address is too long." });
  });

  it("rejects malformed addresses", () => {
    for (const raw of ["sam", "sam@", "@example.com", "sam @example.com", "sam@example"]) {
      expect(parseOrganizerEmailInput(raw).ok).toBe(false);
    }
  });
});

describe("helpers", () => {
  it("sameEmail ignores case and surrounding space, and '' never matches an address", () => {
    expect(sameEmail("Sam@Example.com ", "sam@example.com")).toBe(true);
    expect(sameEmail("", "sam@example.com")).toBe(false);
    expect(sameEmail(null, "")).toBe(true);
  });

  it("organizerLinks encodes the token and keeps the QR on the public URL", () => {
    const l = organizerLinks("https://example.com", "abc", "t/k+n");
    expect(l.publicUrl).toBe("https://example.com/events/abc");
    expect(l.adminUrl).toBe("https://example.com/events/abc?admin=t%2Fk%2Bn");
    expect(l.qrUrl).toBe("https://example.com/events/abc/qr?format=png");
  });

  it("limit key buckets by UTC hour", () => {
    expect(organizerEmailLimitKey("abc", new Date("2026-09-27T14:59:59Z"))).toBe("setemail:abc:2026-09-27T14");
  });
});

describe("buildOrganizerLinkEmail", () => {
  const base = {
    site: SITE,
    publicUrl: "https://example.com/events/abc",
    adminUrl: "https://example.com/events/abc?admin=tok",
    qrUrl: "https://example.com/events/abc/qr?format=png",
  };

  it("escapes user content and includes both links", () => {
    const m = buildOrganizerLinkEmail({
      ...base,
      title: `<script>alert(1)</script>`,
      organizerName: `"Sam" <b>`,
      isPoll: false,
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&quot;Sam&quot; &lt;b&gt;");
    expect(m.html).toContain(base.adminUrl);
    expect(m.html).toContain(base.publicUrl);
    expect(m.html).toContain("sign-up sheet");
  });

  it("uses poll wording for polls", () => {
    const m = buildOrganizerLinkEmail({ ...base, title: "Standup", organizerName: null, isPoll: true });
    expect(m.html).toContain("this poll");
    expect(m.html).toContain("voters");
    expect(m.subject).toBe('Your organizer link: "Standup"');
  });
});

describe("isSameOriginRequest", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://example.com/events/abc", { method: "POST", headers });

  it("accepts a matching Origin and rejects another site", () => {
    expect(isSameOriginRequest(req({ origin: "https://example.com" }))).toBe(true);
    expect(isSameOriginRequest(req({ origin: "https://evil.test" }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: "null" }))).toBe(false);
  });

  it("falls back to Sec-Fetch-Site, and allows non-browser requests", () => {
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(req({}))).toBe(true);
  });
});

describe("isEmailDeliveryConfigured", () => {
  it("needs credentials for the active provider", () => {
    expect(isEmailDeliveryConfigured({})).toBe(false);
    expect(isEmailDeliveryConfigured({ RESEND_API_KEY: "  " })).toBe(false);
    expect(isEmailDeliveryConfigured({ RESEND_API_KEY: "re_x" })).toBe(true);
    expect(isEmailDeliveryConfigured({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "h" })).toBe(false);
    expect(
      isEmailDeliveryConfigured({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "h", SMTP_USERNAME: "u", SMTP_PASSWORD: "p" })
    ).toBe(true);
  });
});

describe("saveOrganizerEmail", () => {
  it("saves, sends once and tracks usage", async () => {
    const d = deps();
    const r = await saveOrganizerEmail(d, input("sam@example.com"));
    expect(r).toEqual({ status: 200, body: { success: true, message: EMAIL_SAVED_AND_SENT } });
    expect(d.saveEmail).toHaveBeenCalledWith("sam@example.com");
    expect(d.sendLinkEmail).toHaveBeenCalledTimes(1);
    expect(d.trackUsage).toHaveBeenCalledWith(SENT);
  });

  it("rejects cross-origin before checking the admin token", async () => {
    const d = deps({ isSameOrigin: vi.fn(() => false) });
    const r = await saveOrganizerEmail(d, input("sam@example.com"));
    expect(r.status).toBe(403);
    expect(d.requireAdmin).not.toHaveBeenCalled();
    expect(d.saveEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong admin token", async () => {
    const d = deps({ requireAdmin: vi.fn(async () => false) });
    const r = await saveOrganizerEmail(d, input("sam@example.com"));
    expect(r).toEqual({ status: 403, body: { error: "Unauthorized." } });
    expect(d.saveEmail).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const d = deps();
    expect((await saveOrganizerEmail(d, input("nope"))).status).toBe(400);
    expect(d.saveEmail).not.toHaveBeenCalled();
  });

  it("does nothing for the same address", async () => {
    const d = deps();
    const r = await saveOrganizerEmail(d, input(" SAM@example.com", "sam@example.com"));
    expect(r.body).toEqual({ success: true, message: EMAIL_ALREADY_SAVED });
    expect(d.reserveEventChange).not.toHaveBeenCalled();
    expect(d.saveEmail).not.toHaveBeenCalled();
    expect(d.sendLinkEmail).not.toHaveBeenCalled();
  });

  it("drops honeypot hits", async () => {
    const d = deps({ assessBot: vi.fn(() => ({ verdict: "bot" as const })) });
    expect((await saveOrganizerEmail(d, input("sam@example.com"))).status).toBe(400);
    expect(d.saveEmail).not.toHaveBeenCalled();
  });

  it("refuses when mail is on but Turnstile is not configured", async () => {
    const d = deps({ turnstileConfigured: false });
    expect((await saveOrganizerEmail(d, input("sam@example.com"))).status).toBe(503);
    expect(d.saveEmail).not.toHaveBeenCalled();
    expect(d.sendLinkEmail).not.toHaveBeenCalled();
  });

  it("requires Turnstile for a changed address when mail is on, even for admins", async () => {
    const d = deps({ verifyTurnstile: vi.fn(async () => false) });
    const r = await saveOrganizerEmail(d, input("sam@example.com"));
    expect(r.status).toBe(403);
    expect(d.saveEmail).not.toHaveBeenCalled();
    expect(d.sendLinkEmail).not.toHaveBeenCalled();
  });

  it("rate-limits before calling Turnstile", async () => {
    const ip = deps({ ipRateLimitOk: vi.fn(() => false) });
    expect((await saveOrganizerEmail(ip, input("sam@example.com"))).status).toBe(429);
    expect(ip.verifyTurnstile).not.toHaveBeenCalled();

    const ev = deps({ reserveEventChange: vi.fn(async () => false) });
    expect((await saveOrganizerEmail(ev, input("sam@example.com"))).status).toBe(429);
    expect(ev.verifyTurnstile).not.toHaveBeenCalled();
    expect(ev.saveEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the durable limit can't be read", async () => {
    const d = deps({
      reserveEventChange: vi.fn(async () => {
        throw new Error("D1 down");
      }),
    });
    expect((await saveOrganizerEmail(d, input("sam@example.com"))).status).toBe(503);
    expect(d.saveEmail).not.toHaveBeenCalled();
  });

  it("with mail off: saves without Turnstile or sending", async () => {
    const d = deps({ mailConfigured: false, turnstileConfigured: false });
    const r = await saveOrganizerEmail(d, input("sam@example.com"));
    expect(r.body).toEqual({ success: true, message: EMAIL_SAVED_NOT_SENT });
    expect(d.verifyTurnstile).not.toHaveBeenCalled();
    expect(d.saveEmail).toHaveBeenCalled();
    expect(d.sendLinkEmail).not.toHaveBeenCalled();
  });

  it("with mail off: a bot-like submit still has to pass Turnstile", async () => {
    const d = deps({
      mailConfigured: false,
      assessBot: vi.fn(() => ({ verdict: "challenge" as const, reason: "too-fast" as const })),
      verifyTurnstile: vi.fn(async () => false),
    });
    expect((await saveOrganizerEmail(d, input("sam@example.com"))).status).toBe(403);
    expect(d.saveEmail).not.toHaveBeenCalled();
  });

  it("reports a failed save and sends nothing", async () => {
    const d = deps({
      saveEmail: vi.fn(async () => {
        throw new Error("write failed");
      }),
    });
    expect((await saveOrganizerEmail(d, input("sam@example.com"))).status).toBe(500);
    expect(d.sendLinkEmail).not.toHaveBeenCalled();
  });

  it("keeps the save but skips the send when the email budget is spent", async () => {
    const d = deps({ budgetAvailable: vi.fn(async () => false) });
    const r = await saveOrganizerEmail(d, input("sam@example.com"));
    expect(r.body).toEqual({ success: true, message: EMAIL_SAVED_NOT_SENT });
    expect(d.saveEmail).toHaveBeenCalled();
    expect(d.sendLinkEmail).not.toHaveBeenCalled();
  });

  it("never claims delivery when the provider fails, skips or throws", async () => {
    const failed = deps({ sendLinkEmail: vi.fn(async () => ({ success: false, provider: "resend" as const })) });
    expect((await saveOrganizerEmail(failed, input("sam@example.com"))).body).toEqual({
      success: true,
      message: EMAIL_SAVED_NOT_SENT,
    });
    expect(failed.trackUsage).toHaveBeenCalledTimes(1);

    const skipped = deps({
      sendLinkEmail: vi.fn(async () => ({ success: true, skipped: true, provider: "resend" as const })),
    });
    expect((await saveOrganizerEmail(skipped, input("sam@example.com"))).body).toEqual({
      success: true,
      message: EMAIL_SAVED_NOT_SENT,
    });
    expect(skipped.trackUsage).not.toHaveBeenCalled();

    const threw = deps({
      sendLinkEmail: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect((await saveOrganizerEmail(threw, input("sam@example.com"))).body).toEqual({
      success: true,
      message: EMAIL_SAVED_NOT_SENT,
    });
  });

  it("admits at most the per-event hourly limit across concurrent requests", async () => {
    const db = createSqliteD1();
    const nowIso = "2026-09-27T14:00:00.000Z";
    const key = organizerEmailLimitKey("abc", new Date(nowIso));
    const saves: string[] = [];
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        saveOrganizerEmail(
          deps({
            reserveEventChange: () => reserveCounterBelowLimit(db.d1, key, ORGANIZER_EMAIL_CHANGES_PER_HOUR, nowIso),
            saveEmail: async (email) => {
              saves.push(email);
            },
          }),
          input(`sam${i}@example.com`)
        )
      )
    );
    expect(saves).toHaveLength(ORGANIZER_EMAIL_CHANGES_PER_HOUR);
    expect(results.filter((r) => r.status === 429)).toHaveLength(20 - ORGANIZER_EMAIL_CHANGES_PER_HOUR);
  });
});
