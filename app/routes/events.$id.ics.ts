import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { eq } from "drizzle-orm";
import { getDb, events, eventSlots } from "~/db";
import { generateICS } from "~/utils/calendar";
import { getPresentedAdminToken, secretMatches } from "~/utils/auth";
import { isExpired, pruneExpiredEvents } from "~/utils/retention";

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database };
  const db = getDb(env.DB);
  const eventId = params.id;

  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  try {
    await pruneExpiredEvents(db);
  } catch {}

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw new Response("Event not found", { status: 404 });
  }
  if (isExpired(event.createdAt)) {
    throw new Response("This event expired and was auto-deleted.", { status: 410 });
  }

  // If there's a winning slot (for polls), use its times
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (event.winningSlotId) {
    const [winningSlot] = await db
      .select()
      .from(eventSlots)
      .where(eq(eventSlots.id, event.winningSlotId))
      .limit(1);
    if (winningSlot) {
      startTime = winningSlot.startTime;
      endTime = winningSlot.endTime;
    }
  }

  // Organizer email is only embedded for organizers; the public .ics omits it
  // so a shared calendar file doesn't leak the organizer's address.
  const presented = getPresentedAdminToken(request, eventId);
  const isAdmin = presented ? await secretMatches(presented, event.adminToken) : false;

  const icsContent = generateICS({
    uid: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startTime,
    endTime,
    organizerName: event.organizerName,
    organizerEmail: isAdmin ? event.organizerEmail : null,
  });

  return new Response(icsContent, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.ics"`,
      "Cache-Control": isAdmin ? "private, no-store" : "public, max-age=60",
      "Referrer-Policy": "no-referrer",
    },
  });
}
