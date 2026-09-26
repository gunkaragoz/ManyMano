import { describe, expect, it } from "vitest";
import {
  CLOSING_SOON_MS,
  COUNTDOWN_ABSOLUTE_MS,
  closedSlotIds,
  closesInLabel,
  closingPhraseForSlot,
  eventCloseInstant,
  eventEndInstant,
  formatOrganizerInstant,
  isEventClosed,
  isEventPast,
  isSlotClosed,
  isSlotHappeningNow,
  isSlotPast,
  msUntilSlotClose,
  pastSlotIds,
  rebaseDatesToToday,
  shiftIsoDate,
  slotCloseInstant,
  slotEndInstant,
  todayInZone,
} from "~/utils/event-expiry";

const TZ = "UTC";

describe("event closing (close at start, past at end)", () => {
  it("closes a timed slot at its start, past at its end", () => {
    const slot = { slotDate: "2026-10-17", startTime: "10:00", endTime: "12:00" };
    // Before start: open.
    expect(isSlotClosed(slot, null, TZ, new Date("2026-10-17T09:59:59Z"))).toBe(false);
    // At start: closed to new sign-ups, but happening now — not past.
    const atStart = new Date("2026-10-17T10:00:00Z");
    expect(isSlotClosed(slot, null, TZ, atStart)).toBe(true);
    expect(isSlotHappeningNow(slot, null, TZ, atStart)).toBe(true);
    expect(isSlotPast(slot, null, TZ, atStart)).toBe(false);
    // Mid-shift: still happening.
    expect(isSlotHappeningNow(slot, null, TZ, new Date("2026-10-17T11:00:00Z"))).toBe(true);
    // At end: past.
    const atEnd = new Date("2026-10-17T12:00:00Z");
    expect(isSlotPast(slot, null, TZ, atEnd)).toBe(true);
    expect(isSlotHappeningNow(slot, null, TZ, atEnd)).toBe(false);
  });

  it("assumes a 1h duration when only a start time is given", () => {
    expect(
      slotCloseInstant({ slotDate: "2026-10-17", startTime: "10:00", endTime: null }, null, TZ)?.toISOString()
    ).toBe("2026-10-17T10:00:00.000Z");
    expect(
      slotEndInstant({ slotDate: "2026-10-17", startTime: "10:00", endTime: null }, null, TZ)?.toISOString()
    ).toBe("2026-10-17T11:00:00.000Z");
  });

  it("closes and ends an all-day slot at end of day (never happening)", () => {
    const slot = { slotDate: "2026-10-17", startTime: null, endTime: null };
    expect(isSlotClosed(slot, null, TZ, new Date("2026-10-17T23:59:59Z"))).toBe(false);
    const midnight = new Date("2026-10-18T00:00:00Z");
    expect(isSlotClosed(slot, null, TZ, midnight)).toBe(true);
    expect(isSlotPast(slot, null, TZ, midnight)).toBe(true);
    expect(isSlotHappeningNow(slot, null, TZ, new Date("2026-10-17T12:00:00Z"))).toBe(false);
  });

  it("closes the event at the last start, past at the last end", () => {
    const event = { eventDate: "2026-10-17", timezone: TZ };
    const slots = [
      { id: "a", slotDate: "2026-10-17", startTime: "10:00", endTime: "11:00" },
      { id: "b", slotDate: "2026-10-24", startTime: "10:00", endTime: "11:00" },
    ];
    // First slot closed, last still open: event open, only "a" closed.
    const mid = new Date("2026-10-18T00:00:00Z");
    expect(isEventClosed(event, slots, mid)).toBe(false);
    expect(closedSlotIds(event, slots, mid)).toEqual(["a"]);
    expect(pastSlotIds(event, slots, mid)).toEqual(["a"]);
    // Last start passes: event closed but not fully past.
    const lastStart = new Date("2026-10-24T10:00:00Z");
    expect(isEventClosed(event, slots, lastStart)).toBe(true);
    expect(isEventPast(event, slots, lastStart)).toBe(false);
    expect(eventCloseInstant(event, slots)?.toISOString()).toBe("2026-10-24T10:00:00.000Z");
    expect(eventEndInstant(event, slots)?.toISOString()).toBe("2026-10-24T11:00:00.000Z");
  });

  it("never closes an undated event", () => {
    const event = { eventDate: null, timezone: TZ };
    expect(eventCloseInstant(event, [])).toBeNull();
    expect(isEventClosed(event, [], new Date("2030-01-01T00:00:00Z"))).toBe(false);
    expect(isEventPast(event, [], new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("respects the organizer timezone", () => {
    // 10:00 in New York (EDT, UTC-4) closes at 14:00Z.
    const slot = { slotDate: "2026-10-17", startTime: "10:00", endTime: "11:00" };
    expect(isSlotClosed(slot, null, "America/New_York", new Date("2026-10-17T13:59:59Z"))).toBe(false);
    expect(isSlotClosed(slot, null, "America/New_York", new Date("2026-10-17T14:00:00Z"))).toBe(true);
  });

  it("measures closing warnings inside 24h", () => {
    expect(CLOSING_SOON_MS).toBe(24 * 3600_000);
    const slot = { slotDate: "2026-10-17", startTime: "10:00", endTime: "11:00" };
    // 3h before close.
    expect(msUntilSlotClose(slot, null, TZ, new Date("2026-10-17T07:00:00Z"))).toBe(3 * 3600_000);
    // Already closed → null.
    expect(msUntilSlotClose(slot, null, TZ, new Date("2026-10-17T10:00:01Z"))).toBeNull();
    expect(closesInLabel(3 * 3600_000)).toBe("3h");
    expect(closesInLabel(25 * 60000)).toBe("25m");
    expect(closesInLabel(30_000)).toBe("1m");
  });

  it("formats instants in the organizer zone", () => {
    // 10:00 UTC = 6:00 AM in New York (EDT).
    expect(formatOrganizerInstant("2026-10-17T10:00:00.000Z", "America/New_York")).toBe("Oct 17, 6:00 AM");
    expect(formatOrganizerInstant("2026-10-17T10:00:00.000Z", "UTC")).toBe("Oct 17, 10:00 AM");
    expect(formatOrganizerInstant(null, "UTC")).toBeNull();
    expect(formatOrganizerInstant("not-a-date", "UTC")).toBeNull();
  });

  it("reports the organizer-local today", () => {
    // 01:00 UTC Oct 18 is still Oct 17 in New York (EDT).
    const at = new Date("2026-10-18T01:00:00.000Z");
    expect(todayInZone("UTC", at)).toBe("2026-10-18");
    expect(todayInZone("America/New_York", at)).toBe("2026-10-17");
    expect(todayInZone("Mars/Olympus", at)).toBe("2026-10-18");
  });

  it("shifts date strings by N days", () => {
    expect(shiftIsoDate("2026-10-17", 1)).toBe("2026-10-18");
    expect(shiftIsoDate("2026-10-17", -1)).toBe("2026-10-16");
    expect(shiftIsoDate("not-a-date", 3)).toBe("not-a-date");
  });

  it("rebases every restored date together, preserving gaps", () => {
    // Consecutive stale rows shift as a block — never stacking onto one day.
    expect(rebaseDatesToToday(["2026-10-16", "2026-10-17"], "2026-10-17")).toEqual([
      "2026-10-17",
      "2026-10-18",
    ]);
    // Nothing stale — null (caller keeps state untouched).
    expect(rebaseDatesToToday(["2026-10-17", "2026-10-18"], "2026-10-17")).toBeNull();
    expect(rebaseDatesToToday([], "2026-10-17")).toBeNull();
    // Empty entries pass through in place.
    expect(rebaseDatesToToday(["2026-10-16", ""], "2026-10-17")).toEqual([
      "2026-10-17",
      "",
    ]);
  });

  it("handles overnight shifts (22:00–02:00 ends next day)", () => {
    const slot = { slotDate: "2026-10-17", startTime: "22:00", endTime: "02:00" };
    expect(slotCloseInstant(slot, null, TZ)?.toISOString()).toBe("2026-10-17T22:00:00.000Z");
    expect(slotEndInstant(slot, null, TZ)?.toISOString()).toBe("2026-10-18T02:00:00.000Z");
    // 23:00 — closed but happening, not past.
    const night = new Date("2026-10-17T23:00:00Z");
    expect(isSlotClosed(slot, null, TZ, night)).toBe(true);
    expect(isSlotHappeningNow(slot, null, TZ, night)).toBe(true);
    expect(isSlotPast(slot, null, TZ, night)).toBe(false);
    // 02:00 next day — past.
    expect(isSlotPast(slot, null, TZ, new Date("2026-10-18T02:00:00Z"))).toBe(true);
  });

  it("keeps wall-clock end across a DST fall-back", () => {
    // US DST ends Nov 1 2026 (02:00 → 01:00). A 22:00–02:00 New York shift
    // ends 02:00 EST = 07:00Z, not 06:00Z (fixed +24h would slip an hour).
    const slot = { slotDate: "2026-11-01", startTime: "22:00", endTime: "02:00" };
    expect(slotEndInstant(slot, null, "America/New_York")?.toISOString()).toBe(
      "2026-11-02T07:00:00.000Z"
    );
  });

  it("labels closing relatively under 6h, absolutely beyond", () => {
    expect(COUNTDOWN_ABSOLUTE_MS).toBe(6 * 3600_000);
    const slot = { slotDate: "2026-10-17", startTime: "10:00", endTime: "11:00" };
    // 3h out — relative.
    expect(closingPhraseForSlot(slot, null, TZ, new Date("2026-10-17T07:00:00Z"))).toBe("in 3h");
    // 25m out — relative.
    expect(closingPhraseForSlot(slot, null, TZ, new Date("2026-10-17T09:35:00Z"))).toBe("in 25m");
    // Already closed — null.
    expect(closingPhraseForSlot(slot, null, TZ, new Date("2026-10-17T10:00:01Z"))).toBeNull();
    // Days out — absolute, organizer-local.
    expect(closingPhraseForSlot(slot, null, TZ, new Date("2026-10-10T10:00:00Z"))).toBe(
      "Sat, Oct 17 at 10:00 AM"
    );
    // Tomorrow — day word.
    expect(closingPhraseForSlot(slot, null, TZ, new Date("2026-10-16T10:00:00Z"))).toBe(
      "tomorrow at 10:00 AM"
    );
  });
});
