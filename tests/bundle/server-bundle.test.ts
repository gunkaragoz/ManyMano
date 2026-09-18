// Server-bundle parity — Vitest port of tests/predeploy.mjs §4.
//
// Runs against the built `build/server/index.js` (so `pnpm run build` must
// run first). Mirrors the predeploy gate: critical routes present, root +
// home loaders 200 with complete env, fail-fast per required key, and the
// optional-vars regression (loaders stay green without SECURITY_CONTACT /
// ICS_*). After the RR/Vite migration the bundle path or route-id shape may
// change — update the import below, keep the assertions.
import { describe, expect, it } from "vitest";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const SERVER_ENTRY = resolve(ROOT, "build/server/index.js");

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

const CRITICAL_IDS = [
  "root",
  "routes/_index",
  "routes/events.$id",
  "routes/events.$id.ics",
  "routes/events.$id.export",
  "routes/create.signup",
  "routes/create.poll",
];

describe("server bundle", () => {
  it("build output exists (run `pnpm run build` first)", () => {
    expect(existsSync(SERVER_ENTRY), "build/server/index.js not found — run the build first").toBe(true);
  });

  it("contains all critical routes with loaders", async () => {
    const mod = await import(SERVER_ENTRY);
    const routes = mod.routes ?? {};
    for (const id of CRITICAL_IDS) {
      expect(routes[id], `route ${id} missing from server bundle`).toBeTruthy();
    }
    expect(typeof routes.root?.module?.loader).toBe("function");
    expect(typeof routes["routes/_index"]?.module?.loader).toBe("function");
  });

  it("root + home loaders 200 with complete env", async () => {
    const mod = await import(SERVER_ENTRY);
    const env = completeEnv();
    const req = (url = "https://smoke-test.local/") => new Request(url);
    const rootRes = await mod.routes.root.module.loader({
      context: { cloudflare: { env } },
      request: req(`${env.SITE_URL}/`),
      params: {},
    });
    const data = await rootRes.json();
    expect(data?.site?.siteUrl).toBeTruthy();
    expect(data?.site?.siteName).toBeTruthy();

    const homeRes = await mod.routes["routes/_index"].module.loader({
      context: { cloudflare: { env } },
      request: req(),
      params: {},
    });
    expect(homeRes.status).toBe(200);
  });

  it("root loader fail-fasts per required key", async () => {
    const mod = await import(SERVER_ENTRY);
    for (const key of requiredKeys()) {
      const broken = { ...completeEnv() };
      delete broken[key];
      let threw = false;
      try {
        await mod.routes.root.module.loader({
          context: { cloudflare: { env: broken } },
          request: new Request("https://smoke-test.local/"),
          params: {},
        });
      } catch {
        threw = true;
      }
      expect(threw, `root loader did NOT throw without ${key}`).toBe(true);
    }
  });

  it("loaders stay green without optional vars (derived defaults)", async () => {
    const mod = await import(SERVER_ENTRY);
    const env = completeEnv();
    const req = new Request("https://smoke-test.local/");
    const rootRes = await mod.routes.root.module.loader({
      context: { cloudflare: { env } },
      request: req,
      params: {},
    });
    expect(rootRes.status).toBe(200);
    const homeRes = await mod.routes["routes/_index"].module.loader({
      context: { cloudflare: { env } },
      request: req,
      params: {},
    });
    expect(homeRes.status).toBe(200);
  });
});
