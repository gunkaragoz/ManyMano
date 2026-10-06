// Anonymous daily counters; views are page loads, clones are completed creations.
import { isbot } from "isbot";
import { getTemplate, TEMPLATES, templatePath, type EventTemplate } from "~/utils/templates";

export interface PopularTemplate {
  slug: string;
  name: string;
  path: string;
  type: EventTemplate["type"];
  views: number;
  clones: number;
  score: number;
}

export async function recordTemplateMetric(
  d1: D1Database,
  slug: string,
  metric: "view" | "clone",
  now = new Date()
): Promise<void> {
  if (!getTemplate(slug)) return;
  try {
    await d1.prepare(
      `INSERT INTO usage_counters (key, count, updated_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET count = count + 1, updated_at = ?2`
    ).bind(`tpl:${now.toISOString().slice(0, 10)}:${metric}:${slug}`, now.toISOString()).run();
  } catch {
    // Advisory only: tracking must not break browsing or creation.
  }
}

export async function recordTemplateView(d1: D1Database, slug: string, request: Request): Promise<void> {
  if (request.method !== "GET" || isbot(request.headers.get("user-agent") || "")) return;
  if (/prefetch/i.test(`${request.headers.get("purpose") || ""} ${request.headers.get("sec-purpose") || ""}`)) return;
  await recordTemplateMetric(d1, slug, "view");
}

export async function recordTemplateClone(d1: D1Database, type: EventTemplate["type"], form: FormData): Promise<void> {
  const slug = form.get("templateSlug");
  if (typeof slug !== "string" || getTemplate(slug)?.type !== type) return;
  await recordTemplateMetric(d1, slug, "clone");
}

export async function getPopularTemplates(d1: D1Database, days: number, now = new Date()): Promise<PopularTemplate[]> {
  const start = new Date(now.getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 86400_000).toISOString().slice(0, 10);
  try {
    const { results } = await d1.prepare(
      "SELECT key, count FROM usage_counters WHERE key >= ?1 AND key < ?2"
    ).bind(`tpl:${start}:`, `tpl:${end}:`).all<{ key: string; count: number }>();
    const counts = new Map<string, { views: number; clones: number }>();
    for (const row of results ?? []) {
      const match = /^tpl:\d{4}-\d{2}-\d{2}:(view|clone):([a-z0-9-]+)$/.exec(row.key);
      if (!match || !getTemplate(match[2]) || row.count <= 0) continue;
      const total = counts.get(match[2]) ?? { views: 0, clones: 0 };
      total[match[1] === "view" ? "views" : "clones"] += row.count;
      counts.set(match[2], total);
    }
    return TEMPLATES.flatMap((t) => {
      const total = counts.get(t.slug);
      return total ? [{ slug: t.slug, name: t.name, path: templatePath(t), type: t.type,
        ...total, score: total.views + total.clones }] : [];
    }).sort((a, b) => b.score - a.score || b.clones - a.clones || a.slug.localeCompare(b.slug)).slice(0, 6);
  } catch {
    return [];
  }
}
