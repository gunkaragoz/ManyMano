import { and, eq, gte, inArray, lt, ne, notExists, or, sql } from "drizzle-orm";
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
 * The last dated slot of a sign-up sheet ("YYYY-MM-DD"), or null when its
 * slots carry no dates. Only sheets get this: a meeting poll stores a date on
 * every option too, but a poll keeps the plain creation-based retention — a
 * far-future option must not keep it alive. Only worth querying for an event
 * that already looks expired by creation date — see the call sites' guard.
 */
export async function latestSlotDate(
  db: any,
  event: { id: string; type: string }
): Promise<string | null> {
  if (event.type !== "SIGNUP_SHEET") return null;
  const eventId = event.id;
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
  // A multi-day / repeating sign-up sheet stays alive while any of its dates is still
  // inside the retention window. That rule lives in the query rather than a
  // filter after it: otherwise 50 still-running series old enough to match
  // would fill every batch forever and hide the expired events behind them.
  // Events with no dated slots (everything created before multi-day existed)
  // are unaffected.
  const cutoffDay = cutoff.slice(0, 10);
  const stale = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        lt(events.createdAt, cutoff),
        // Sheets only: poll options are dated too, but polls expire by creation.
        or(
          ne(events.type, "SIGNUP_SHEET"),
          notExists(
          db
            .select({ one: sql`1` })
            .from(eventSlots)
            .where(and(eq(eventSlots.eventId, events.id), gte(eventSlots.slotDate, cutoffDay)))
          )
        )
      )
    )
    .limit(50);
  if (stale.length === 0) return 0;
  const ids = stale.map((r: { id: string }) => r.id as string);

  // Children are matched through subqueries on the (at most 50) event IDs, so
  // no statement binds one variable per slot — a year-long series has
  // hundreds, well past D1's 100-variable cap.
  const slotIdsOf = db.select({ id: eventSlots.id }).from(eventSlots).where(inArray(eventSlots.eventId, ids));
  const voteIdsOf = db.select({ id: pollVotes.id }).from(pollVotes).where(inArray(pollVotes.eventId, ids));
  await db.delete(signups).where(inArray(signups.slotId, slotIdsOf));
  await db.delete(pollVoteEntries).where(inArray(pollVoteEntries.slotId, slotIdsOf));
  // Signups/votes keyed only by event (defensive; slot deletes cover most).
  await db.delete(signups).where(inArray(signups.eventId, ids));
  await db.delete(pollVoteEntries).where(inArray(pollVoteEntries.pollVoteId, voteIdsOf));
  await db.delete(pollVotes).where(inArray(pollVotes.eventId, ids));
  await db.delete(eventSlots).where(inArray(eventSlots.eventId, ids));
  await db.delete(events).where(inArray(events.id, ids));
  return ids.length;
}
