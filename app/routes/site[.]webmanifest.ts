import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { LoaderFunctionArgs } from "react-router";
import { getSiteConfig } from "~/utils/site";

// Serves /site.webmanifest dynamically so PWA name/description follow
// SITE_NAME / SITE_TAGLINE. No hardcoded brand fallback.
export async function loader({ context }: LoaderFunctionArgs) {
  const site = getSiteConfig(getCloudflareEnv(context));
  const manifest = {
    name: site.siteName,
    short_name: site.siteName,
    description: site.siteTagline,
    start_url: "/",
    display: "standalone",
    background_color: "#fafafc",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
