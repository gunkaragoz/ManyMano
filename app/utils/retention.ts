import { lt, inArray, eq } from "drizzle-orm";
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

/**
 * Retention is measured from creation, except for sheets whose slots carry
 * their own dates (multi-day / repeating): those are measured from their LAST
 * date, so a series can't be deleted partway through. `lastSlotDate` is a
 * "YYYY-MM-DD" day; omit it and the behaviour is unchanged.
 */
function retentionAnchorMs(createdAtIso: string, lastSlotDate?: string | null): number {
  const created = new Date(createdAtIso).getTime();
  if (!lastSlotDate) return created;
  // End of that calendar day, so the last date itself is never cut short.
  const last = new Date(`${lastSlotDate}T23:59:59Z`).getTime();
  return Number.isNaN(last) ? created : Math.max(created, last);
}

export function expiryDateFor(
  createdAtIso: string,
  retentionDays: number = RETENTION_DAYS,
  lastSlotDate?: string | null
): string {
  const d = new Date(retentionAnchorMs(createdAtIso, lastSlotDate));
  d.setDate(d.getDate() + retentionDays);
  return d.toISOString();
}

export function isExpired(
  createdAtIso: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
  lastSlotDate?: string | null
): boolean {
  return (
    retentionAnchorMs(createdAtIso, lastSlotDate) + retentionDays * 86400_000 < now.getTime()
  );
}

/**
 * The last dated slot of an event ("YYYY-MM-DD"), or null when its slots carry
 * no dates. Only worth querying for an event that already looks expired by
 * creation date — see the call sites' guard.
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
  const candidateIds = stale.map((r: { id: string }) => r.id as string);

  const candidateSlots = await db
    .select({ id: eventSlots.id, eventId: eventSlots.eventId, slotDate: eventSlots.slotDate })
    .from(eventSlots)
    .where(inArray(eventSlots.eventId, candidateIds));

  // Keep a multi-day / repeating event alive while any of its dates is still
  // inside the retention window. Events with no dated slots (everything
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
