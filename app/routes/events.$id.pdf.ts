import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { LoaderFunctionArgs } from "react-router";
import { eq, and } from "drizzle-orm";
import { getDb, events, eventSlots, signups } from "~/db";
import { getPresentedAdminToken, verifyAdminToken } from "~/utils/auth";
import {
  isExpired,
  latestSlotDate,
  resolveRetentionDays,
  withConcurrentPrune,
} from "~/utils/retention";
import { getSiteConfig } from "~/utils/site";
import { buildSignupReportHtml } from "~/utils/signup-report";

// Printable signup list for organizers (the roster's "Download PDF"). The
// page opens the print dialog; "Save as PDF" writes the file.
export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = getCloudflareEnv(context);
  const site = getSiteConfig(env);
  const db = getDb((env as { DB: D1Database }).DB);
  const eventId = params.id;

  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  const retentionDays = resolveRetentionDays(env);
  const [event] = await withConcurrentPrune(
    db,
    retentionDays,
    db.select().from(events).where(eq(events.id, eventId)).limit(1)
  );
  if (!event) {
    throw new Response("Event not found", { status: 404 });
  }
  if (
    isExpired(event.createdAt, new Date(), retentionDays) &&
    isExpired(event.createdAt, new Date(), retentionDays, await latestSlotDate(db, event))
  ) {
    throw new Response("This event expired and was auto-deleted.", { status: 410 });
  }
  if (event.type !== "SIGNUP_SHEET") {
    throw new Response("PDF export is available for signup sheets.", { status: 404 });
  }

  // Names, emails and comments — organizer only, same gate as the CSV.
  const presented = getPresentedAdminToken(request, eventId);
  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  const allowed = await verifyAdminToken(presented, event.adminToken, `export:${clientIp}:${eventId}`);
  if (!allowed) {
    throw new Response("Unauthorized. This export requires the organizer link.", {
      status: 403,
    });
  }

  const [slots, eventSignups] = await Promise.all([
    db.select().from(eventSlots).where(eq(eventSlots.eventId, eventId)).orderBy(eventSlots.displayOrder),
    db
      .select()
      .from(signups)
      .where(and(eq(signups.eventId, eventId), eq(signups.status, "CONFIRMED"))),
  ]);

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const origin = new URL(request.url).origin;
  const html = buildSignupReportHtml({
    event,
    slots,
    signups: eventSignups,
    siteName: site.siteName,
    eventUrl: `${origin}/events/${eventId}`,
    nonce,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
    },
  });
}
