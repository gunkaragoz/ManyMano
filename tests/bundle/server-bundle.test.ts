// Loader parity — source-level, through a real RouterContextProvider.
//
// History: this suite used to import the built server bundle and call
// loaders directly (Remix v2 / RR7-Pages era). Under Workers (RR8) the
// server bundle is a workerd-only worker entry that cannot be imported in
// plain node — and calling loaders with hand-made `{ cloudflare: ... }`
// objects would bypass the exact thing being migrated (the v8 provider
// context). So this now imports the route modules from source (vitest
// transforms TS natively) and seeds a REAL RouterContextProvider exactly
// like workers/app.ts does, asserting:
//
//   - root + home loaders 200 with complete env (payload carries brand)
//   - fail-fast per missing required key (loader throws, never stale brand)
//   - loaders stay green without optional vars (derived-defaults regression)
//
// Artifact serving (real HTTP incl. CSP/HSTS/www-redirect) is covered by
// the staging HTTP suites + manual dev smoke, not here.
import { describe, expect, it } from "vitest";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/utils/cloudflare-context";
import { loader as rootLoader } from "~/root";
import { loader as homeLoader } from "~/routes/_index";

const ROOT = process.cwd();

function requiredKeys(): string[] {
  const siteTs = readFileSync(resolve(ROOT, "app/utils/site.ts"), "utf8");
  const keys = [
    ...new Set(
      [...siteTs.matchAll(/required\s*\(\s*env\s*,\s*["']([A-Z0-9_]+)["']/g)].map((m) => m[1])
    ),
  ];
  assert(keys.length > 0, "could not parse required() keys from site.ts");
  return keys;
}

function completeEnv(): Record<string, string> {
  return {
    SITE_URL: "https://smoke-test.local",
    SITE_NAME: "ManyMano",
    SITE_TAGLINE: "Free sign-up sheets and meeting polls.",
    SITE_DESCRIPTION: "Free sign-up sheets and meeting polls.",
    FROM_EMAIL: "ManyMano <no-reply@mail.example.com>",
  };
}

// Seed a provider exactly like workers/app.ts does in production.
function seedContext(env: Record<string, string>): RouterContextProvider {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: env as never,
    cf: {} as never,
    ctx: { waitUntil: () => {}, passThroughOnException: () => {} },
    caches: {} as never,
  });
  return context;
}

// RR8 loaders return `data(payload, init)` (DataWithResponseInit), not a
// Response. Unwrap both shapes so the gate asserts payload + status either way.
function payloadOf(res: unknown): unknown {
  if (res !== null && typeof res === "object" && "data" in res && "type" in res) {
    return (res as { data: unknown }).data;
  }
  return res;
}

function statusOf(res: unknown): number {
  if (res instanceof Response) return res.status;
  if (res !== null && typeof res === "object" && "init" in res) {
    const init = (res as { init?: ResponseInit | number | null }).init;
    if (typeof init === "number") return init;
    return init?.status ?? 200;
  }
  return 200;
}

describe("loader parity through provider context", () => {
  it("root + home loaders 200 with complete env (payload carries brand)", async () => {
    const context = seedContext(completeEnv());
    const req = (url = "https://smoke-test.local/") => new Request(url);
    const rootRes = (await rootLoader({
      request: req("https://smoke-test.local/"),
      context,
      params: {},
    } as never)) as unknown;
    const data = payloadOf(rootRes) as { site?: { siteUrl?: string; siteName?: string } };
    expect(data?.site?.siteUrl).toBeTruthy();
    expect(data?.site?.siteName).toBeTruthy();

    const homeRes = (await homeLoader({ request: req(), context, params: {} } as never)) as unknown;
    expect(statusOf(homeRes)).toBe(200);
  });

  it("root loader fail-fasts per required key (throws, never stale brand)", async () => {
    for (const key of requiredKeys()) {
      const broken = { ...completeEnv() };
      delete broken[key];
      let threw = false;
      try {
        await rootLoader({
          request: new Request("https://smoke-test.local/"),
          context: seedContext(broken),
          params: {},
        } as never);
      } catch {
        threw = true;
      }
      expect(threw, `root loader did NOT throw without ${key}`).toBe(true);
    }
  });

  it("loaders stay green without optional vars (derived-defaults regression)", async () => {
    const context = seedContext(completeEnv());
    const req = new Request("https://smoke-test.local/");
    const rootRes = (await rootLoader({ request: req, context, params: {} } as never)) as unknown;
    expect(statusOf(rootRes)).toBe(200);
    const homeRes = (await homeLoader({ request: req, context, params: {} } as never)) as unknown;
    expect(statusOf(homeRes)).toBe(200);
  });
});
