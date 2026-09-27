import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { LoaderFunctionArgs } from "react-router";
import { absoluteUrl } from "~/utils/seo";
import { getSiteConfig } from "~/utils/site";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const origin = (() => {
    try {
      return new URL(request.url).origin;
    } catch {
      throw new Error("[config] robots.txt requires a valid request origin.");
    }
  })();
  // Canonical sitemap URL always points at production (SITE_URL). No fallback.
  const { siteUrl } = getSiteConfig(getCloudflareEnv(context));
  const sitemapUrl = absoluteUrl("/sitemap.xml", siteUrl);
  void origin;
  // Content Signals (https://contentsignals.org/): allow search indexing and
  // AI answers that cite us, opt out of model training.
  const body = [
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
    "Allow: /",
    "Disallow: /events/",
    "Disallow: /api/",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
