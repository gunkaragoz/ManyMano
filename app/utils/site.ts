// Central site/brand configuration — single source of truth.
//
// Required values come from the runtime environment
// (Cloudflare Pages dashboard in production, `.dev.vars` locally).
// Only the core brand vars are required: a missing required variable throws
// at request time so a rebrand / fork can never silently serve stale defaults.
//
// Required vars (see `.env.sample`):
//   SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION, FROM_EMAIL
//
// Optional vars with derived defaults (empty/unset falls back, never throws):
//   SECURITY_CONTACT → GITHUB_REPO_URL + "/issues", else mailto:FROM_EMAIL
//   ICS_UID_DOMAIN   → hostname of SITE_URL (e.g. manymano.com)
//   ICS_PRODID       → PRODID:-//{SITE_NAME}//Open Source Scheduling//EN
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
 * Default security.txt Contact when SECURITY_CONTACT is unset. Prefers the
 * repo issue tracker (already brand-correct via GITHUB_REPO_URL); otherwise
 * falls back to the FROM_EMAIL address. FROM_EMAIL is required, so this
 * always resolves — never throws, never hardcodes a brand.
 */
function defaultSecurityContact(githubRepoUrl: string | undefined, fromEmail: string): string {
  if (githubRepoUrl) return `${githubRepoUrl}/issues`;
  const angled = fromEmail.match(/<([^<>@\s]+@[^<>@\s]+)>/)?.[1];
  const bare = fromEmail.trim();
  const addr = angled ?? (/^[^<>\s]+@[^<>\s]+$/.test(bare) ? bare : null);
  return addr ? `mailto:${addr}` : bare;
}

/**
 * Resolve + validate full site config. Required fields throw when absent
 * (fail-fast, no fallback); GITHUB_REPO_URL / FOOTER_CREDIT_URL /
 * FOOTER_CREDIT_LABEL are optional and resolve to `undefined` when unset;
 * SECURITY_CONTACT / ICS_UID_DOMAIN / ICS_PRODID fall back to values derived
 * from the required vars (never throw, never hardcode a brand).
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
  const securityContact =
    optional(env, "SECURITY_CONTACT") ?? defaultSecurityContact(githubRepoUrl, fromEmail);
  const icsUidDomain = optional(env, "ICS_UID_DOMAIN") ?? new URL(siteUrl).hostname;
  const icsProdid = optional(env, "ICS_PRODID") ?? `PRODID:-//${siteName}//Open Source Scheduling//EN`;

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
