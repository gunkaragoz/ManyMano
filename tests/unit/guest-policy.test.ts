import { describe, expect, it } from "vitest";
import {
  dropClosedResponses,
  ownerCancelBlocked,
  ownerDeleteVoteBlocked,
  proposeCloseRejection,
  signupCloseRejection,
  voteCloseState,
} from "~/utils/guest-policy";

const TZ = "UTC";
const EVENT = { eventDate: "2026-10-17", timezone: TZ };

function slot(id: string, slotDate: string | null, startTime: string | null, endTime: string | null) {
  return { id, slotDate, startTime, endTime };
}

describe("signup close policy", () => {
  const open = [slot("a", "2026-10-17", "10:00", "12:00")];

  it("allows open slots", () => {
    expect(
      signupCloseRejection({
        status: "OPEN",
        event: EVENT,
        targetSlot: open[0],
        allSlots: open,
        now: new Date("2026-10-17T09:00:00Z"),
      })
    ).toBeNull();
  });

  it("rejects a started shift while the event runs on", () => {
    const slots = [
      slot("a", "2026-10-17", "10:00", "11:00"),
      slot("b", "2026-10-18", "10:00", "11:00"),
    ];
    expect(
      signupCloseRejection({
        status: "OPEN",
        event: EVENT,
        targetSlot: slots[0],
        allSlots: slots,
        now: new Date("2026-10-17T10:30:00Z"),
      })
    ).toEqual({ error: "That shift already started — sign-ups are closed.", closed: true });
  });

  it("rejects with the event message once everything closed", () => {
    expect(
      signupCloseRejection({
        status: "OPEN",
        event: EVENT,
        targetSlot: open[0],
        allSlots: open,
        now: new Date("2026-10-17T10:00:00Z"),
      })
    ).toEqual({ error: "Sign-ups are closed — this event already happened.", closed: true });
  });

  it("handles overnight shifts (22:00–02:00 closes 22:00, past 02:00)", () => {
    const night = slot("n", "2026-10-17", "22:00", "02:00");
    const all = [night];
    // 21:59 — open.
    expect(
      signupCloseRejection({ status: "OPEN", event: EVENT, targetSlot: night, allSlots: all, now: new Date("2026-10-17T21:59:00Z") })
    ).toBeNull();
    // 23:00 — shift started, event still "running".
    expect(
      signupCloseRejection({ status: "OPEN", event: EVENT, targetSlot: night, allSlots: all, now: new Date("2026-10-17T23:00:00Z") })
    ).toEqual({ error: "Sign-ups are closed — this event already happened.", closed: true });
  });
});

describe("vote close policy", () => {
  it("splits open and closed options", () => {
    const slots = [
      { ...slot("a", "2026-10-17", "10:00", "11:00"), },
      { ...slot("b", "2026-10-18", "10:00", "11:00"), },
    ];
    const { rejected, closedIds } = voteCloseState({
      status: "OPEN",
      event: EVENT,
      slots,
      now: new Date("2026-10-17T10:30:00Z"),
    });
    expect(rejected).toBeNull();
    expect([...closedIds]).toEqual(["a"]);
  });

  it("rejects once every option passed", () => {
    const slots = [slot("a", "2026-10-17", "10:00", "11:00")];
    const { rejected } = voteCloseState({
      status: "OPEN",
      event: EVENT,
      slots,
      now: new Date("2026-10-17T10:30:00Z"),
    });
    expect(rejected).toEqual({
      error: "Voting is closed — all proposed times have passed.",
      closed: true,
    });
  });

  it("drops closed responses from a submitted matrix", () => {
    const submitted = new Map([
      ["a", "YES"],
      ["b", "MAYBE"],
      ["c", "NO"],
    ]);
    expect(dropClosedResponses(submitted, new Set(["a"]))).toEqual(
      new Map([
        ["b", "MAYBE"],
        ["c", "NO"],
      ])
    );
  });
});

describe("owner removal blocks", () => {
  it("blocks signup cancel once the shift happened, not while running", () => {
    const s = slot("a", "2026-10-17", "10:00", "12:00");
    expect(ownerCancelBlocked(s, EVENT, new Date("2026-10-17T11:00:00Z"))).toBe(false);
    expect(ownerCancelBlocked(s, EVENT, new Date("2026-10-17T12:00:00Z"))).toBe(true);
    expect(ownerCancelBlocked(null, EVENT, new Date("2026-10-17T12:00:00Z"))).toBe(false);
  });

  it("blocks vote delete once voting closed", () => {
    const slots = [slot("a", "2026-10-17", "10:00", "11:00")];
    expect(ownerDeleteVoteBlocked(EVENT, slots, new Date("2026-10-17T09:00:00Z"))).toBe(false);
    expect(ownerDeleteVoteBlocked(EVENT, slots, new Date("2026-10-17T10:00:00Z"))).toBe(true);
  });
});

describe("propose close policy", () => {
  const slots = [slot("a", "2026-10-17", "10:00", "11:00")];
  const past = new Date("2026-10-17T10:30:00Z");

  it("lets the organizer reopen a passed poll, blocks guests", () => {
    expect(
      proposeCloseRejection({ status: "OPEN", event: EVENT, slots, isAdmin: true, now: past })
    ).toBeNull();
    expect(
      proposeCloseRejection({ status: "OPEN", event: EVENT, slots, isAdmin: false, now: past })
    ).toEqual({
      error: "Voting is closed — only the organizer can add new times.",
      closed: true,
    });
  });

  it("keeps a manually closed poll shut for everyone", () => {
    expect(
      proposeCloseRejection({ status: "CLOSED", event: EVENT, slots, isAdmin: true, now: past })
    ).toEqual({ error: "This poll is closed — new times can't be proposed.", closed: true });
  });

  it("allows proposing while options remain", () => {
    expect(
      proposeCloseRejection({
        status: "OPEN",
        event: EVENT,
        slots,
        isAdmin: false,
        now: new Date("2026-10-17T09:00:00Z"),
      })
    ).toBeNull();
  });
});
