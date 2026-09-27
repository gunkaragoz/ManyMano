import { describe, expect, it } from "vitest";
import * as seo from "../../scripts/seo/lib.mjs";

const URL_ = "https://example.test/signup-sheet/potluck";

const goodHtml = `<!doctype html><html><head>
<title>Free Potluck Sign-Up Sheet — Who Brings What | Example</title>
<meta name="description" content="A free potluck sign-up sheet: list the dishes, share the link, and everyone claims what they'll bring. No accounts, no ads."/>
<link rel="canonical" href="${URL_}"/>
<meta property="og:title" content="Potluck"/><meta property="og:image" content="https://example.test/og.png"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
</head><body><h1>Potluck sign-up sheet</h1><h2>How it works</h2>
<p>${"word ".repeat(200)}</p>
<a href="/create/signup?template=potluck">Use this template</a><a href="/templates">All</a><a href="https://other.test/">x</a>
</body></html>`;

describe("parsePage", () => {
  it("reads the tags the checks rely on", () => {
    const p = seo.parsePage(goodHtml, URL_);
    expect(p.title).toMatch(/^Free Potluck/);
    expect(p.canonical).toBe(URL_);
    expect(p.h1s).toEqual(["Potluck sign-up sheet"]);
    expect(p.h2s).toEqual(["How it works"]);
    expect(p.jsonLd).toEqual(["BreadcrumbList"]);
    expect(p.internalLinks).toEqual(["/create/signup", "/templates"]);
    expect(p.wordCount).toBeGreaterThan(200);
  });
});

describe("checkPage", () => {
  const page = seo.parsePage(goodHtml, URL_);

  it("passes a healthy page", () => {
    expect(seo.checkPage({ url: URL_, status: 200, page })).toEqual([]);
  });

  it("flags blocking problems as errors", () => {
    const bad = seo.parsePage(
      goodHtml
        .replace(`href="${URL_}"`, `href="https://example.test/"`)
        .replace("</head>", '<meta name="robots" content="noindex"/><script type="application/ld+json">{oops</script></head>'),
      URL_
    );
    const codes = seo.checkPage({ url: URL_, status: 200, page: bad }).filter((f: { level: string }) => f.level === "error").map((f: { code: string }) => f.code);
    expect(codes.sort()).toEqual(["canonical-mismatch", "jsonld-invalid", "noindex"]);
    expect(seo.checkPage({ url: URL_, status: 404, page: null })[0].code).toBe("status");
    expect(seo.checkPage({ url: URL_, status: 200, page, disallows: ["/signup-sheet/"] })[0].code).toBe("robots-blocked");
  });

  it("warns when there is no path to /create", () => {
    const noCta = seo.parsePage(goodHtml.replace('href="/create/signup?template=potluck"', 'href="/about"'), URL_);
    expect(seo.checkPage({ url: URL_, status: 200, page: noCta }).map((f: { code: string }) => f.code)).toContain("no-cta");
  });
});

describe("checkSite", () => {
  it("finds duplicate titles and orphans", () => {
    const mk = (path: string, title: string, links: string[]) => ({ path, page: { title, description: path, internalLinks: links } });
    const { findings, inbound } = seo.checkSite([mk("/", "A", ["/a"]), mk("/a", "Same", []), mk("/b", "Same", [])]);
    expect(findings.map((f: { code: string }) => f.code).sort()).toEqual(["duplicate-title", "orphan"]);
    expect(inbound).toEqual({ "/": 0, "/a": 1, "/b": 0 });
  });
});

describe("robots + sitemap parsing", () => {
  it("reads disallow rules for * only", () => {
    expect(seo.robotsDisallows("User-agent: bad\nDisallow: /\n\nUser-agent: *\nAllow: /\nDisallow: /events/\nDisallow: /api/\n")).toEqual([
      "/events/",
      "/api/",
    ]);
    expect(seo.parseSitemap("<urlset><url><loc>https://x.test/</loc></url><url><loc> https://x.test/a </loc></url></urlset>")).toEqual([
      "https://x.test/",
      "https://x.test/a",
    ]);
  });
});

describe("scorePages", () => {
  const gsc = [
    { path: "/signup-sheet/potluck", clicks: 40, impressions: 2000, ctr: 0.02, position: 8.2 },
    { path: "/templates", clicks: 5, impressions: 1500, ctr: 0.0033, position: 12 },
    { path: "/", clicks: 300, impressions: 3000, ctr: 0.1, position: 2.1 },
    { path: "/meeting-poll/x", clicks: 0, impressions: 10, ctr: 0, position: 30 },
  ];
  const conv = [
    { landing: "/signup-sheet/potluck", channel: "search", count: 6 },
    { landing: "/signup-sheet/potluck", channel: "direct", count: 2 },
    { landing: "/", channel: "search", count: 20 },
  ];

  it("makes the three calls from the playbook", () => {
    const { rows } = seo.scorePages(gsc, conv);
    const call = Object.fromEntries(rows.map((r: { path: string; call: string }) => [r.path, r.call]));
    expect(call).toEqual({
      "/signup-sheet/potluck": "candidate",
      "/templates": "trap",
      "/": "watch",
      "/meeting-poll/x": "watch",
    });
    expect(rows[0].path).toBe("/signup-sheet/potluck");
    expect(rows[0].conversions).toBe(8);
    expect(rows[0].searchConversions).toBe(6);
    expect(rows[0].upsideConversions).toBeGreaterThan(0);
  });

  it("reports n/a upside when there is no conversion data at all", () => {
    const { rows, siteSearchConversionRate } = seo.scorePages([{ ...gsc[0], clicks: 0 }], []);
    expect(siteSearchConversionRate).toBeNull();
    expect(rows[0].upsideConversions).toBeNull();
  });
});

describe("aggregateGsc + diffSnapshots", () => {
  it("weights position by impressions", () => {
    const [row] = seo.aggregateGsc([
      { date: "d1", path: "/a", clicks: 1, impressions: 100, position: 10 },
      { date: "d2", path: "/a", clicks: 3, impressions: 300, position: 6 },
    ]);
    expect(row).toEqual({ path: "/a", clicks: 4, impressions: 400, ctr: 0.01, position: 7 });
  });

  it("reports new and fixed findings and large moves", () => {
    const snap = (findings: object[], position: number) => ({
      audit: { pages: [{ path: "/a", findings }] },
      search: { pages: [{ path: "/a", impressions: 500, position }] },
    });
    const d = seo.diffSnapshots(snap([{ code: "thin", message: "thin" }], 12), snap([{ code: "no-cta", message: "cta" }], 7));
    expect(d.newFindings.map((f: { code: string }) => f.code)).toEqual(["no-cta"]);
    expect(d.fixedFindings.map((f: { code: string }) => f.code)).toEqual(["thin"]);
    expect(d.moves).toEqual([{ path: "/a", from: 12, to: 7, delta: -5 }]);
    expect(seo.diffSnapshots(null, snap([], 1)).first).toBe(true);
  });
});
