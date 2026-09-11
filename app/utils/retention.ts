import { lt, inArray } from "drizzle-orm";
import { events, eventSlots, signups, pollVotes, pollVoteEntries } from "~/db";

/** Throwaway retention: events auto-expire this many days after creation. */
export const RETENTION_DAYS = 90;

export function expiryDateFor(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  d.setDate(d.getDate() + RETENTION_DAYS);
  return d.toISOString();
}

export function isExpired(createdAtIso: string, now = new Date()): boolean {
  return new Date(createdAtIso).getTime() + RETENTION_DAYS * 86400_000 < now.getTime();
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
  const ids = stale.map((r: { id: string }) => r.id as string);

  const slots = await db
    .select({ id: eventSlots.id })
    .from(eventSlots)
    .where(inArray(eventSlots.eventId, ids));
  const slotIds = slots.map((s: { id: string }) => s.id as string);

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
