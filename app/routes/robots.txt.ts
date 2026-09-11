import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { DEFAULT_SITE_URL, absoluteUrl } from "~/utils/seo";

export async function loader({ request }: LoaderFunctionArgs) {
  const origin = (() => {
    try {
      return new URL(request.url).origin;
    } catch {
      return DEFAULT_SITE_URL;
    }
  })();
  // Canonical sitemap URL always points at production.
  const sitemapUrl = absoluteUrl("/sitemap.xml", DEFAULT_SITE_URL);
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
