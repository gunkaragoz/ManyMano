// predeploy gate — fails the deploy when the app would 500 in production.
//
// Why this exists: every route loader calls getSiteConfig(env) which
// fail-fasts on missing core SITE_* vars. Wrangler only skips the deploy
// when the deploy command exits non-zero, so this script runs as part of
// `pnpm run deploy` (see package.json) and aborts on:
//
//   1. Missing/invalid required env vars (the class of bug behind the
//      "Application Error" 500 — only the core brand vars are required now;
//      SECURITY_CONTACT / ICS_* fall back to derived defaults).
//   2. .env.sample drifting out of sync with the required vars in
//      app/utils/site.ts (so a new required var can't ship undocumented).
//   3. Missing build artifact or critical routes (a broken build /
//      accidentally deleted route would 500 or 404 in production).
//   4. Missing public assets referenced by root meta/links (og-cover, icons).
//
// Loader behavior itself (200 with complete env, throw per missing key,
// green without optional vars) is covered by
// tests/bundle/server-bundle.test.ts, which seeds a real
// RouterContextProvider like workers/app.ts does. The built worker entry
// (build/server/index.js) is workerd-only and cannot be imported in node,
// so this gate asserts its presence + shape instead of executing it.
//
// Env source: `wrangler deploy` exposes dashboard vars at runtime, not at
// build time; locally the Cloudflare Vite plugin reads .dev.vars. Mirror
// that here: start from .dev.vars (if present) and let real process.env
// values win, so the same script validates both environments.

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

/** Effective env: .dev.vars base, real process.env wins (dashboard vars). */
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
console.log("\n[1/6] Required env vars match app/utils/site.ts");
const siteTs = readFileSync(resolve(ROOT, "app/utils/site.ts"), "utf8");
const requiredKeys = [
  ...new Set(
    [...siteTs.matchAll(/required\s*\(\s*env\s*,\s*["']([A-Z0-9_]+)["']/g)].map((m) => m[1])
  ),
];
assert(requiredKeys.length > 0, "could not parse any required() keys from site.ts");
console.log(`  required by code: ${requiredKeys.join(", ")}`);

// --- 2. .env.sample must document every required var --------------------------
console.log("\n[2/6] .env.sample documents every required var");
const sample = parseDotenvFile(resolve(ROOT, ".env.sample"));
for (const key of requiredKeys) {
  if (!(key in sample)) fail(`.env.sample is missing key ${key} (document it!)`);
  else if (!sample[key].trim()) fail(`.env.sample has empty placeholder for ${key}`);
  else ok(`.env.sample documents ${key}`);
}

// --- 3. Effective env must satisfy getSiteConfig ------------------------------
console.log("\n[3/6] Effective env satisfies getSiteConfig");
const { env, fromFile } = loadEffectiveEnv();
console.log(`  source: ${fromFile} + process.env overrides`);
for (const key of requiredKeys) {
  if (!((env[key] ?? "").trim())) {
    fail(
      `Missing required env var ${key}. ` +
        `Set it via wrangler secret/vars (production) or .dev.vars (local). See .env.sample.`
    );
  } else ok(`${key} is set`);
}
if (((env.SITE_URL ?? "").trim()) && !/^https?:\/\//.test(env.SITE_URL.trim().replace(/\/$/, ""))) {
  fail(`SITE_URL must be an absolute http(s) URL, got ${JSON.stringify(env.SITE_URL)}`);
} else if (((env.SITE_URL ?? "").trim())) {
  ok("SITE_URL is an absolute http(s) URL");
}

// --- 4. Build artifact + critical routes + worker entry present ---------------
console.log("\n[4/6] Build artifact, worker entry and critical routes present");
for (const artifact of ["build/server/index.js", "build/client"]) {
  if (!existsSync(resolve(ROOT, artifact))) {
    fail(`${artifact} not found — run the build before this gate (pnpm run build)`);
  } else ok(artifact);
}
const workerSrc = resolve(ROOT, "workers/app.ts");
if (!existsSync(workerSrc)) {
  fail("workers/app.ts not found (Worker entry missing — nothing to deploy)");
} else {
  const src = readFileSync(workerSrc, "utf8");
  for (const [label, re] of [
    ["createRequestHandler", /createRequestHandler/],
    ["provider context seeding", /RouterContextProvider/],
    ["cloudflare context key", /cloudflareContext/],
    ["www → apex redirect", /www\./],
  ]) {
    if (!re.test(src)) fail(`workers/app.ts missing ${label}`);
    else ok(`workers/app.ts: ${label}`);
  }
}
const wranglerToml = readFileSync(resolve(ROOT, "wrangler.toml"), "utf8");
for (const [label, re] of [
  ["worker entry", /workers\/app\.ts/],
  ["D1 binding", /binding\s*=\s*"DB"/],
]) {
  if (!re.test(wranglerToml)) fail(`wrangler.toml missing ${label}`);
  else ok(`wrangler.toml: ${label}`);
}
const criticalRouteFiles = [
  "app/root.tsx",
  "app/routes/_index.tsx",
  "app/routes/events.$id.tsx",
  "app/routes/events.$id.ics.ts",
  "app/routes/events.$id.export.ts",
  "app/routes/create.signup.tsx",
  "app/routes/create.poll.tsx",
];
for (const file of criticalRouteFiles) {
  if (!existsSync(resolve(ROOT, file))) fail(`critical route ${file} missing`);
  else ok(`route ${file} present`);
}

// --- 5. Public assets referenced by root meta/links exist ---------------------
console.log("\n[5/6] Public SEO/PWA assets exist");
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

// --- 6. Production cron trigger present (reminder scan) ---------------------
console.log("\n[6/6] Production cron trigger present (reminder scan)");
// Scope each check to its own [section]: a triggers block under any other
// env must not satisfy the production assertion (and staging must have
// none — its scan would run without mail credentials).
function tomlSection(src, header) {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^[\]]+\]\s*$/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}
const prodTriggers = tomlSection(wranglerToml, "[env.production.triggers]");
if (!prodTriggers) {
  fail("wrangler.toml has no [env.production.triggers] — the hourly reminder scan is detached");
} else {
  const m = prodTriggers.match(/crons\s*=\s*\[([^\]]*)\]/);
  const crons = m ? m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [];
  if (crons.length === 0) fail("[env.production.triggers] has an empty crons list — no reminder scan");
  else ok(`[env.production.triggers] crons: ${crons.join(", ")}`);
}
if (/^\s*\[triggers\]\s*$/m.test(wranglerToml)) {
  fail('top-level [triggers] present — cron must live under [env.production.triggers] only (staging has none by design)');
} else {
  ok("no top-level [triggers] (production-only cron)");
}
if (tomlSection(wranglerToml, "[env.staging.triggers]")) {
  fail("[env.staging.triggers] present — staging must have no cron trigger");
} else {
  ok("staging has no cron trigger");
}
if (!/async\s+scheduled\s*\(/.test(readFileSync(workerSrc, "utf8"))) {
  fail("workers/app.ts has no async scheduled() handler — the cron trigger would fire into nothing");
} else {
  ok("workers/app.ts: async scheduled() handler");
}

console.log("");
if (failures > 0) {
  console.error(`⛔ PREDEPLOY GATE FAILED (${failures} check${failures === 1 ? "" : "s"}) — refusing to deploy.`);
  process.exit(1);
}
console.log("✅ PREDEPLOY GATE PASSED — safe to deploy.");
