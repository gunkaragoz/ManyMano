/// <reference types="@remix-run/cloudflare" />
/// <reference types="@cloudflare/workers-types" />

import type { D1Database } from "@cloudflare/workers-types";

declare module "@remix-run/cloudflare" {
  interface AppLoadContext {
    cloudflare: {
      env: {
        DB: D1Database;
        RESEND_API_KEY?: string;
        ALERT_WEBHOOK_URL?: string;
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
        TURNSTILE_SITE_KEY?: string;
        TURNSTILE_SECRET_KEY?: string;
        TURNSTILE_HOSTNAMES?: string;
      };
      cf: CfProperties;
      ctx: ExecutionContext;
      caches: CacheStorage;
    };
  }
}
