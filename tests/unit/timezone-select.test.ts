// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TimezoneSelect from "~/components/TimezoneSelect";
import * as timezones from "~/utils/timezones";

beforeEach(() => {
  vi.spyOn(timezones, "getAllTimezones").mockReturnValue(["UTC", "Europe/Berlin", "Asia/Kathmandu"]);
  vi.spyOn(timezones, "getOffsetMinutes").mockImplementation((tz) =>
    tz === "UTC" ? 0 : tz === "Europe/Berlin" ? 120 : 345
  );
  vi.spyOn(timezones, "detectLocalTimezone").mockReturnValue("UTC");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callback(0));
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("timezone picker CPU work", () => {
  it("renders the selected zone and form value on the server without enumerating other zones", () => {
    const html = renderToString(createElement(TimezoneSelect, {
      value: "Asia/Kathmandu", name: "timezone", onChange: vi.fn(),
    }));
    expect(html).toContain("Kathmandu");
    expect(html).toContain("GMT+05:45");
    expect(html).toContain('value="Asia/Kathmandu"');
    expect(timezones.getAllTimezones).not.toHaveBeenCalled();
    expect(timezones.getOffsetMinutes).not.toHaveBeenCalled();
  });

  it("loads offsets once per zone on open, filters, and selects with the keyboard", () => {
    const onChange = vi.fn();
    render(createElement(TimezoneSelect, { value: "UTC", onChange }));
    expect(timezones.getAllTimezones).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /UTC/ }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(timezones.getOffsetMinutes).toHaveBeenCalledTimes(3);
    const input = screen.getByRole("textbox", { name: "Search timezones" });
    fireEvent.change(input, { target: { value: "Kathmandu GMT+05:45" } });
    expect(screen.getAllByRole("option").length).toBe(2); // Selected UTC stays visible.
    expect(timezones.getOffsetMinutes).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Asia/Kathmandu");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("computed UTC offset labels", () => {
  it.each([
    [0, "GMT+00:00"],
    [345, "GMT+05:45"],
    [-210, "GMT-03:30"],
    [null, null],
  ])("formats %s minutes as %s", (minutes, label) => {
    expect(timezones.formatUtcOffsetMinutes(minutes as number | null)).toBe(label);
  });
});
