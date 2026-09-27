import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { LoaderFunctionArgs } from "react-router";
import { getSiteConfig } from "~/utils/site";
import { isMcpEnabled, mcpCatalogEntry } from "~/utils/mcp-discovery";

// Serves /.well-known/ai-catalog.json (ARD spec 1.0) so agent-discoverability
// scanners (e.g. PageSpeed) get valid JSON instead of the HTML 404 page.
//
// NOTE: flat-routes escaping — `[.]` renders a literal dot, so this file
// maps to the `/.well-known/ai-catalog.json` path.
//
// Lists the MCP server (inline server card) only while MCP_ENABLED is
// "true"; otherwise `entries` is an empty array (schema-valid).
export async function loader({ context }: LoaderFunctionArgs) {
  const env = getCloudflareEnv(context);
  const site = getSiteConfig(env);
  const body = {
    specVersion: "1.0",
    host: {
      displayName: site.siteName,
      documentationUrl: site.siteUrl,
    },
    entries: isMcpEnabled(env) ? [mcpCatalogEntry(site)] : [],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
