// Public event summary for agents (MCP get_event). An explicit allowlist:
// no names, emails, tokens, comments or raw rows — only what anyone with
// the public link can already see, with counts instead of people.
// Read-only: never prunes or writes.

import { isEventClosed } from "./event-expiry";
import { isExpired, latestSlotDate } from "./retention";
import { MAX_SLOT_ROWS_PER_EVENT } from "./validation";
import { getDb } from "~/db";

export interface PublicSlotSummary {
  id: string;
  title: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface PublicEventSummary {
  eventId: string;
  publicUrl: string;
  type: "signup_sheet" | "poll";
  title: string;
  location: string | null;
  date: string | null;
  timezone: string;
  status: "open" | "closed" | "finalized";
  durationMinutes?: number | null;
  winningOptionId?: string | null;
  slots?: Array<PublicSlotSummary & { capacity: number | null; filled: number }>;
  options?: Array<PublicSlotSummary & { yes: number; maybe: number; no: number }>;
}

export type ReadResult =
  | { ok: true; summary: PublicEventSummary }
  | { ok: false; error: string };

interface EventRow {
  id: string;
  type: string;
  title: string;
  location: string | null;
  event_date: string | null;
  timezone: string;
  status: string;
  duration_minutes: number | null;
  winning_slot_id: string | null;
  created_at: string;
}

interface SlotRow {
  id: string;
  title: string;
  slot_date: string | null;
  start_time: string | null;
  end_time: string | null;
  capacity: number;
  display_order: number;
}

const NOT_FOUND = "No event with that ID (it may have been deleted or expired).";

export async function readPublicEvent(
  d1: D1Database,
  eventId: string,
  opts: { siteUrl: string; retentionDays: number; now?: Date }
): Promise<ReadResult> {
  const now = opts.now ?? new Date();
  const event = await d1
    .prepare(
      `SELECT id, type, title, location, event_date, timezone, status, duration_minutes, winning_slot_id, created_at
       FROM events WHERE id = ?1`
    )
    .bind(eventId)
    .first<EventRow>();
  if (!event) return { ok: false, error: NOT_FOUND };

  const slotRows = await d1
    .prepare(
      `SELECT id, title, slot_date, start_time, end_time, capacity, display_order
       FROM event_slots WHERE event_id = ?1 ORDER BY display_order LIMIT ?2`
    )
    .bind(eventId, MAX_SLOT_ROWS_PER_EVENT + 1)
    .all<SlotRow>();
  const slots = slotRows.results ?? [];
  if (slots.length > MAX_SLOT_ROWS_PER_EVENT) {
    return { ok: false, error: "This event is too large to summarize here. Open its public link instead." };
  }

  // Same retention rule as the event page: sheets live until their last day.
  if (isExpired(event.created_at, now, opts.retentionDays)) {
    const last = await latestSlotDate(getDb(d1), { id: event.id, type: event.type });
    if (isExpired(event.created_at, now, opts.retentionDays, last)) return { ok: false, error: NOT_FOUND };
  }

  const expirySlots = slots.map((s) => ({ slotDate: s.slot_date, startTime: s.start_time, endTime: s.end_time }));
  const closed =
    event.status === "CLOSED" ||
    isEventClosed({ eventDate: event.event_date, timezone: event.timezone }, expirySlots, now);
  const status: PublicEventSummary["status"] =
    event.status === "FINALIZED" ? "finalized" : closed ? "closed" : "open";

  const base = (s: SlotRow): PublicSlotSummary => ({
    id: s.id,
    title: s.title,
    date: s.slot_date,
    startTime: s.start_time,
    endTime: s.end_time,
  });
  const summary: PublicEventSummary = {
    eventId: event.id,
    publicUrl: `${opts.siteUrl}/events/${event.id}`,
    type: event.type === "TIME_POLL" ? "poll" : "signup_sheet",
    title: event.title,
    location: event.location,
    date: event.event_date,
    timezone: event.timezone,
    status,
  };

  if (event.type === "TIME_POLL") {
    const tallies = await d1
      .prepare(
        `SELECT e.slot_id AS slot_id, e.response AS response, COUNT(*) AS n
         FROM poll_vote_entries e JOIN poll_votes v ON v.id = e.poll_vote_id
         WHERE v.event_id = ?1
         GROUP BY e.slot_id, e.response`
      )
      .bind(eventId)
      .all<{ slot_id: string; response: string; n: number }>();
    const bySlot = new Map<string, { yes: number; maybe: number; no: number }>();
    for (const t of tallies.results ?? []) {
      const c = bySlot.get(t.slot_id) ?? { yes: 0, maybe: 0, no: 0 };
      if (t.response === "YES") c.yes += t.n;
      else if (t.response === "MAYBE") c.maybe += t.n;
      else if (t.response === "NO") c.no += t.n;
      bySlot.set(t.slot_id, c);
    }
    // Chronological, like the poll page.
    const ordered = [...slots].sort(
      (a, b) =>
        (a.slot_date || "").localeCompare(b.slot_date || "") ||
        (a.start_time || "").localeCompare(b.start_time || "") ||
        a.display_order - b.display_order
    );
    summary.durationMinutes = event.duration_minutes;
    summary.winningOptionId = event.winning_slot_id;
    summary.options = ordered.map((s) => ({ ...base(s), ...(bySlot.get(s.id) ?? { yes: 0, maybe: 0, no: 0 }) }));
  } else {
    const counts = await d1
      .prepare(
        `SELECT slot_id, COUNT(*) AS n FROM signups
         WHERE event_id = ?1 AND status = 'CONFIRMED'
         GROUP BY slot_id`
      )
      .bind(eventId)
      .all<{ slot_id: string; n: number }>();
    const filled = new Map((counts.results ?? []).map((c) => [c.slot_id, c.n]));
    summary.slots = slots.map((s) => ({
      ...base(s),
      // capacity <= 0 means unlimited on web-made sheets.
      capacity: s.capacity > 0 ? s.capacity : null,
      filled: filled.get(s.id) ?? 0,
    }));
  }

  return { ok: true, summary };
}
