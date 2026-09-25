import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateModeTabs, defaultSelection, type DateSelection } from "~/components/RepeatPicker";
import { parseDateSpec, expandDates } from "~/utils/recurrence";

// The hidden inputs are what the server builds the schedule from, so they must
// post the rule the preview shows — not leftovers from the custom panel.
function posted(start: string, value: DateSelection) {
  const html = renderToString(createElement(DateModeTabs, { start, value, onChange: () => {} }));
  const fields = new Map<string, string>();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
    fields.set(m[1], m[2]);
  }
  return fields;
}

describe("DateModeTabs hidden inputs", () => {
  it("a weekly preset posts the start date's weekday, not stored custom weekdays", () => {
    // Thursday was picked in the custom panel, then the start moved to a Monday
    // and the "Weekly on Monday" preset was chosen.
    const start = "2026-10-05"; // Monday
    const value: DateSelection = {
      ...defaultSelection("2026-10-01"),
      mode: "repeat",
      repeatKey: "weekly",
      weekdays: [4],
      interval: 3,
      endMode: "after",
      count: 3,
    };
    const fields = posted(start, value);
    expect(fields.get("repeatWeekdays")).toBe("1");
    expect(fields.get("repeatInterval")).toBe("1");
    const parsed = parseDateSpec((n) => fields.get(n) ?? null, start);
    expect("spec" in parsed && expandDates(parsed.spec, start)).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
  });

  it("a monthly preset drops a custom interval", () => {
    const value: DateSelection = {
      ...defaultSelection("2026-10-05"),
      mode: "repeat",
      repeatKey: "monthly",
      unit: "month",
      interval: 4,
    };
    const fields = posted("2026-10-05", value);
    expect(fields.get("repeatType")).toBe("monthlyNth");
    expect(fields.get("repeatInterval")).toBe("1");
  });

  it("a custom rule posts its own interval and weekdays", () => {
    const value: DateSelection = {
      ...defaultSelection("2026-10-05"),
      mode: "repeat",
      repeatKey: "custom",
      unit: "week",
      interval: 2,
      weekdays: [1, 3],
    };
    const fields = posted("2026-10-05", value);
    expect(fields.get("repeatType")).toBe("weekly");
    expect(fields.get("repeatInterval")).toBe("2");
    expect(fields.get("repeatWeekdays")).toBe("1,3");
  });
});
