// Guest-write policy for closed/past events: pure decisions, tested in
// tests/unit/guest-policy.test.ts. The events.$id action calls these and
// only handles DB IO, so the matrix (overnight shifts, all-day, admin
// bypass, reopen) is covered without mocking D1.

import {
  isEventClosed,
  isSlotClosed,
  isSlotPast,
  type ExpiryEventLike,
  type ExpirySlotLike,
} from "./event-expiry";

export interface CloseRejection {
  error: string;
  closed: true;
}

type SlotLike = Pick<ExpirySlotLike, "slotDate" | "startTime" | "endTime">;

/** Signup: null when allowed, otherwise the 410 payload for the modal. */
export function signupCloseRejection(args: {
  status: string;
  event: ExpiryEventLike;
  targetSlot: SlotLike;
  allSlots: SlotLike[];
  now?: Date;
}): CloseRejection | null {
  const now = args.now ?? new Date();
  if (
    args.status !== "CLOSED" &&
    !isSlotClosed(args.targetSlot, args.event.eventDate, args.event.timezone, now)
  ) {
    return null;
  }
  if (args.status === "CLOSED" || isEventClosed(args.event, args.allSlots, now)) {
    return { error: "Sign-ups are closed — this event already happened.", closed: true };
  }
  return { error: "That shift already started — sign-ups are closed.", closed: true };
}

/** Vote: rejection when nothing is votable left, else ids to coerce to NO. */
export function voteCloseState(args: {
  status: string;
  event: ExpiryEventLike;
  slots: ExpirySlotLike[];
  now?: Date;
}): { rejected: CloseRejection | null; closedIds: Set<string> } {
  const now = args.now ?? new Date();
  const closedIds = new Set(
    args.slots
      .filter((s) => isSlotClosed(s, args.event.eventDate, args.event.timezone, now))
      .map((s) => s.id)
  );
  if (args.status === "CLOSED" || isEventClosed(args.event, args.slots, now)) {
    return {
      rejected: { error: "Voting is closed — all proposed times have passed.", closed: true },
      closedIds,
    };
  }
  return { rejected: null, closedIds };
}

/**
 * Drop responses on closed options from a submitted vote matrix (stale
 * pages can't vote on passed options; history rows stay untouched).
 */
export function dropClosedResponses(
  responses: Map<string, string>,
  closedIds: Set<string>
): Map<string, string> {
  const kept = new Map<string, string>();
  for (const [slotId, resp] of responses) {
    if (closedIds.has(slotId)) continue;
    kept.set(slotId, resp);
  }
  return kept;
}

/**
 * Owner (non-admin) cancel of a signup: blocked once the shift happened.
 * Admins can still remove anyone (roster cleanup).
 */
export function ownerCancelBlocked(
  slot: SlotLike | null,
  event: ExpiryEventLike,
  now: Date = new Date()
): boolean {
  return (
    slot !== null && isSlotPast(slot, event.eventDate, event.timezone, now)
  );
}

/** Owner (non-admin) vote delete: blocked once voting closed. */
export function ownerDeleteVoteBlocked(
  event: ExpiryEventLike,
  slots: SlotLike[],
  now: Date = new Date()
): boolean {
  return isEventClosed(event, slots, now);
}

/**
 * Proposing a time: a manually closed poll stays shut; a poll whose options
 * all passed reopens through this action — but only for the organizer, so a
 * guest POST can't reopen anything.
 */
export function proposeCloseRejection(args: {
  status: string;
  event: ExpiryEventLike;
  slots: SlotLike[];
  isAdmin: boolean;
  now?: Date;
}): CloseRejection | null {
  const now = args.now ?? new Date();
  if (args.status === "CLOSED") {
    return { error: "This poll is closed — new times can't be proposed.", closed: true };
  }
  if (isEventClosed(args.event, args.slots, now) && !args.isAdmin) {
    return { error: "Voting is closed — only the organizer can add new times.", closed: true };
  }
  return null;
}
