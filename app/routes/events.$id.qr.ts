import type { LoaderFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { getDb, events } from "~/db";
import { isExpired, pruneExpiredEvents } from "~/utils/retention";
import { getSiteConfig } from "~/utils/site";
import { escapeHtml } from "~/utils/sanitize";
import { eventQrValue, qrPngBytes, qrSvgString } from "~/utils/qr";

// GET /events/:id/qr — titled QR page for the event (tab shows
// "Event Title | SiteName", like the event page). `?format=png` /
// `?format=svg` return the raw image for <img> embeds and emails.
// Public + long-cacheable: the QR encodes the unlisted event URL itself,
// so no auth and no PII involved.
export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;
  const site = getSiteConfig(env);
  const db = getDb((env as { DB: D1Database }).DB);
  const eventId = params.id;

  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  try {
    await pruneExpiredEvents(db);
  } catch {}

  const [event] = await db
    .select({ id: events.id, title: events.title, createdAt: events.createdAt })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) {
    throw new Response("Event not found", { status: 404 });
  }
  if (isExpired(event.createdAt)) {
    throw new Response("This event expired and was auto-deleted.", { status: 410 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const value = eventQrValue(eventId, url.origin);
  const rawTitle = (event.title || "Untitled event").trim() || "Untitled event";
  const pageTitle = `${rawTitle} | ${site.siteName}`.slice(0, 70);
  const fileBase = event.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || `event-${eventId}`;

  try {
    if (format === "svg") {
      const svg = await qrSvgString(value);
      return new Response(svg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Disposition": `inline; filename="${fileBase}-qr.svg"`,
          "Cache-Control": "public, max-age=86400",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (format === "png") {
      const png = await qrPngBytes(value);
      return new Response(png as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `inline; filename="${fileBase}-qr.png"`,
          "Cache-Control": "public, max-age=86400",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    const publicUrl = `${url.origin}/events/${eventId}`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(pageTitle)}</title>
</head>
<body style="margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f1f5f9; font-family: sans-serif; padding: 24px; box-sizing: border-box;">
<main style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 24px; padding: 32px; max-width: 420px; width: 100%; text-align: center; box-sizing: border-box;">
<h1 style="margin: 0 0 4px 0; font-size: 20px; color: #0f172a;">${escapeHtml(rawTitle)}</h1>
<p style="margin: 0 0 20px 0; font-size: 13px; color: #64748b;">Scan to open this event</p>
<a href="${escapeHtml(publicUrl)}"><img src="${escapeHtml(publicUrl)}/qr?format=png" alt="QR code for ${escapeHtml(rawTitle)}" width="300" height="300" onerror="this.style.display='none'" style="width: 100%; max-width: 300px; height: auto; border: 1px solid #e2e8f0; border-radius: 16px; padding: 8px; background: #ffffff; box-sizing: border-box;"></a>
<p style="margin: 20px 0 0 0; font-size: 13px; color: #334155; overflow-wrap: anywhere;"><a href="${escapeHtml(publicUrl)}" style="color: #2563eb;">${escapeHtml(publicUrl)}</a></p>
</main>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    throw new Response("Could not generate QR code.", { status: 500 });
  }
}
