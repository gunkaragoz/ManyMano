import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { DEFAULT_SITE_URL, absoluteUrl } from "~/utils/seo";

type SitemapEntry = {
  path: string;
  changefreq: string;
  priority: string;
};

const ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/create", changefreq: "monthly", priority: "0.8" },
  { path: "/create/signup", changefreq: "monthly", priority: "0.9" },
  { path: "/create/poll", changefreq: "monthly", priority: "0.9" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  void request;
  const siteUrl = DEFAULT_SITE_URL;
  const today = new Date().toISOString().split("T")[0];
  const urls = ENTRIES.map(
    (e) => `  <url>
    <loc>${absoluteUrl(e.path, siteUrl)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
  ).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
