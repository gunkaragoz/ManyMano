// Central site/brand configuration — single source of truth.
//
// Required values come from the runtime environment
// (Cloudflare Pages dashboard in production, `.dev.vars` locally).
// There are intentionally NO hardcoded fallbacks for required vars: a missing
// variable throws at request time so a rebrand / fork can never silently serve
// the old ManyMano defaults (e.g. mail.manymano.com).
//
// Required vars (see `.env.sample`):
//   SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION,
//   FROM_EMAIL, SECURITY_CONTACT, ICS_UID_DOMAIN, ICS_PRODID
//
// Optional vars (empty/unset hides the corresponding footer link / metadata):
//   GITHUB_REPO_URL, FOOTER_CREDIT_URL, FOOTER_CREDIT_LABEL

export interface SiteEnv {
  SITE_URL?: string;
  SITE_NAME?: string;
  SITE_TAGLINE?: string;
  SITE_DESCRIPTION?: string;
  FROM_EMAIL?: string;
  GITHUB_REPO_URL?: string;
  FOOTER_CREDIT_URL?: string;
  FOOTER_CREDIT_LABEL?: string;
  SECURITY_CONTACT?: string;
  ICS_UID_DOMAIN?: string;
  ICS_PRODID?: string;
}

export interface SiteConfig {
  siteUrl: string;
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  fromEmail: string;
  githubRepoUrl?: string;
  footerCreditUrl?: string;
  footerCreditLabel?: string;
  securityContact: string;
  icsUidDomain: string;
  icsProdid: string;
}

/** Public subset safe to expose to the browser via the root loader. */
export interface PublicSiteConfig {
  siteUrl: string;
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  githubRepoUrl?: string;
  footerCreditUrl?: string;
  footerCreditLabel?: string;
}

export function toPublicSiteConfig(c: SiteConfig): PublicSiteConfig {
  return {
    siteUrl: c.siteUrl,
    siteName: c.siteName,
    siteTagline: c.siteTagline,
    siteDescription: c.siteDescription,
    githubRepoUrl: c.githubRepoUrl,
    footerCreditUrl: c.footerCreditUrl,
    footerCreditLabel: c.footerCreditLabel,
  };
}

function required(env: SiteEnv, key: keyof SiteEnv): string {
  const raw = (env[key] ?? "").trim();
  if (!raw) {
    throw new Error(
      `[config] Missing required environment variable ${key}. ` +
        `Set it in Cloudflare Pages dashboard (production) or .dev.vars (local). See .env.sample.`
    );
  }
  return raw;
}

/**
 * Read an optional env var. Empty/unset (or whitespace-only) resolves to
 * `undefined` so callers can hide the corresponding UI / metadata.
 */
function optional(env: SiteEnv, key: keyof SiteEnv): string | undefined {
  const raw = (env[key] ?? "").trim();
  return raw ? raw : undefined;
}

/**
 * Resolve + validate full site config. Required fields throw when absent
 * (fail-fast, no fallback); GITHUB_REPO_URL / FOOTER_CREDIT_URL /
 * FOOTER_CREDIT_LABEL are optional and resolve to `undefined` when unset.
 */
export function getSiteConfig(env: SiteEnv): SiteConfig {
  const siteUrl = required(env, "SITE_URL").replace(/\/$/, "");
  if (!/^https?:\/\//.test(siteUrl)) {
    throw new Error("[config] SITE_URL must be an absolute http(s) URL (e.g. https://example.com).");
  }
  const siteName = required(env, "SITE_NAME");
  const siteTagline = required(env, "SITE_TAGLINE");
  const siteDescription = required(env, "SITE_DESCRIPTION");
  const fromEmail = required(env, "FROM_EMAIL");
  const githubRepoUrl = optional(env, "GITHUB_REPO_URL")?.replace(/\/$/, "") || undefined;
  const footerCreditUrl = optional(env, "FOOTER_CREDIT_URL")?.replace(/\/$/, "") || undefined;
  const footerCreditLabel = optional(env, "FOOTER_CREDIT_LABEL");
  const securityContact = required(env, "SECURITY_CONTACT");
  const icsUidDomain = required(env, "ICS_UID_DOMAIN");
  const icsProdid = required(env, "ICS_PRODID");

  return {
    siteUrl,
    siteName,
    siteTagline,
    siteDescription,
    fromEmail,
    githubRepoUrl,
    footerCreditUrl,
    footerCreditLabel,
    securityContact,
    icsUidDomain,
    icsProdid,
  };
}

/** FROM_EMAIL is required — no DEFAULT_FROM fallback (see email.ts). */
export function requireFromEmail(env: SiteEnv): string {
  return required(env, "FROM_EMAIL");
}
