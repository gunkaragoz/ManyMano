// Pure helpers for the weekly SEO check (scripts/seo/weekly.mjs).
// No network, no filesystem: everything here is unit-tested in
// tests/unit/seo-weekly.test.ts.

// ---------------------------------------------------------------------------
// HTML → facts. Regex-based on purpose: we only read our own SSR output and
// a handful of well-known tags, and this keeps the script dependency-free.
// ---------------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'", nbsp: " " };

/** Single pass, so "&amp;lt;" decodes to "&lt;" (not "<"). */
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (_, e) => ENTITIES[e]);
}

/**
 * Every <name …>…</name …> element, found by index scanning rather than a
 * regex (closing tags may carry whitespace/attributes: "</script >").
 * Yields { start, end, open, inner }; an unclosed element runs to the end.
 */
function* elements(html, name) {
  const lower = html.toLowerCase();
  const isNameEnd = (c) => c === undefined || !/[a-z0-9-]/.test(c);
  let from = 0;
  while (true) {
    const start = lower.indexOf(`<${name}`, from);
    if (start < 0) return;
    if (!isNameEnd(lower[start + name.length + 1])) {
      from = start + 1;
      continue;
    }
    const openEnd = lower.indexOf(">", start);
    if (openEnd < 0) return;
    let close = lower.indexOf(`</${name}`, openEnd);
    while (close >= 0 && !isNameEnd(lower[close + name.length + 2])) close = lower.indexOf(`</${name}`, close + 1);
    const closeEnd = close < 0 ? html.length : lower.indexOf(">", close);
    const end = closeEnd < 0 ? html.length : closeEnd + 1;
    yield { start, end, open: html.slice(start, openEnd + 1), inner: html.slice(openEnd + 1, close < 0 ? html.length : close) };
    from = end;
  }
}

/** Drop whole elements (script/style) — contents included. */
function removeElements(html, name) {
  let out = "";
  let last = 0;
  for (const el of elements(html, name)) {
    out += html.slice(last, el.start) + " ";
    last = el.end;
  }
  return out + html.slice(last);
}

/** Remove every tag, keeping text; an unterminated "<" drops the rest. */
function stripTags(html, sep = "") {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) return out + html.slice(i);
    out += html.slice(i, lt) + sep;
    const gt = html.indexOf(">", lt);
    if (gt < 0) return out;
    i = gt + 1;
  }
  return out;
}

const cleanText = (html, sep = "") => decodeEntities(stripTags(html, sep)).replace(/\s+/g, " ").trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : null;
}

function metaContent(html, key, value) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, key) ?? "").toLowerCase() === value) return attr(tag, "content");
  }
  return null;
}

export function parsePage(html, pageUrl) {
  const head = elements(html, "head").next().value?.inner ?? html;
  const title = elements(head, "title").next().value?.inner;
  let canonical = null;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    if ((attr(tag, "rel") ?? "").toLowerCase() === "canonical") canonical = attr(tag, "href");
  }

  const jsonLd = [];
  let jsonLdErrors = 0;
  for (const el of elements(html, "script")) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(el.open)) continue;
    try {
      const parsed = JSON.parse(el.inner);
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) jsonLd.push(node?.["@type"] ?? "?");
    } catch {
      jsonLdErrors += 1;
    }
  }

  const bodyEl = elements(html, "body").next().value;
  const body = removeElements(removeElements(bodyEl ? bodyEl.inner : html, "script"), "style");
  const h1s = [...elements(body, "h1")].map((el) => cleanText(el.inner));
  const h2s = [...elements(body, "h2")].map((el) => cleanText(el.inner));
  const text = cleanText(body, " ");

  const origin = new URL(pageUrl).origin;
  const internalLinks = new Set();
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.origin === origin) internalLinks.add(u.pathname.replace(/(.)\/+$/, "$1"));
    } catch {
      /* ignore */
    }
  }

  return {
    title: title ? cleanText(title) || null : null,
    description: metaContent(head, "name", "description"),
    robots: metaContent(head, "name", "robots"),
    canonical,
    ogTitle: metaContent(head, "property", "og:title"),
    ogImage: metaContent(head, "property", "og:image"),
    h1s,
    h2s,
    jsonLd,
    jsonLdErrors,
    wordCount: text ? text.split(" ").length : 0,
    internalLinks: [...internalLinks].sort(),
  };
}

export function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
}

/** Paths blocked for `User-agent: *` (simple prefix rules; enough for our file). */
export function robotsDisallows(robotsTxt) {
  const out = [];
  let applies = false;
  for (const raw of robotsTxt.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*";
    else if (applies && /^disallow$/i.test(k) && v) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks. Each finding: { level: "error" | "warn", code, message }.
// Errors mean "Google may not index/understand this page" — the workflow
// fails on them. Warnings are things to weigh, not must-fix.
// ---------------------------------------------------------------------------

export const LIMITS = { titleMin: 15, titleMax: 65, descMin: 70, descMax: 160, thinWords: 150 };

/**
 * @param {{ url: string, status: number, headers?: Record<string, string>, page: any, disallows?: string[] }} input
 */
export function checkPage({ url, status, headers = {}, page, disallows = [] }) {
  const f = [];
  const err = (code, message) => f.push({ level: "error", code, message });
  const warn = (code, message) => f.push({ level: "warn", code, message });
  const path = new URL(url).pathname;

  if (status !== 200) {
    err("status", `returns HTTP ${status}`);
    return f;
  }
  if (disallows.some((d) => path.startsWith(d))) err("robots-blocked", `robots.txt blocks ${path}`);
  const xRobots = (headers["x-robots-tag"] ?? "").toLowerCase();
  if (xRobots.includes("noindex")) err("noindex", `X-Robots-Tag: ${xRobots}`);
  if ((page.robots ?? "").toLowerCase().includes("noindex")) err("noindex", `meta robots: ${page.robots}`);

  if (!page.title) err("title-missing", "no <title>");
  else if (page.title.length > LIMITS.titleMax) warn("title-long", `title is ${page.title.length} chars (Google shows ~${LIMITS.titleMax})`);
  else if (page.title.length < LIMITS.titleMin) warn("title-short", `title is ${page.title.length} chars`);

  if (!page.description) err("description-missing", "no meta description");
  else if (page.description.length > LIMITS.descMax) warn("description-long", `description is ${page.description.length} chars`);
  else if (page.description.length < LIMITS.descMin) warn("description-short", `description is ${page.description.length} chars`);

  if (!page.canonical) err("canonical-missing", "no canonical link");
  else if (page.canonical.replace(/\/$/, "") !== url.replace(/\/$/, "")) {
    err("canonical-mismatch", `canonical points to ${page.canonical}`);
  }

  if (page.h1s.length !== 1) warn("h1-count", `${page.h1s.length} <h1> elements`);
  if (!page.ogTitle || !page.ogImage) warn("og-missing", "og:title or og:image missing (link previews)");
  if (page.jsonLdErrors > 0) err("jsonld-invalid", `${page.jsonLdErrors} JSON-LD block(s) fail to parse`);
  if (page.wordCount < LIMITS.thinWords) warn("thin", `only ~${page.wordCount} words of text`);
  if (!page.internalLinks.some((l) => l.startsWith("/create"))) {
    warn("no-cta", "no link to /create — no obvious next step for a visitor");
  }
  return f;
}

/** Cross-page checks: duplicate titles/descriptions and pages nothing links to. */
export function checkSite(pages) {
  const f = [];
  const dupes = (field) => {
    const seen = new Map();
    for (const p of pages) {
      const v = p.page?.[field];
      if (!v) continue;
      seen.set(v, [...(seen.get(v) ?? []), p.path]);
    }
    for (const [v, paths] of seen) {
      if (paths.length > 1) f.push({ level: "warn", code: `duplicate-${field}`, message: `"${v}" on ${paths.join(", ")}` });
    }
  };
  dupes("title");
  dupes("description");

  const inbound = new Map(pages.map((p) => [p.path, 0]));
  for (const p of pages) {
    for (const l of p.page?.internalLinks ?? []) {
      if (l !== p.path && inbound.has(l)) inbound.set(l, inbound.get(l) + 1);
    }
  }
  for (const [path, n] of inbound) {
    if (path !== "/" && n === 0) f.push({ level: "warn", code: "orphan", message: `${path} has no internal links from other sitemap pages` });
  }
  return { findings: f, inbound: Object.fromEntries(inbound) };
}

// ---------------------------------------------------------------------------
// Search + conversions → one row per page, and the three calls from the
// playbook: candidate / trap / watch.
// ---------------------------------------------------------------------------

/** Rough organic CTR by position (industry curves; only used to size upside). */
export function expectedCtr(position) {
  const table = [0.28, 0.16, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.025, 0.02];
  if (!position || position < 1) return 0;
  if (position <= 10) return table[Math.round(position) - 1] ?? 0.02;
  if (position <= 20) return 0.01;
  return 0.003;
}

export const THRESHOLDS = { minImpressions: 50, trapImpressions: 200, strikeFrom: 4, strikeTo: 20, targetPosition: 3 };

/**
 * gscPages: [{ path, clicks, impressions, ctr, position }]
 * conversions: [{ landing, channel, count }]
 */
export function scorePages(gscPages, conversions, t = THRESHOLDS) {
  const conv = new Map();
  for (const r of conversions) {
    const c = conv.get(r.landing) ?? { all: 0, search: 0 };
    c.all += r.count;
    if (r.channel === "search") c.search += r.count;
    conv.set(r.landing, c);
  }
  const totalClicks = gscPages.reduce((s, p) => s + p.clicks, 0);
  const totalSearchConv = [...conv.values()].reduce((s, c) => s + c.search, 0);
  const siteRate = totalClicks > 0 ? totalSearchConv / totalClicks : null;

  const rows = gscPages.map((p) => {
    const c = conv.get(p.path) ?? { all: 0, search: 0 };
    const rate = p.clicks >= 20 ? c.search / p.clicks : siteRate;
    const upsideClicks = Math.max(0, p.impressions * (expectedCtr(t.targetPosition) - p.ctr));
    const upsideConversions = rate == null ? null : upsideClicks * rate;
    let call = "watch";
    let reason = "not enough impressions yet";
    if (p.impressions >= t.minImpressions) {
      if (c.all === 0 && p.impressions >= t.trapImpressions) {
        call = "trap";
        reason = "visible in search but no conversions — traffic nobody acts on";
      } else if (p.position >= t.strikeFrom && p.position <= t.strikeTo && c.all > 0) {
        call = "candidate";
        reason = `converts (${c.all}) and sits at position ${p.position.toFixed(1)} — a climb would pay`;
      } else if (p.position < t.strikeFrom) {
        reason = "already near the top — leave it alone unless something breaks";
      } else if (c.all === 0) {
        reason = "no conversions recorded yet";
      } else {
        reason = "too far down to move with one change";
      }
    }
    return {
      ...p,
      conversions: c.all,
      searchConversions: c.search,
      upsideClicks: Math.round(upsideClicks),
      upsideConversions: upsideConversions == null ? null : Math.round(upsideConversions * 10) / 10,
      call,
      reason,
    };
  });
  const order = { candidate: 0, trap: 1, watch: 2 };
  rows.sort(
    (a, b) =>
      order[a.call] - order[b.call] ||
      (b.upsideConversions ?? -1) - (a.upsideConversions ?? -1) ||
      b.impressions - a.impressions
  );
  return { rows, siteSearchConversionRate: siteRate };
}

/** Totals for a window of GSC day×page rows, grouped by path. */
export function aggregateGsc(dayPageRows) {
  const by = new Map();
  for (const r of dayPageRows) {
    const a = by.get(r.path) ?? { path: r.path, clicks: 0, impressions: 0, posWeighted: 0 };
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.posWeighted += r.position * r.impressions;
    by.set(r.path, a);
  }
  return [...by.values()].map((a) => ({
    path: a.path,
    clicks: a.clicks,
    impressions: a.impressions,
    ctr: a.impressions ? a.clicks / a.impressions : 0,
    position: a.impressions ? Math.round((a.posWeighted / a.impressions) * 10) / 10 : 0,
  }));
}

/** What changed since the previous snapshot: new/fixed findings and big search moves. */
export function diffSnapshots(prev, curr) {
  if (!prev) return { first: true, newFindings: [], fixedFindings: [], moves: [] };
  const key = (x) => `${x.path}|${x.code}`;
  const flat = (s) => (s.audit?.pages ?? []).flatMap((p) => p.findings.map((f) => ({ ...f, path: p.path })));
  const before = new Map(flat(prev).map((x) => [key(x), x]));
  const after = new Map(flat(curr).map((x) => [key(x), x]));
  const newFindings = [...after.values()].filter((x) => !before.has(key(x)));
  const fixedFindings = [...before.values()].filter((x) => !after.has(key(x)));

  const moves = [];
  const prevRows = new Map((prev.search?.pages ?? []).map((p) => [p.path, p]));
  for (const p of curr.search?.pages ?? []) {
    const q = prevRows.get(p.path);
    if (!q || p.impressions < THRESHOLDS.minImpressions) continue;
    const dPos = Math.round((p.position - q.position) * 10) / 10;
    if (Math.abs(dPos) >= 3) moves.push({ path: p.path, from: q.position, to: p.position, delta: dPos });
  }
  return { first: false, newFindings, fixedFindings, moves };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function renderReport(s) {
  const L = [];
  const errors = s.audit.pages.flatMap((p) => p.findings.filter((f) => f.level === "error").map((f) => ({ ...f, path: p.path })));
  const warns = s.audit.pages.flatMap((p) => p.findings.filter((f) => f.level === "warn").map((f) => ({ ...f, path: p.path })));

  L.push(`# SEO weekly check — ${s.date}`, "");
  L.push(`Site: ${s.siteUrl} · ${s.audit.pages.length} sitemap pages · search window ${s.search?.window ?? "n/a"}`, "");
  L.push("## Health", "");
  L.push(errors.length ? `**${errors.length} error(s)** — fix these first; they can stop pages being indexed.` : "No blocking errors.");
  L.push("");
  for (const e of errors) L.push(`- ❌ \`${e.path}\` ${e.message}`);
  if (s.diff && !s.diff.first) {
    if (s.diff.newFindings.length) {
      L.push("", "New since last week:");
      for (const x of s.diff.newFindings) L.push(`- 🆕 \`${x.path}\` ${x.message}`);
    }
    if (s.diff.fixedFindings.length) {
      L.push("", "Fixed since last week:");
      for (const x of s.diff.fixedFindings) L.push(`- ✅ \`${x.path}\` ${x.message}`);
    }
  }
  L.push("");

  L.push("## Search × conversions", "");
  if (!s.search) {
    L.push(`_Search Console data missing: ${s.missing.gsc}._ Candidate pages can't be picked without it — see seo/README.md → Setup.`, "");
  } else {
    if (!s.conversions) L.push(`_Conversion data missing: ${s.missing.conversions}._`, "");
    const rate = s.scored.siteSearchConversionRate;
    L.push(`Site-wide: ${s.search.totals.clicks} clicks, ${s.search.totals.impressions} impressions. Search → create rate: ${rate == null ? "n/a" : pct(rate)}.`, "");
    L.push("| Call | Page | Impr. | Clicks | CTR | Pos. | Conv. (search) | Upside conv./4wk | Why |", "|---|---|---:|---:|---:|---:|---:|---:|---|");
    for (const r of s.scored.rows.slice(0, 15)) {
      const icon = { candidate: "🎯", trap: "⚠️", watch: "·" }[r.call];
      L.push(
        `| ${icon} ${r.call} | \`${r.path}\` | ${r.impressions} | ${r.clicks} | ${pct(r.ctr)} | ${r.position} | ${r.conversions} (${r.searchConversions}) | ${r.upsideConversions ?? "n/a"} | ${r.reason} |`
      );
    }
    L.push("");
    if (s.diff?.moves?.length) {
      L.push("Position moves of 3+ places (ignore unless they persist 2+ weeks):", "");
      for (const m of s.diff.moves) L.push(`- \`${m.path}\` ${m.from} → ${m.to}`);
      L.push("");
    }
    const top = s.search.queries?.slice(0, 10) ?? [];
    if (top.length) {
      L.push("<details><summary>Top queries</summary>", "", "| Query | Page | Impr. | Clicks | Pos. |", "|---|---|---:|---:|---:|");
      for (const q of top) L.push(`| ${q.query} | \`${q.path}\` | ${q.impressions} | ${q.clicks} | ${q.position} |`);
      L.push("", "</details>", "");
    }
  }

  if (s.conversions) {
    const byChannel = {};
    for (const r of s.conversions.rows) byChannel[r.channel] = (byChannel[r.channel] ?? 0) + r.count;
    L.push(
      `Events created in the window by channel: ${Object.entries(byChannel).map(([k, v]) => `${k} ${v}`).join(" · ") || "none recorded yet"}.`,
      ""
    );
  }

  if (s.speed?.length) {
    L.push("## Mobile speed (PageSpeed Insights)", "", "| Page | Score | LCP | CLS | INP (field) |", "|---|---:|---:|---:|---:|");
    for (const p of s.speed) {
      if (p.error) L.push(`| \`${p.path}\` | error: ${p.error} | | | |`);
      else L.push(`| \`${p.path}\` | ${p.score} | ${p.lcp} | ${p.cls} | ${p.inp ?? "n/a"} |`);
    }
    L.push("");
  }

  L.push("<details><summary>" + `${warns.length} warning(s) + ${s.audit.site.length} site-wide note(s)` + "</summary>", "");
  for (const w of warns) L.push(`- \`${w.path}\` ${w.message}`);
  for (const w of s.audit.site) L.push(`- ${w.message}`);
  L.push("", "</details>", "");

  L.push("## This week's decision", "");
  L.push("Pick **one** change (or none) using the playbook in `seo/README.md`, then record it in `seo/LOG.md`.");
  L.push("Run `/seo-weekly` in Claude Code for a recommendation with sources.");
  return L.join("\n");
}
