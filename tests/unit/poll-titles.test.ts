import { describe, expect, it } from "vitest";
import { formatTimeDisplay, pollDefaultTitle } from "~/utils/pollTitles";

// These are the exact strings the create action stored before the title
// helper was shared — copies recognise generated titles by comparing to them,
// so the format must not drift.
describe("poll default titles", () => {
  it("timed options", () => {
    expect(pollDefaultTitle("2026-09-12", "10:00", "11:00")).toBe("Sat, Sep 12 · 10:00 AM – 11:00 AM");
    expect(pollDefaultTitle("2026-12-31", "23:30", "00:30")).toBe("Thu, Dec 31 · 11:30 PM – 12:30 AM");
    expect(pollDefaultTitle("2027-01-04", "00:05", "12:05")).toBe("Mon, Jan 4 · 12:05 AM – 12:05 PM");
  });

  it("all-day options", () => {
    expect(pollDefaultTitle("2026-09-12", null, null)).toBe("Sat, Sep 12 · All day");
  });

  it("formats 24h times as 12h", () => {
    expect(formatTimeDisplay("09:05")).toBe("9:05 AM");
    expect(formatTimeDisplay("12:00")).toBe("12:00 PM");
    expect(formatTimeDisplay("nonsense")).toBe("nonsense");
  });
});
