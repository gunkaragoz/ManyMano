// predeploy gate — fails the build when the app would 500 in production.
//
// Why this exists: every route loader calls getSiteConfig(env) which
// fail-fasts on missing core SITE_* vars. Cloudflare Pages only skips the
// deploy when the build command exits non-zero, so this script runs as part
// of the build (see package.json + the Pages build_command) and aborts on:
//
//   1. Missing/invalid required env vars (the class of bug behind the
//      "Application Error" 500 — only the core brand vars are required now;
//      SECURITY_CONTACT / ICS_* fall back to derived defaults, and the gate
//      proves the loaders stay green without them).
//   2. .env.sample drifting out of sync with the required vars in
//      app/utils/site.ts (so a new required var can't ship undocumented).
//   3. Server bundle that doesn't import or is missing critical routes.
//   4. Root loader throwing with a complete env, or NOT throwing with an
//      incomplete env (fail-fast behavior inverted).
//   5. Missing public assets referenced by root meta/links (og-cover, icons).
//
// Env source: Cloudflare Pages exposes dashboard env vars to the build as
// process.env; locally the dev proxy reads .dev.vars. Mirror that here:
// start from .dev.vars (if present) and let real process.env values win, so
// the same script validates both environments.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert";

const ROOT = process.cwd();
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ FAIL: ${msg}`);
};

// RR7 loaders return `data(payload, init)` (DataWithResponseInit), not a
// Response. Unwrap both shapes so the gate asserts payload + status either way.
function payloadOf(res) {
  if (res !== null && typeof res === "object" && "data" in res && "type" in res) {
    return res.data;
  }
  return res;
}

async function payloadJson(res) {
  const payload = payloadOf(res);
  if (payload !== null && typeof payload === "object" && typeof payload.json === "function") {
    return payload.json();
  }
  return payload;
}

function statusOf(res) {
  if (res instanceof Response) return res.status;
  if (res !== null && typeof res === "object" && "init" in res) {
    const init = res.init;
    if (typeof init === "number") return init;
    return init?.status ?? 200;
  }
  return 200;
}

/** Parse a KEY=VALUE dotenv-style file (quotes stripped, `#` comments ignored). */
function parseDotenvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Effective env: .dev.vars base, real process.env wins (Pages build vars). */
function loadEffectiveEnv() {
  const devVarsPath = resolve(ROOT, ".dev.vars");
  const base = existsSync(devVarsPath) ? parseDotenvFile(devVarsPath) : {};
  const fromFile = existsSync(devVarsPath) ? ".dev.vars" : "(no .dev.vars file)";
  const env = { ...base };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== "") env[k] = v;
  }
  return { env, fromFile };
}

// --- 1. Derive the required-var list from the source of truth ---------------
console.log("\n[1/5] Required env vars match app/utils/site.ts");
const siteTs = readFileSync(resolve(ROOT, "app/utils/site.ts"), "utf8");
const requiredKeys = [
  ...new Set(
    [...siteTs.matchAll(/required\s*\(\s*env\s*,\s*["']([A-Z0-9_]+)["']/g)].map((m) => m[1])
  ),
];
assert(requiredKeys.length > 0, "could not parse any required() keys from site.ts");
console.log(`  required by code: ${requiredKeys.join(", ")}`);

// --- 2. .env.sample must document every required var --------------------------
console.log("\n[2/5] .env.sample documents every required var");
const sample = parseDotenvFile(resolve(ROOT, ".env.sample"));
for (const key of requiredKeys) {
  if (!(key in sample)) fail(`.env.sample is missing key ${key} (document it!)`);
  else if (!sample[key].trim()) fail(`.env.sample has empty placeholder for ${key}`);
  else ok(`.env.sample documents ${key}`);
}

// --- 3. Effective env must satisfy getSiteConfig ------------------------------
console.log("\n[3/5] Effective env satisfies getSiteConfig");
const { env, fromFile } = loadEffectiveEnv();
console.log(`  source: ${fromFile} + process.env overrides`);
for (const key of requiredKeys) {
  if (!((env[key] ?? "").trim())) {
    fail(
      `Missing required env var ${key}. ` +
        `Set it in Cloudflare Pages dashboard (production) or .dev.vars (local). See .env.sample.`
    );
  } else ok(`${key} is set`);
}
if (((env.SITE_URL ?? "").trim()) && !/^https?:\/\//.test(env.SITE_URL.trim().replace(/\/$/, ""))) {
  fail(`SITE_URL must be an absolute http(s) URL, got ${JSON.stringify(env.SITE_URL)}`);
} else if (((env.SITE_URL ?? "").trim())) {
  ok("SITE_URL is an absolute http(s) URL");
}

// --- 4. Server bundle imports; critical routes + loaders present --------------
console.log("\n[4/5] Server bundle imports with all critical routes");
const serverEntry = resolve(ROOT, "build/server/index.js");
if (!existsSync(serverEntry)) {
  fail(`build/server/index.js not found — run the build before this gate (pnpm run build)`);
} else {
  try {
    const mod = await import(serverEntry);
    const routes = mod.routes ?? {};
    const routeIds = Object.keys(routes);
    console.log(`  routes in bundle: ${routeIds.join(", ")}`);
    const critical = [
      "root",
      "routes/_index",
      "routes/events.$id",
      "routes/events.$id.ics",
      "routes/events.$id.export",
      "routes/create.signup",
      "routes/create.poll",
    ];
    for (const id of critical) {
      if (!routes[id]) fail(`route ${id} missing from server bundle`);
      else ok(`route ${id} present`);
    }
    if (typeof routes.root?.module?.loader !== "function") {
      fail("root route has no loader export");
    } else {
      ok("root route loader export present");

      // 4a. Root loader succeeds with the complete env (would 500 otherwise).
      const mockRequest = (url) => new Request(url ?? "https://smoke-test.local/");
      try {
        const res = await routes.root.module.loader({
          context: { cloudflare: { env } },
          request: mockRequest(`${env.SITE_URL || "https://smoke-test.local"}/`),
          params: {},
        });
        const data = await payloadJson(res);
        assert(data?.site?.siteUrl, "root loader response has no site.siteUrl");
        assert(data?.site?.siteName, "root loader response has no site.siteName");
        ok(`root loader 200 with complete env (siteUrl=${data.site.siteUrl})`);
      } catch (err) {
        fail(`root loader threw with COMPLETE env (this is the production 500): ${err?.message}`);
      }

      // 4b. Root loader fail-fasts with an incomplete env (guard must work).
      for (const key of requiredKeys) {
        const broken = { ...env };
        delete broken[key];
        let threw = false;
        try {
          await routes.root.module.loader({
            context: { cloudflare: { env: broken } },
            request: mockRequest(),
            params: {},
          });
        } catch {
          threw = true;
        }
        if (!threw) fail(`root loader did NOT throw without ${key} (fail-fast broken!)`);
        else ok(`root loader fail-fasts without ${key}`);
      }

      // 4c. Home loader succeeds too (homepage is the most-hit route).
      if (typeof routes["routes/_index"]?.module?.loader === "function") {
        try {
          const res = await routes["routes/_index"].module.loader({
            context: { cloudflare: { env } },
            request: mockRequest(),
            params: {},
          });
          assert.strictEqual(statusOf(res), 200);
          ok("home (/) loader 200 with complete env");
        } catch (err) {
          fail(`home (/) loader threw with COMPLETE env: ${err?.message}`);
        }
      } else {
        fail("home (routes/_index) route has no loader export");
      }

      // 4d. Regression: optional vars absent (the production scenario that
      // once 500'd). Derived defaults kick in — loaders must stay green and
      // the resolved values must be brand-correct, not hardcoded.
      const OPTIONAL_WITH_DEFAULTS = ["SECURITY_CONTACT", "ICS_UID_DOMAIN", "ICS_PRODID"];
      const minimal = { ...env };
      for (const key of OPTIONAL_WITH_DEFAULTS) delete minimal[key];
      try {
        const res = await routes.root.module.loader({
          context: { cloudflare: { env: minimal } },
          request: mockRequest(`${env.SITE_URL || "https://smoke-test.local"}/`),
          params: {},
        });
        assert.strictEqual(statusOf(res), 200);
        ok("root loader 200 WITHOUT optional vars (derived defaults)");
      } catch (err) {
        fail(`root loader threw WITHOUT optional vars (production 500 risk): ${err?.message}`);
      }
      if (typeof routes["routes/_index"]?.module?.loader === "function") {
        try {
          const res = await routes["routes/_index"].module.loader({
            context: { cloudflare: { env: minimal } },
            request: mockRequest(),
            params: {},
          });
          assert.strictEqual(statusOf(res), 200);
          ok("home (/) loader 200 WITHOUT optional vars");
        } catch (err) {
          fail(`home (/) loader threw WITHOUT optional vars: ${err?.message}`);
        }
      }
      // security.txt / .ics loaders resolve config through the same
      // getSiteConfig path, so the root-loader checks above cover them.
    }
  } catch (err) {
    fail(`server bundle import failed (broken build would 500): ${err?.message}`);
  }
}

// --- 5. Public assets referenced by root meta/links exist ---------------------
console.log("\n[5/5] Public SEO/PWA assets exist");
for (const asset of [
  "public/og-cover.png",
  "public/favicon.svg",
  "public/favicon-32x32.png",
  "public/favicon-16x16.png",
  "public/apple-touch-icon.png",
]) {
  if (!existsSync(resolve(ROOT, asset))) fail(`missing ${asset}`);
  else ok(asset);
}

console.log("");
if (failures > 0) {
  console.error(`⛔ PREDEPLOY GATE FAILED (${failures} check${failures === 1 ? "" : "s"}) — refusing to deploy.`);
  process.exit(1);
}
console.log("✅ PREDEPLOY GATE PASSED — safe to deploy.");
