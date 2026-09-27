#!/usr/bin/env node
// Weekly SEO check. Zero dependencies (Node 20+). See seo/README.md.
//
//   node scripts/seo/weekly.mjs --site https://manymano.com [--out seo/data] [--no-fail]
//
// Env (all optional — missing sources are reported as missing, never guessed):
//   GSC_SERVICE_ACCOUNT_JSON  service-account key JSON with read access to the property
//   GSC_PROPERTY              e.g. "sc-domain:manymano.com" or "https://manymano.com/"
//   PSI_API_KEY               PageSpeed Insights key (works without; keyless is rate-limited)
//   SEO_PSI_PAGES             how many pages to speed-test (default 3; 0 disables)
//
// Writes <out>/snapshots/YYYY-MM-DD.json and <out>/reports/YYYY-MM-DD.md,
// compares against the newest earlier snapshot, and exits 1 on blocking
// errors (non-200, noindex, broken canonical/JSON-LD) unless --no-fail.

import { createSign } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateGsc,
  checkPage,
  checkSite,
  diffSnapshots,
  parsePage,
  parseSitemap,
  renderReport,
  robotsDisallows,
  scorePages,
} from "./lib.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE = (arg("site", process.env.SITE_URL) ?? "").replace(/\/$/, "");
const OUT = arg("out", "seo/data");
const NO_FAIL = args.includes("--no-fail");
const WINDOW_DAYS = 28;
const GSC_LAG_DAYS = 3; // Search Console data lands 2–3 days late
const UA = "ManyManoSEOCheck/1.0 (+weekly self-audit)";

if (!SITE.startsWith("http")) {
  console.error("Usage: node scripts/seo/weekly.mjs --site https://example.com [--out dir] [--no-fail]");
  process.exit(2);
}

const log = (...m) => console.error("[seo]", ...m);
const isoDay = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400_000));

async function get(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeout ?? 30_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(t);
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

// --- 1. Crawl + on-page checks ---------------------------------------------

/** Fetch text; network failures come back as status 0 instead of throwing. */
async function fetchText(url) {
  try {
    const res = await get(url);
    return { status: res.status, ok: res.ok, text: res.ok ? await res.text() : "" };
  } catch (e) {
    return { status: 0, ok: false, text: "", error: String(e.message ?? e) };
  }
}

async function audit() {
  const siteFindings = [];
  const siteError = (code, message) => siteFindings.push({ level: "error", code, message });
  const failure = (r) => (r.status ? `HTTP ${r.status}` : r.error);

  const robotsRes = await fetchText(`${SITE}/robots.txt`);
  const robots = robotsRes.text;
  const disallows = robotsDisallows(robots);
  if (!robotsRes.ok) siteError("robots", `robots.txt ${failure(robotsRes)}`);
  else if (!/^sitemap:/im.test(robots)) siteFindings.push({ level: "warn", code: "robots-sitemap", message: "robots.txt has no Sitemap line" });

  // A broken or empty sitemap is itself the finding: record it and still
  // write a report, so the weekly issue explains why the run failed.
  const smRes = await fetchText(`${SITE}/sitemap.xml`);
  const locs = smRes.ok ? parseSitemap(smRes.text) : [];
  if (!smRes.ok) siteError("sitemap", `sitemap.xml ${failure(smRes)}`);
  else if (!locs.length) siteError("sitemap-empty", "sitemap.xml lists no URLs");
  // Sitemap <loc>s use SITE_URL; fetch them on the origin under test so a
  // staging run checks staging, but keep the canonical comparison honest.
  const canonicalOrigin = locs[0] ? new URL(locs[0]).origin : SITE;

  const pages = await pool(locs, 4, async (loc) => {
    const path = new URL(loc).pathname;
    const fetchUrl = `${SITE}${path}`;
    try {
      const res = await get(fetchUrl, { redirect: "manual" });
      const html = res.status === 200 ? await res.text() : "";
      const headers = Object.fromEntries(res.headers.entries());
      const page = html ? parsePage(html, `${canonicalOrigin}${path}`) : null;
      const findings = checkPage({ url: `${canonicalOrigin}${path}`, status: res.status, headers, page, disallows });
      return { path, status: res.status, page, findings };
    } catch (e) {
      return { path, status: 0, page: null, findings: [{ level: "error", code: "fetch", message: String(e.message ?? e) }] };
    }
  });

  const site = checkSite(pages);
  return {
    pages: pages.map(({ page, ...rest }) => ({
      ...rest,
      title: page?.title ?? null,
      description: page?.description ?? null,
      h1: page?.h1s?.[0] ?? null,
      h2s: page?.h2s ?? [],
      wordCount: page?.wordCount ?? 0,
      jsonLd: page?.jsonLd ?? [],
      inbound: site.inbound[rest.path] ?? 0,
    })),
    site: [...siteFindings, ...site.findings],
  };
}

// --- 2. Search Console -------------------------------------------------------

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function gscToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const res = await get("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token;
}

async function gscQuery(token, property, body) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const res = await get(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rowLimit: 25000, dataState: "final", ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`searchAnalytics: ${json.error?.message ?? res.status}`);
  return json.rows ?? [];
}

const toPath = (pageUrl) => {
  try {
    return new URL(pageUrl).pathname.replace(/(.)\/+$/, "$1");
  } catch {
    return pageUrl;
  }
};

async function searchConsole() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  const property = process.env.GSC_PROPERTY;
  if (!raw || !property) return { missing: "GSC_SERVICE_ACCOUNT_JSON / GSC_PROPERTY not set" };
  try {
    const token = await gscToken(JSON.parse(raw));
    const endDate = daysAgo(GSC_LAG_DAYS);
    const startDate = daysAgo(GSC_LAG_DAYS + WINDOW_DAYS - 1);
    // Day × page: stored so each week's snapshot is a clean daily history.
    const dayPage = (await gscQuery(token, property, { startDate, endDate, dimensions: ["date", "page"] })).map((r) => ({
      date: r.keys[0],
      path: toPath(r.keys[1]),
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
    }));
    // Page × query drops low-volume rows (Google anonymises them) — use for
    // "which queries", never for totals.
    const queries = (await gscQuery(token, property, { startDate, endDate, dimensions: ["page", "query"], rowLimit: 500 }))
      .map((r) => ({
        path: toPath(r.keys[0]),
        query: r.keys[1],
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
      }))
      .sort((a, b) => b.impressions - a.impressions);
    const pages = aggregateGsc(dayPage);
    const totals = pages.reduce((t, p) => ({ clicks: t.clicks + p.clicks, impressions: t.impressions + p.impressions }), {
      clicks: 0,
      impressions: 0,
    });
    return { window: `${startDate} → ${endDate}`, startDate, endDate, totals, pages, queries, daily: dayPage };
  } catch (e) {
    return { missing: `Search Console request failed (${e.message})` };
  }
}

// --- 3. Conversions (the app's own /api/conversions) --------------------------

async function conversions() {
  try {
    const res = await get(`${SITE}/api/conversions?days=${WINDOW_DAYS + GSC_LAG_DAYS}`);
    if (!res.ok) return { missing: `/api/conversions HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { missing: `/api/conversions failed (${e.message})` };
  }
}

// --- 4. PageSpeed Insights (mobile) -----------------------------------------

async function pageSpeed(paths) {
  const key = process.env.PSI_API_KEY;
  return pool(paths, 1, async (path) => {
    const q = new URLSearchParams({ url: `${SITE}${path}`, strategy: "mobile", category: "performance" });
    if (key) q.set("key", key);
    try {
      const res = await get(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { timeout: 90_000 });
      const j = await res.json();
      if (!res.ok) return { path, error: j.error?.message?.slice(0, 80) ?? `HTTP ${res.status}` };
      const a = j.lighthouseResult?.audits ?? {};
      const inp = j.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile;
      return {
        path,
        score: Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100),
        lcp: a["largest-contentful-paint"]?.displayValue ?? "?",
        cls: a["cumulative-layout-shift"]?.displayValue ?? "?",
        inp: inp != null ? `${inp} ms` : null,
      };
    } catch (e) {
      return { path, error: String(e.message ?? e).slice(0, 80) };
    }
  });
}

// --- Run ---------------------------------------------------------------------

function previousSnapshot(dir, today) {
  try {
    const files = readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${today}.json`)
      .sort();
    return files.length ? JSON.parse(readFileSync(join(dir, files.at(-1)), "utf8")) : null;
  } catch {
    return null;
  }
}

const date = isoDay(new Date());
log(`checking ${SITE}`);
const [auditOut, gsc, conv] = await Promise.all([audit(), searchConsole(), conversions()]);

const search = gsc.missing ? null : gsc;
// Only count conversions inside the Search Console window (it ends
// GSC_LAG_DAYS ago); later days have no clicks to compare against.
const convOut = conv.missing
  ? null
  : search
    ? { ...conv, rows: conv.rows.filter((r) => r.day >= search.startDate && r.day <= search.endDate) }
    : conv;
// null conversions = unknown, never "zero": scorePages won't make calls on it.
const scored = search ? scorePages(search.pages, convOut ? convOut.rows : null) : null;

const psiCount = Number(process.env.SEO_PSI_PAGES ?? 3);
const psiPaths = ["/", ...(scored?.rows.filter((r) => r.call === "candidate").map((r) => r.path) ?? [])]
  .filter((p, i, a) => a.indexOf(p) === i)
  .slice(0, psiCount);
const speed = psiCount > 0 ? await pageSpeed(psiPaths) : [];

const snapshotDir = join(OUT, "snapshots");
const reportDir = join(OUT, "reports");
mkdirSync(snapshotDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

const snapshot = {
  date,
  siteUrl: SITE,
  audit: auditOut,
  search,
  conversions: convOut,
  scored,
  speed,
  missing: { gsc: gsc.missing ?? null, conversions: conv.missing ?? null },
};
snapshot.diff = diffSnapshots(previousSnapshot(snapshotDir, date), snapshot);

writeFileSync(join(snapshotDir, `${date}.json`), JSON.stringify(snapshot, null, 2) + "\n");
const report = renderReport(snapshot);
writeFileSync(join(reportDir, `${date}.md`), report + "\n");
writeFileSync(join(OUT, "latest.md"), report + "\n");
log(`wrote ${join(reportDir, `${date}.md`)}`);
console.log(report);

const blocking = auditOut.pages.flatMap((p) => p.findings).concat(auditOut.site).filter((f) => f.level === "error");
if (blocking.length && !NO_FAIL) {
  log(`${blocking.length} blocking error(s)`);
  process.exit(1);
}
