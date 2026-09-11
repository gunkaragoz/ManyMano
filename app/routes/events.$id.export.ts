import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { eq, and } from "drizzle-orm";
import { getDb, events, eventSlots, signups, pollVotes, pollVoteEntries } from "~/db";

export async function loader({ params, request, context }: LoaderFunctionArgs) {
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

  const slots = await db
    .select()
    .from(eventSlots)
    .where(eq(eventSlots.eventId, eventId))
    .orderBy(eventSlots.displayOrder);

  const slotMap = new Map(slots.map((s) => [s.id, s.title]));

  let csvRows: string[][] = [];

  if (event.type === "SIGNUP_SHEET") {
    csvRows.push(["Slot / Role", "Volunteer Name", "Email", "Notes/Comments", "Status", "Date Signed Up"]);
    const eventSignups = await db
      .select()
      .from(signups)
      .where(and(eq(signups.eventId, eventId), eq(signups.status, "CONFIRMED")));

    for (const s of eventSignups) {
      let comment = "";
      try {
        const parsed = JSON.parse(s.customFields);
        comment = parsed.comment || "";
      } catch (_) {}

      csvRows.push([
        slotMap.get(s.slotId) || "Unknown",
        s.participantName,
        s.participantEmail || "",
        comment,
        s.status,
        s.createdAt,
      ]);
    }
  } else {
    // Poll export
    const header = ["Participant Name", "Email", ...slots.map((s) => s.title), "Submitted At"];
    csvRows.push(header);

    const votes = await db.select().from(pollVotes).where(eq(pollVotes.eventId, eventId));
    const entries = await db.select().from(pollVoteEntries);

    for (const v of votes) {
      const vEntries = entries.filter((e) => e.pollVoteId === v.id);
      const respMap = new Map(vEntries.map((e) => [e.slotId, e.response]));

      const row = [
        v.participantName,
        v.participantEmail || "",
        ...slots.map((s) => respMap.get(s.id) || "NO"),
        v.createdAt,
      ];
      csvRows.push(row);
    }
  }

  const csvString = csvRows
    .map((row) =>
      row
        .map((val) => `"${String(val).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\r\n");

  return new Response(csvString, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.title.replace(/[^a-zA-Z0-9_-]/g, "_")}_roster.csv"`,
    },
  });
}
