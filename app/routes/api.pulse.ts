import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { clampPulseDays, getPulseStats } from "~/utils/pulse";

// GET /api/pulse?days=7|30|90 — public aggregate stats, no PII.
// Same shape the /pulse page renders; Cache-Control mirrors /api/usage.

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers();
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return headers;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database };
  const days = clampPulseDays(new URL(request.url).searchParams.get("days"));
  let stats;
  try {
    stats = await getPulseStats(env.DB, days);
  } catch {
    return json({ error: "Stats temporarily unavailable." }, { status: 500 });
  }
  return json(stats, { headers: { "Cache-Control": "public, max-age=60" } });
}
