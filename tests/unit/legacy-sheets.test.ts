import { describe, expect, it } from "vitest";
import { parseDateSpec, parseDayFilter, readDateSpec, dayFilterMatches } from "~/utils/recurrence";
import { effectiveDateForSlot } from "~/utils/calendar";
import { expiryDateFor, isExpired } from "~/utils/retention";

/**
 * Every sheet created before multi-day exists in production as: one row per
 * task with slot_date NULL, events.settings "{}", and a form that posts no
 * date fields at all. These tests pin that shape so a later change to the
 * date code can't quietly reinterpret it.
 */
describe("sheets created before multi-day existed", () => {
  it("treats a post with no date fields as a one-day sheet", () => {
    const empty = (_name: string) => null;
    expect(parseDateSpec(empty, "2026-09-22")).toEqual({ spec: { mode: "single" } });
  });

  it("ignores an empty or junk dateMode rather than failing", () => {
    const form = (values: Record<string, string>) => (name: string) =>
      name in values ? values[name] : null;
    expect(parseDateSpec(form({ dateMode: "" }), "2026-09-22")).toEqual({
      spec: { mode: "single" },
    });
    // An unknown mode is rejected with a message, never silently expanded.
    expect(parseDateSpec(form({ dateMode: "weekly-ish" }), "2026-09-22")).toHaveProperty("error");
  });

  it('reads the legacy settings value "{}" as a one-day sheet', () => {
    expect(readDateSpec("{}")).toEqual({ mode: "single" });
    expect(readDateSpec(null)).toEqual({ mode: "single" });
    expect(readDateSpec(undefined)).toEqual({ mode: "single" });
  });

  it("falls back to the event date for a slot with no date of its own", () => {
    const legacySlot = { id: "legacyslot01", slotDate: null, startTime: "09:00", endTime: "10:00" };
    expect(effectiveDateForSlot(legacySlot, "2026-10-17")).toBe("2026-10-17");
    // A sheet with no date at all (allowed today) stays dateless.
    expect(effectiveDateForSlot(legacySlot, null)).toBeNull();
  });

  it("runs every task on every day when no day filter was posted", () => {
    expect(parseDayFilter(undefined)).toBeNull();
    expect(parseDayFilter(null)).toBeNull();
    expect(parseDayFilter("")).toBeNull();
    expect(dayFilterMatches(null, "2026-10-17")).toBe(true);
  });

  it("keeps measuring retention from creation when there are no dated slots", () => {
    const created = "2026-01-01T00:00:00.000Z";
    const now = new Date("2026-06-01T00:00:00.000Z");
    // Same answer with the argument omitted and with an explicit null.
    expect(isExpired(created, now, 90)).toBe(isExpired(created, now, 90, null));
    expect(isExpired(created, now, 90)).toBe(true);
    expect(isExpired(created, now, 365)).toBe(false);
    expect(expiryDateFor(created, 90)).toBe(expiryDateFor(created, 90, null));
    // ~90 days on, without pinning the exact day: expiryDateFor uses local
    // setDate(), so the host's timezone can shift it by one.
    const days = (Date.parse(expiryDateFor(created, 90)) - Date.parse(created)) / 86400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });
});
