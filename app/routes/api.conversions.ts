import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { clampConversionDays, getConversions } from "~/utils/conversions";

// GET /api/conversions?days=28 — events created per UTC day, type, channel
// and landing page. Aggregate counts only, no PII (same stance as /api/pulse).
// Read by the weekly SEO check (scripts/seo/weekly.mjs) to line conversions
// up against Search Console, page by page.

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers();
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return headers;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getCloudflareEnv(context) as { DB: D1Database };
  const days = clampConversionDays(new URL(request.url).searchParams.get("days"));
  let rows;
  try {
    rows = await getConversions(env.DB, days);
  } catch {
    return data({ error: "Conversions temporarily unavailable." }, { status: 500 });
  }
  return data(
    { days, generatedAt: new Date().toISOString(), rows },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
