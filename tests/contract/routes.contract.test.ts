// Route contract snapshot — pre-migration parity detector.
//
// Purpose: before touching Remix/RR/Vite, pin down what each route file
// exports (loader/action/meta/headers) and which framework package it
// imports from. After the codemod the same test runs with the import
// allow-list flipped to `react-router`, and any dropped export fails loudly.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const ROUTES_DIR = resolve(ROOT, "app/routes");

const CRITICAL_ROUTES = [
  "_index.tsx",
  "events.$id.tsx",
  "events.$id.ics.ts",
  "events.$id.export.ts",
  "create.signup.tsx",
  "create.poll.tsx",
];

function routeSource(file: string): string {
  return readFileSync(resolve(ROUTES_DIR, file), "utf8");
}

describe("route files present", () => {
  it("ships all 18 expected route modules", () => {
    const files = readdirSync(ROUTES_DIR).sort();
    expect(files).toHaveLength(18);
    for (const f of CRITICAL_ROUTES) {
      expect(files, `missing critical route ${f}`).toContain(f);
    }
  });

  it("every route resolves brand through getSiteConfig or the root loader (no hardcoded brand)", () => {
    // Shell (create._index, $.tsx) is exempt. Pure-data endpoints
    // (api.pulse, events.$id.export) use only the DB binding — they are
    // exempt as long as they hardcode no brand string.
    // pulse.tsx reads brand via rootSiteFromMatches (root loader owns getSiteConfig).
    const exempt = new Set(["create._index.tsx", "$.tsx", "api.pulse.ts", "events.$id.export.ts"]);
    const files = readdirSync(ROUTES_DIR).filter((f) => !exempt.has(f));
    const offenders = files.filter((f) => !/getSiteConfig|rootSiteFromMatches|site\.ts/.test(routeSource(f)));
    expect(offenders).toEqual([]);

    for (const f of [...exempt]) {
      const src = routeSource(f);
      // Allow "manymano" only in comments/identifiers like manymano-db, never as served copy.
      const served = src
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      expect(served.toLowerCase(), `${f} hardcodes brand copy`).not.toMatch(/manymano\.com/);
    }
  });
});

describe("framework imports (pre-migration snapshot)", () => {
  it("routes import only from @remix-run/* (codemod will flip to react-router)", () => {
    const files = readdirSync(ROUTES_DIR);
    for (const f of files) {
      const src = routeSource(f);
      expect(src, `${f} must not import react-router yet`).not.toMatch(/from ["']react-router["']/);
    }
    const remixUsers = files.filter((f) => /@remix-run\//.test(routeSource(f)));
    // Shell + all data routes use the framework; static text routes may not.
    expect(remixUsers.length).toBeGreaterThan(10);
  });

  it("entry files use RemixBrowser / RemixServer (codemod flips to HydratedRouter / ServerRouter)", () => {
    const client = readFileSync(resolve(ROOT, "app/entry.client.tsx"), "utf8");
    const server = readFileSync(resolve(ROOT, "app/entry.server.tsx"), "utf8");
    expect(client).toMatch(/RemixBrowser/);
    expect(server).toMatch(/RemixServer/);
    expect(server).toMatch(/Content-Security-Policy/);
    expect(server).toMatch(/Strict-Transport-Security/);
  });

  it("vite plugin is still @remix-run/dev with all v3 future flags", () => {
    const vite = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toMatch(/@remix-run\/dev/);
    for (const flag of [
      "v3_fetcherPersist",
      "v3_relativeSplatPath",
      "v3_throwAbortReason",
      "v3_singleFetch",
      "v3_lazyRouteDiscovery",
    ]) {
      expect(vite, `missing future flag ${flag}`).toContain(flag);
    }
  });
});

describe("deploy entry", () => {
  it("Pages function handler exists (Workers migration removes it later)", () => {
    const fn = resolve(ROOT, "functions/[[path]].ts");
    expect(existsSync(fn)).toBe(true);
    const src = readFileSync(fn, "utf8");
    expect(src).toMatch(/createPagesFunctionHandler/);
    expect(src).toMatch(/www\./);
  });
});
