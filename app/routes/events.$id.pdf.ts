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
import { reportFileName } from "~/utils/signup-report";

// Signup list as a US Letter PDF for organizers (the roster's "Download PDF").
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

  // pdf-lib + the embedded fonts load only when someone downloads a PDF.
  const { buildSignupPdf } = await import("~/utils/signup-pdf");
  const origin = new URL(request.url).origin;
  const pdf = await buildSignupPdf({
    event,
    slots,
    signups: eventSignups,
    siteName: site.siteName,
    eventUrl: `${origin}/events/${eventId}`,
  });

  return new Response(pdf as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFileName(event.title)}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
