import { describe, expect, it } from "vitest";
import { getSiteConfig, toPublicSiteConfig } from "~/utils/site";

const COMPLETE = {
  SITE_URL: "https://stg.example.com/",
  SITE_NAME: "ManyMano",
  SITE_TAGLINE: "Free sign-up sheets and meeting polls.",
  SITE_DESCRIPTION: "Free sign-up sheets and meeting polls.",
  FROM_EMAIL: "ManyMano <no-reply@mail.example.com>",
  GITHUB_REPO_URL: "https://github.com/example/manymano",
};

describe("getSiteConfig", () => {
  it("resolves a complete env (strips trailing slash)", () => {
    const c = getSiteConfig(COMPLETE);
    expect(c.siteUrl).toBe("https://stg.example.com");
    expect(c.siteName).toBe("ManyMano");
    expect(c.fromEmail).toBe(COMPLETE.FROM_EMAIL);
  });

  it.each(["SITE_URL", "SITE_NAME", "SITE_TAGLINE", "SITE_DESCRIPTION", "FROM_EMAIL"] as const)(
    "fail-fasts without %s",
    (key) => {
      const broken = { ...COMPLETE };
      delete (broken as Record<string, string>)[key];
      expect(() => getSiteConfig(broken)).toThrow(`[config] Missing required environment variable ${key}`);
    }
  );

  it("rejects non-absolute SITE_URL", () => {
    expect(() => getSiteConfig({ ...COMPLETE, SITE_URL: "not-a-url" })).toThrow(
      "SITE_URL must be an absolute http(s) URL"
    );
  });

  it("derives SECURITY_CONTACT / ICS defaults when optionals absent (prod 500 regression)", () => {
    const minimal: Record<string, string> = { ...COMPLETE };
    delete minimal.SECURITY_CONTACT;
    delete minimal.ICS_UID_DOMAIN;
    delete minimal.ICS_PRODID;
    const c = getSiteConfig(minimal);
    expect(c.securityContact).toBe("https://github.com/example/manymano/issues");
    expect(c.icsUidDomain).toBe("stg.example.com");
    expect(c.icsProdid).toBe("PRODID:-//ManyMano//Open Source Scheduling//EN");
  });

  it("falls back to mailto:FROM_EMAIL when no repo URL", () => {
    const rest: Record<string, string> = { ...COMPLETE };
    delete rest.GITHUB_REPO_URL;
    const c = getSiteConfig(rest);
    expect(c.securityContact).toBe("mailto:no-reply@mail.example.com");
  });

  it("exposes only the public subset to the browser", () => {
    const pub = toPublicSiteConfig(getSiteConfig(COMPLETE));
    expect(pub).toEqual({
      siteUrl: "https://stg.example.com",
      siteName: "ManyMano",
      siteTagline: COMPLETE.SITE_TAGLINE,
      siteDescription: COMPLETE.SITE_DESCRIPTION,
      githubRepoUrl: "https://github.com/example/manymano",
      footerCreditUrl: undefined,
      footerCreditLabel: undefined,
    });
    expect("fromEmail" in pub).toBe(false);
  });
});
