// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DatePicker from "~/components/DatePicker";
import { getOffsetMinutes } from "~/utils/timezones";
import { todayInZone } from "~/utils/event-expiry";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("date picker rendering", () => {
  it.each([
    ["2028-02-29", "Tue, Feb 29, 2028"],
    ["2026-12-31", "Thu, Dec 31, 2026"],
    ["2026-03-08", "Sun, Mar 8, 2026"],
    ["2026-02-30", "2026-02-30"],
  ])("preserves the English display and form value for %s without locale formatting", (value, label) => {
    const format = vi.spyOn(Date.prototype, "toLocaleDateString");
    const html = renderToString(createElement(DatePicker, { value, name: "date" }));
    expect(html).toContain(label);
    expect(html).toContain('value="' + value + '"');
    expect(html).not.toContain('role="dialog"');
    expect(format).not.toHaveBeenCalled();
  });

  it("opens the leap-month calendar, enforces the minimum, navigates and selects", () => {
    const onChange = vi.fn();
    render(createElement(DatePicker, { value: "2028-02-29", min: "2028-02-28", onChange }));
    fireEvent.click(screen.getByRole("button", { name: /Tue, Feb 29/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose a date" });
    expect(dialog.textContent).toContain("Feb 2028");
    expect(dialog.querySelectorAll("button[disabled]").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(dialog.textContent).toContain("Mar 2028");
    const day = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "15")!;
    fireEvent.click(day);
    expect(onChange).toHaveBeenCalledWith("2028-03-15");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("UTC fast paths", () => {
  it("uses ISO day and zero offset without constructing an Intl formatter", () => {
    const format = vi.spyOn(Intl, "DateTimeFormat");
    const at = new Date("2026-10-18T00:30:45.123Z");
    expect(todayInZone("UTC", at)).toBe("2026-10-18");
    expect(todayInZone(null, at)).toBe("2026-10-18");
    expect(getOffsetMinutes("UTC", at)).toBe(0);
    expect(getOffsetMinutes("UTC", new Date(NaN))).toBeNull();
    expect(format).not.toHaveBeenCalled();
  });

  it("keeps timezone-sensitive days and DST offsets correct", () => {
    expect(todayInZone("America/New_York", new Date("2026-10-18T00:30:00Z"))).toBe("2026-10-17");
    expect(getOffsetMinutes("America/New_York", new Date("2026-07-01T12:00:00Z"))).toBe(-240);
    expect(getOffsetMinutes("America/New_York", new Date("2026-12-01T12:00:00Z"))).toBe(-300);
    expect(getOffsetMinutes("Asia/Kathmandu", new Date("2026-10-01T12:00:00Z"))).toBe(345);
  });
});
