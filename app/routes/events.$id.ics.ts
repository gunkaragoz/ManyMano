import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { eq } from "drizzle-orm";
import { getDb, events, eventSlots } from "~/db";
import { generateICS } from "~/utils/calendar";

export async function loader({ params, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database };
  const db = getDb(env.DB);
  const eventId = params.id;

  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw new Response("Event not found", { status: 404 });
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

  const icsContent = generateICS({
    uid: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startTime,
    endTime,
    organizerName: event.organizerName,
    organizerEmail: event.organizerEmail,
  });

  return new Response(icsContent, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.ics"`,
    },
  });
}
