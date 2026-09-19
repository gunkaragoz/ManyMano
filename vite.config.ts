import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Parse a KEY=VALUE dotenv-style file (quotes stripped, `#` comments ignored). */
function parseDevVarsFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
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

/**
 * Dev port follows SITE_URL in .dev.vars (single source of truth), so the
 * origin being served always matches the canonical URLs the app renders.
 * An explicit `--port` CLI flag still wins over this default.
 * NOTE: this fallback is dev-server plumbing only (which port to bind) —
 * the app itself still fail-fasts on missing env vars at request time.
 */
function devPort(): number {
  const fallback = 5173;
  try {
    const path = resolve(process.cwd(), ".dev.vars");
    if (!existsSync(path)) {
      console.warn(
        "[config] .dev.vars not found — dev server defaults to port 5173. Copy .env.sample to .dev.vars."
      );
      return fallback;
    }
    const siteUrl = (parseDevVarsFile(path).SITE_URL ?? "").trim();
    if (!siteUrl) {
      console.warn("[config] SITE_URL missing in .dev.vars — dev server defaults to port 5173.");
      return fallback;
    }
    const parsedPort = new URL(siteUrl).port;
    const port = parsedPort ? Number.parseInt(parsedPort, 10) : fallback;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      console.warn(
        `[config] Could not parse a port from SITE_URL=${siteUrl} — dev server defaults to port 5173.`
      );
      return fallback;
    }
    return port;
  } catch (err) {
    console.warn(`[config] Failed to read dev port from .dev.vars — defaulting to 5173 (${err}).`);
    return fallback;
  }
}

export default defineConfig({
  // Vite 8 resolves tsconfig paths natively (replaces vite-tsconfig-paths).
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: devPort(),
    // Fail loudly instead of silently drifting to 5174/5175 when the
    // .dev.vars port is busy — drift is what desyncs canonical URLs.
    strictPort: true,
  },
  // Pre-bundle all client deps upfront. Otherwise Vite discovers them lazily
  // per page load (lucide-react, drizzle-orm, ...) and each discovery
  // invalidates already-served `?v=` hashes mid-session — browsers then get
  // 504 (Outdated Optimize Dep) and the app never hydrates (stuck on SSR
  // defaults like UTC + dead controls). Seen in the wild Sep 2026.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router",
      "react-router/dom",
      "lucide-react",
      "clsx",
      "tailwind-merge",
      "drizzle-orm",
    ],
  },
  plugins: [
    // Bind to React Router's ssr environment so workers/app.ts (the wrangler
    // entry, importing virtual:react-router/server-build) builds with the
    // client manifest available. Without this the plugin spawns its own
    // worker environment and the server-manifest virtual module 404s.
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    reactRouter(),
  ],
});
