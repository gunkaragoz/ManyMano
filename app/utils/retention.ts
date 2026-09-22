import { lt, inArray, eq } from "drizzle-orm";
import { events, eventSlots, signups, pollVotes, pollVoteEntries } from "~/db";

/** Data retention: events expire this many days after creation. */
export const RETENTION_DAYS = 90;

/**
 * Retention is measured from creation, except for sheets whose slots carry
 * their own dates (multi-day / repeating): those survive until 90 days after
 * their LAST date, so a school-year series isn't deleted halfway through.
 * `lastSlotDate` is a "YYYY-MM-DD" day; omit it and behaviour is unchanged.
 */
function retentionAnchorMs(createdAtIso: string, lastSlotDate?: string | null): number {
  const created = new Date(createdAtIso).getTime();
  if (!lastSlotDate) return created;
  // End of that calendar day, so the last date itself is never cut short.
  const last = new Date(`${lastSlotDate}T23:59:59Z`).getTime();
  return Number.isNaN(last) ? created : Math.max(created, last);
}

export function expiryDateFor(createdAtIso: string, lastSlotDate?: string | null): string {
  const d = new Date(retentionAnchorMs(createdAtIso, lastSlotDate));
  d.setDate(d.getDate() + RETENTION_DAYS);
  return d.toISOString();
}

export function isExpired(
  createdAtIso: string,
  now = new Date(),
  lastSlotDate?: string | null
): boolean {
  return retentionAnchorMs(createdAtIso, lastSlotDate) + RETENTION_DAYS * 86400_000 < now.getTime();
}

/**
 * The last dated slot of an event ("YYYY-MM-DD"), or null when its slots
 * carry no dates. Only worth querying for an event that already looks expired
 * by creation date — see the call sites' guard.
 */
export async function latestSlotDate(db: any, eventId: string): Promise<string | null> {
  const rows = await db
    .select({ slotDate: eventSlots.slotDate })
    .from(eventSlots)
    .where(eq(eventSlots.eventId, eventId));
  let latest: string | null = null;
  for (const r of rows as Array<{ slotDate: string | null }>) {
    if (r.slotDate && (!latest || r.slotDate > latest)) latest = r.slotDate;
  }
  return latest;
}

function cutoffIso(now = new Date()): string {
  return new Date(now.getTime() - RETENTION_DAYS * 86400_000).toISOString();
}

/**
 * Opportunistic pruning for hosts without cron (Pages/Workers free tier).
 * Called at the top of event loaders/actions and on creation.
 * Deletes children explicitly first for D1 FK safety, then parents.
 */
export async function pruneExpiredEvents(db: any, now = new Date()): Promise<number> {
  const cutoff = cutoffIso(now);
  const stale = await db
    .select({ id: events.id })
    .from(events)
    .where(lt(events.createdAt, cutoff))
    .limit(50);
  if (stale.length === 0) return 0;
  const candidateIds = stale.map((r: { id: string }) => r.id as string);

  const candidateSlots = await db
    .select({ id: eventSlots.id, eventId: eventSlots.eventId, slotDate: eventSlots.slotDate })
    .from(eventSlots)
    .where(inArray(eventSlots.eventId, candidateIds));

  // Keep a multi-day/repeating event alive while any of its dates is still
  // inside the retention window. Events with no dated slots (every event
  // created before multi-day existed) are unaffected.
  const cutoffDay = cutoff.slice(0, 10);
  const stillLive = new Set<string>(
    candidateSlots
      .filter((s: { slotDate: string | null }) => s.slotDate && s.slotDate >= cutoffDay)
      .map((s: { eventId: string }) => s.eventId)
  );
  const ids = candidateIds.filter((id: string) => !stillLive.has(id));
  if (ids.length === 0) return 0;

  const slotIds = candidateSlots
    .filter((s: { eventId: string }) => ids.includes(s.eventId))
    .map((s: { id: string }) => s.id as string);

  const votes = await db
    .select({ id: pollVotes.id })
    .from(pollVotes)
    .where(inArray(pollVotes.eventId, ids));
  const voteIds = votes.map((v: { id: string }) => v.id as string);

  if (slotIds.length > 0) {
    await db.delete(signups).where(inArray(signups.slotId, slotIds));
    await db.delete(pollVoteEntries).where(inArray(pollVoteEntries.slotId, slotIds));
  }
  // Signups/votes keyed only by event (defensive; slot deletes cover most).
  await db.delete(signups).where(inArray(signups.eventId, ids));
  if (voteIds.length > 0) {
    await db.delete(pollVoteEntries).where(inArray(pollVoteEntries.pollVoteId, voteIds));
  }
  await db.delete(pollVotes).where(inArray(pollVotes.eventId, ids));
  await db.delete(eventSlots).where(inArray(eventSlots.eventId, ids));
  await db.delete(events).where(inArray(events.id, ids));
  return ids.length;
}
