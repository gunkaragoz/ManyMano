import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { eq, and, inArray } from "drizzle-orm";
import { getDb, events, eventSlots, signups, pollVotes, pollVoteEntries } from "~/db";
import { getPresentedAdminToken, verifyAdminToken } from "~/utils/auth";
import { isExpired, latestSlotDate, pruneExpiredEvents } from "~/utils/retention";
import { effectiveDateForSlot } from "~/utils/calendar";

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
  if (isExpired(event.createdAt) && isExpired(event.createdAt, new Date(), await latestSlotDate(db, eventId))) {
    throw new Response("This event expired and was auto-deleted.", { status: 410 });
  }

  // CSV contains emails/notes — organizer only.
  const presented = getPresentedAdminToken(request, eventId);
  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  const allowed = await verifyAdminToken(presented, event.adminToken, `export:${clientIp}:${eventId}`);
  if (!allowed) {
    throw new Response("Unauthorized. This roster export requires the organizer link.", {
      status: 403,
    });
  }

  const rawSlots = await db
    .select()
    .from(eventSlots)
    .where(eq(eventSlots.eventId, eventId))
    .orderBy(eventSlots.displayOrder);
  // Match the voting grid: polls sort chronologically by day then time.
  const hasSlotDates = rawSlots.some((s) => (s as { slotDate?: string | null }).slotDate);
  const slots =
    event.type === "TIME_POLL" || hasSlotDates
      ? [...rawSlots].sort((a, b) => {
          const dateCmp = ((a as { slotDate?: string | null }).slotDate || "").localeCompare(
            (b as { slotDate?: string | null }).slotDate || ""
          );
          if (dateCmp !== 0) return dateCmp;
          const timeCmp = (a.startTime || "").localeCompare(b.startTime || "");
          if (timeCmp !== 0) return timeCmp;
          return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
        })
      : rawSlots;

  const slotMap = new Map(slots.map((s) => [s.id, s]));

  let csvRows: string[][] = [];

  if (event.type === "SIGNUP_SHEET") {
    csvRows.push(["Date", "Shift", "Task", "Name", "Email", "Notes/Comments", "Status", "Date Signed Up"]);
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

      const slot = slotMap.get(s.slotId);
      const shiftName = ((slot as { shiftName?: string | null } | undefined)?.shiftName || "").trim();
      const time = slot ? [slot.startTime, slot.endTime].filter(Boolean).join(" – ") : "";
      const shift = [shiftName, time].filter(Boolean).join(" | ");
      // Multi-day sheets: the slot's date; single-day sheets repeat the event
      // date, so every row still says which day it was for.
      const slotDate = slot ? effectiveDateForSlot(slot, event.eventDate) : event.eventDate;

      csvRows.push([
        slotDate || "",
        shift,
        slot?.title || "Unknown",
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
    const voteIds = votes.map((v) => v.id);
    // Scope entries to this event's votes only — never load the whole table.
    const entries =
      voteIds.length > 0
        ? await db
            .select()
            .from(pollVoteEntries)
            .where(inArray(pollVoteEntries.pollVoteId, voteIds))
        : [];

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

  // Neutralize CSV formula injection: prefix fields starting with
  // =,+,-,@ (after optional whitespace) so Excel/Sheets treat them as text.
  const sanitizeCsvCell = (val: unknown): string => {
    const s = String(val ?? "");
    const needsGuard = /^[ \t]*[=+\-@]/.test(s);
    const guarded = needsGuard ? `'${s}` : s;
    return `"${guarded.replace(/"/g, '""')}"`;
  };

  const csvString = csvRows.map((row) => row.map(sanitizeCsvCell).join(",")).join("\r\n");

  return new Response(csvString, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.title.replace(/[^a-zA-Z0-9_-]/g, "_")}_roster.csv"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
