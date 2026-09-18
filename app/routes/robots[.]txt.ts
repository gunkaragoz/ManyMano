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
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /events/",
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
