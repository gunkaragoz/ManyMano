import { lt, inArray } from "drizzle-orm";
import { events, eventSlots, signups, pollVotes, pollVoteEntries } from "~/db";

/** Default data retention: events expire this many days after creation. */
export const DEFAULT_RETENTION_DAYS = 365;

/**
 * Back-compat alias for the default (existing imports keep working).
 * Prefer resolveRetentionDays(env) at call sites so deploys can override
 * via the RETENTION_DAYS env var.
 */
export const RETENTION_DAYS = DEFAULT_RETENTION_DAYS;

/** Env keys for the retention override (optional — string like other worker vars). */
export interface RetentionEnv {
  RETENTION_DAYS?: string | number;
}

/**
 * Resolve the retention window: explicit RETENTION_DAYS wins, otherwise the
 * 365-day default. Non-numeric / non-positive values fall back to default
 * (fail-safe — never disables expiry or expires everything).
 */
export function resolveRetentionDays(env?: RetentionEnv): number {
  const raw = env?.RETENTION_DAYS;
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && (n as number) > 0 ? Math.floor(n as number) : DEFAULT_RETENTION_DAYS;
}

export function expiryDateFor(createdAtIso: string, retentionDays: number = RETENTION_DAYS): string {
  const d = new Date(createdAtIso);
  d.setDate(d.getDate() + retentionDays);
  return d.toISOString();
}

export function isExpired(
  createdAtIso: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS
): boolean {
  return new Date(createdAtIso).getTime() + retentionDays * 86400_000 < now.getTime();
}

function cutoffIso(now: Date = new Date(), retentionDays: number = RETENTION_DAYS): string {
  return new Date(now.getTime() - retentionDays * 86400_000).toISOString();
}

/**
 * Opportunistic pruning on every event read (cheap, keeps even
 * cron-less environments tidy; the hourly cron also covers it).
 * Called at the top of event loaders/actions and on creation.
 * Deletes children explicitly first for D1 FK safety, then parents.
 */
export async function pruneExpiredEvents(
  db: any,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS
): Promise<number> {
  const cutoff = cutoffIso(now, retentionDays);
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
