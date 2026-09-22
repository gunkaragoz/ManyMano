import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { LoaderFunctionArgs } from "react-router";
import { getSiteConfig } from "~/utils/site";

// Serves /.well-known/ai-catalog.json (ARD spec 1.0) so agent-discoverability
// scanners (e.g. PageSpeed) get valid JSON instead of the HTML 404 page.
//
// NOTE: flat-routes escaping — `[.]` renders a literal dot, so this file
// maps to the `/.well-known/ai-catalog.json` path.
//
// ManyMano currently exposes no MCP / A2A capabilities, so `entries` is an
// empty array (schema-valid). When an MCP is added, append one entry per
// server card (identifier urn:air:..., displayName, type, url/data).
export async function loader({ context }: LoaderFunctionArgs) {
  const site = getSiteConfig(getCloudflareEnv(context));
  const body = {
    specVersion: "1.0",
    host: {
      displayName: site.siteName,
      documentationUrl: site.siteUrl,
    },
    entries: [],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
