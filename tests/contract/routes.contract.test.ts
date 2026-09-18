// Route contract snapshot — post-migration (RR7) expectations.
//
// History: pre-migration this pinned the Remix 2 state (@remix-run/*
// imports, vitePlugin + v3 flags, Pages Functions entry). After the
// Remix 2 → RR7 move it asserts the new shape instead: all framework
// imports from `react-router`, `reactRouter()` vite plugin, file-based
// routes via app/routes.ts, and the Workers entry. Any dropped route
// export or leftover @remix-run import fails loudly.
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

describe("framework imports (RR7)", () => {
  it("no @remix-run imports remain anywhere in app/", () => {
    const files = readdirSync(ROUTES_DIR);
    for (const f of files) {
      expect(routeSource(f), `${f} still imports @remix-run`).not.toMatch(/@remix-run\//);
    }
    for (const f of ["root.tsx", "entry.client.tsx", "entry.server.tsx", "env.d.ts"]) {
      const src = readFileSync(resolve(ROOT, "app", f), "utf8");
      expect(src, `app/${f} still imports @remix-run`).not.toMatch(/@remix-run\//);
    }
  });

  it("entry files use HydratedRouter / ServerRouter", () => {
    const client = readFileSync(resolve(ROOT, "app/entry.client.tsx"), "utf8");
    const server = readFileSync(resolve(ROOT, "app/entry.server.tsx"), "utf8");
    expect(client).toMatch(/HydratedRouter/);
    expect(server).toMatch(/ServerRouter/);
    expect(server).toMatch(/Content-Security-Policy/);
    expect(server).toMatch(/Strict-Transport-Security/);
  });

  it("vite plugin is reactRouter with no v3 future flags", () => {
    const vite = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toMatch(/@react-router\/dev\/vite/);
    expect(vite).toMatch(/cloudflareDevProxy/);
    expect(vite).not.toMatch(/@remix-run\/dev/);
    expect(vite).not.toMatch(/v3_/);
  });

  it("routes.ts + react-router.config.ts exist (file-based routing preserved)", () => {
    const routes = readFileSync(resolve(ROOT, "app/routes.ts"), "utf8");
    expect(routes).toMatch(/flatRoutes/);
    expect(existsSync(resolve(ROOT, "react-router.config.ts"))).toBe(true);
  });
});

describe("deploy entry", () => {
  it("Pages function handler uses @react-router/cloudflare (Workers move is Phase 1c)", () => {
    const fn = resolve(ROOT, "functions/[[path]].ts");
    expect(existsSync(fn)).toBe(true);
    const src = readFileSync(fn, "utf8");
    expect(src).toMatch(/createPagesFunctionHandler/);
    expect(src).toMatch(/@react-router\/cloudflare/);
    expect(src).not.toMatch(/@remix-run/);
    expect(src).toMatch(/www\./);
    const wrangler = readFileSync(resolve(ROOT, "wrangler.toml"), "utf8");
    expect(wrangler).toMatch(/pages_build_output_dir/);
  });
});
