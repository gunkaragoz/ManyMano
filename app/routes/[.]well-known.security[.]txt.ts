import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { LoaderFunctionArgs } from "react-router";
import { absoluteUrl } from "~/utils/seo";
import { getSiteConfig } from "~/utils/site";

// Serves /.well-known/security.txt dynamically so Contact/Canonical follow
// the site config (SECURITY_CONTACT override or derived default) / SITE_URL.
//
// NOTE: flat-routes escaping — `[.]` renders a literal dot, so this file
// maps to the `/.well-known/security.txt` path.
export async function loader({ context }: LoaderFunctionArgs) {
  const site = getSiteConfig(getCloudflareEnv(context));
  const canonical = absoluteUrl("/.well-known/security.txt", site.siteUrl);
  const body = [
    `# ${site.siteName} security policy — responsible disclosure appreciated.`,
    `Contact: ${site.securityContact}`,
    "Expires: 2027-09-12T00:00:00.000Z",
    "Preferred-Languages: en",
    `Canonical: ${canonical}`,
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
