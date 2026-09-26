// Pure date helpers for the sign-up create form.
//
// The form keeps its dates as a flat DateSelection (JSON, so it lives in the
// sessionStorage draft) and posts them as hidden inputs the action turns back
// into a DateSpec. These functions are that mapping, kept free of React so the
// copy/template prefill can run exactly the same logic the form runs.
import { MAX_SERIES_DAYS, addDays, presetsFor, weekdayOf, type DateSpec } from "~/utils/recurrence";
import { formatSlotDateLabel } from "~/utils/calendar";
import { MAX_SLOT_ROWS_PER_EVENT } from "~/utils/validation";

/**
 * Form state for the event's dates. Kept flat (and JSON-serialisable) so it
 * can live in the same sessionStorage draft as the rest of the create form;
 * the server rebuilds the DateSpec from the hidden inputs and never trusts a
 * client-generated date list.
 */
export type DateSelection = {
  mode: "single" | "range" | "repeat";
  /** Last day, when mode is "range". */
  end: string;
  /** Preset key from presetsFor(), or "custom". */
  repeatKey: string;
  interval: number;
  unit: "week" | "month";
  weekdays: number[];
  endMode: "on" | "after";
  endDate: string;
  count: number;
};

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function defaultSelection(start: string): DateSelection {
  return {
    mode: "single",
    end: addDays(start, 2),
    repeatKey: "weekly",
    interval: 1,
    unit: "week",
    weekdays: [weekdayOf(start)],
    endMode: "on",
    endDate: addDays(start, 84),
    count: 12,
  };
}

export function selectionToSpec(sel: DateSelection, start: string): DateSpec {
  if (sel.mode === "range") return { mode: "range", end: sel.end };
  if (sel.mode !== "repeat") return { mode: "single" };
  const ends = sel.endMode === "after" ? { after: sel.count } : { on: sel.endDate };
  if (sel.repeatKey === "custom") {
    return sel.unit === "month"
      ? { mode: "repeat", rule: { type: "monthlyNth", interval: sel.interval }, ends }
      : {
          mode: "repeat",
          rule: {
            type: "weekly",
            interval: sel.interval,
            weekdays: sel.weekdays.length ? sel.weekdays : [weekdayOf(start)],
          },
          ends,
        };
  }
  const preset = presetsFor(start, sel.endDate).find((p) => p.key === sel.repeatKey);
  if (!preset || preset.spec.mode !== "repeat") return { mode: "single" };
  return { ...preset.spec, ends };
}

/**
 * Rebuilds the form state from a stored spec, so the edit screen opens on
 * what the sheet actually is rather than on defaults.
 */
export function selectionFromSpec(spec: DateSpec, start: string): DateSelection {
  const base = defaultSelection(start);
  if (spec.mode === "range") return { ...base, mode: "range", end: spec.end };
  if (spec.mode !== "repeat") return base;

  const ends =
    "after" in spec.ends
      ? { endMode: "after" as const, count: spec.ends.after }
      : { endMode: "on" as const, endDate: spec.ends.on };
  const rule = spec.rule;

  if (rule.type === "weekly") {
    // A plain weekly rule on the start date's own weekday is the "Weekly on X"
    // preset; anything else needs the custom panel to be shown.
    const weekdays = rule.weekdays.length ? rule.weekdays : [weekdayOf(start)];
    const isPreset = rule.interval === 1 && weekdays.length === 1 && weekdays[0] === weekdayOf(start);
    return {
      ...base,
      ...ends,
      mode: "repeat",
      repeatKey: isPreset ? "weekly" : "custom",
      unit: "week",
      interval: rule.interval,
      weekdays,
    };
  }
  if (rule.type === "monthlyNth") {
    return {
      ...base,
      ...ends,
      mode: "repeat",
      repeatKey: rule.interval === 1 ? "monthly" : "custom",
      unit: "month",
      interval: rule.interval,
    };
  }
  return { ...base, ...ends, mode: "repeat", repeatKey: rule.type };
}

/**
 * The hidden inputs the form posts for its dates — the contract with the
 * action, which re-expands the spec itself rather than trusting any
 * client-side date list. Posted from the same spec the preview describes: a
 * preset's weekday and interval come from the start date, never from whatever
 * the custom panel last held.
 */
export function dateFieldsFor(sel: DateSelection, start: string): Array<[string, string]> {
  const fields: Array<[string, string]> = [["dateMode", sel.mode]];
  if (sel.mode === "range") fields.push(["dateEnd", sel.end]);
  const spec = selectionToSpec(sel, start);
  if (spec.mode === "repeat") {
    fields.push(
      ["repeatType", spec.rule.type],
      ["repeatInterval", String("interval" in spec.rule ? spec.rule.interval : 1)],
      ["repeatWeekdays", spec.rule.type === "weekly" ? spec.rule.weekdays.join(",") : ""],
      ["repeatEndMode", "after" in spec.ends ? "after" : "on"],
      ["repeatEndDate", "on" in spec.ends ? spec.ends.on : ""],
      ["repeatCount", "after" in spec.ends ? String(spec.ends.after) : ""]
    );
  }
  return fields;
}

/** The days a shift can be limited to: dates for a range, weekdays for a repeat. */
export function dayChoicesFor(
  sel: DateSelection,
  dates: string[]
): { key: string; label: string }[] {
  if (sel.mode === "range" && dates.length > 1 && dates.length <= 31) {
    return dates.map((d) => ({ key: d, label: formatSlotDateLabel(d) }));
  }
  if (sel.mode === "repeat") {
    const weekdays = [...new Set(dates.map(weekdayOf))].sort((a, b) => a - b);
    if (weekdays.length > 1) {
      return weekdays.map((w) => ({ key: `w${w}`, label: WEEKDAY_SHORT[w] }));
    }
  }
  return [];
}

/**
 * The days a shift actually runs on, given the day choices the current dates
 * offer. Drops keys left over from an earlier date selection; null means
 * every date (no choices, nothing left, or every choice picked).
 */
export function daysForShift(days: string[] | null | undefined, choiceKeys: string[]): string[] | null {
  if (!days || choiceKeys.length === 0) return null;
  const kept = days.filter((d) => choiceKeys.includes(d));
  return kept.length === 0 || kept.length === choiceKeys.length ? null : kept;
}

/** Shared copy for the two limits, so the form and the action say the same thing. */
export function dateLimitError(dates: string[], taskSlots: number): string | null {
  if (dates.length > MAX_SERIES_DAYS)
    return "A sheet can run for up to one year — pick an earlier end.";
  if (taskSlots > MAX_SLOT_ROWS_PER_EVENT)
    return `That adds up to ${taskSlots} tasks across ${dates.length} days. A sheet can hold ${MAX_SLOT_ROWS_PER_EVENT} — use fewer days or fewer tasks.`;
  return null;
}
