import { beforeEach, describe, expect, it } from "vitest";
import { getPopularTemplates, recordTemplateClone, recordTemplateMetric, recordTemplateView } from "~/utils/template-popularity";
import { getPulseStats } from "~/utils/pulse";
import { TEMPLATES, templatePath } from "~/utils/templates";
import { loader as signupLoader } from "~/routes/signup-sheet.$slug";
import { routeContext, testEnv } from "./helpers/route-harness";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";

let db: SqliteD1;
const now = new Date("2026-10-05T12:00:00Z");
const a = TEMPLATES.find((t) => t.type === "SIGNUP_SHEET")!;
const b = TEMPLATES.find((t) => t.type === "TIME_POLL")!;
beforeEach(() => { db = createSqliteD1(); });

function form(slug: string) {
  const f = new FormData();
  f.set("templateSlug", slug);
  return f;
}

describe("template popularity", () => {
  it("ranks combined counts, breaks ties by clones, and exposes only catalog metadata", async () => {
    await recordTemplateMetric(db.d1, a.slug, "view", now);
    await recordTemplateMetric(db.d1, a.slug, "view", now);
    await recordTemplateMetric(db.d1, b.slug, "view", now);
    await recordTemplateMetric(db.d1, b.slug, "clone", now);
    const rows = await getPopularTemplates(db.d1, 7, now);
    expect(rows.map((r) => r.slug)).toEqual([b.slug, a.slug]);
    expect(rows[0]).toEqual({ slug: b.slug, name: b.name, path: templatePath(b), type: b.type, views: 1, clones: 1, score: 2 });
    expect((await getPulseStats(db.d1, 7, now)).popularTemplates).toEqual(rows);
  });

  it("uses UTC calendar windows including the first day and excludes future counts", async () => {
    await recordTemplateMetric(db.d1, a.slug, "view", new Date("2026-09-29T00:00:00Z"));
    await recordTemplateMetric(db.d1, a.slug, "view", new Date("2026-09-28T23:59:59Z"));
    await recordTemplateMetric(db.d1, a.slug, "view", new Date("2026-10-06T00:00:00Z"));
    expect((await getPopularTemplates(db.d1, 7, now))[0].views).toBe(1);
    expect((await getPopularTemplates(db.d1, 30, now))[0].views).toBe(2);
  });

  it("counts only real templates matching the creation flow", async () => {
    await recordTemplateClone(db.d1, a.type, form(a.slug));
    await recordTemplateClone(db.d1, a.type, form(b.slug));
    await recordTemplateClone(db.d1, a.type, form("unknown"));
    await recordTemplateClone(db.d1, a.type, new FormData());
    const rows = await getPopularTemplates(db.d1, 7);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: a.slug, clones: 1, views: 0 });
  });

  it("excludes bots, prefetches and non-GET requests", async () => {
    for (const request of [
      new Request("https://example.com", { headers: { "user-agent": "Googlebot" } }),
      new Request("https://example.com", { headers: { purpose: "prefetch" } }),
      new Request("https://example.com", { headers: { "sec-purpose": "prefetch;prerender" } }),
      new Request("https://example.com", { method: "HEAD" }),
    ]) await recordTemplateView(db.d1, a.slug, request);
    expect(await getPopularTemplates(db.d1, 7)).toEqual([]);
    await recordTemplateView(db.d1, a.slug, new Request("https://example.com", { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" } }));
    expect((await getPopularTemplates(db.d1, 7))[0].views).toBe(1);
  });

  it("records valid template route loads and does not count redirects or missing templates", async () => {
    const args = { request: new Request(`https://example.com${templatePath(a)}`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" } }), context: routeContext(testEnv(db)), params: { slug: a.slug } };
    await signupLoader(args as never);
    await expect(signupLoader({ ...args, params: { slug: b.slug } } as never)).rejects.toMatchObject({ status: 301 });
    await expect(signupLoader({ ...args, params: { slug: "missing" } } as never)).rejects.toMatchObject({ status: 404 });
    expect((await getPopularTemplates(db.d1, 7))[0]).toMatchObject({ slug: a.slug, views: 1 });
  });

  it("returns at most six templates and tolerates tracking outages", async () => {
    for (const t of TEMPLATES.slice(0, 8)) await recordTemplateMetric(db.d1, t.slug, "view", now);
    expect(await getPopularTemplates(db.d1, 7, now)).toHaveLength(6);
    db.failOn = /usage_counters/;
    await expect(recordTemplateMetric(db.d1, a.slug, "clone", now)).resolves.toBeUndefined();
    expect(await getPopularTemplates(db.d1, 7, now)).toEqual([]);
  });
});
