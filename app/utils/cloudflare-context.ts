// Cloudflare load-context bridge (React Router v8).
//
// v8 removed `AppLoadContext`: loader/action `context` is always a
// `RouterContextProvider`, and the server entry seeds it via `getLoadContext`
// (see workers/app.ts). Route modules read the Cloudflare bindings through
// the `cloudflareContext` key with `getCloudflareEnv(context)` — one line
// per loader, fully typed, no casts at call sites.

import { createContext, type RouterContextProvider } from "react-router";
import type { D1Database } from "@cloudflare/workers-types";

export interface CloudflareEnv {
  DB: D1Database;
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_SECURE?: string;
  EMAIL_DAILY_LIMIT?: string;
  EMAIL_MONTHLY_LIMIT?: string;
  ALERT_WEBHOOK_URL?: string;
  REMINDER_SECRET?: string;
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
}

export interface CloudflareContextValue {
  env: CloudflareEnv;
  cf: CfProperties;
  ctx: Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;
  caches: CacheStorage;
}

export const cloudflareContext = createContext<CloudflareContextValue>();

/** Read typed Cloudflare env inside loaders/actions. Throws when unset (fail-fast). */
export function getCloudflareEnv(context: Readonly<RouterContextProvider>): CloudflareEnv {
  return context.get(cloudflareContext).env;
}
