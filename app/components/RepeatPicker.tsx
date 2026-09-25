import { useEffect, useRef, useState } from "react";
import { CalendarDays, CalendarRange, Check, ChevronDown, Repeat } from "lucide-react";
import DatePicker from "~/components/DatePicker";
import {
  MAX_SERIES_DAYS,
  addDays,
  describeSpec,
  presetsFor,
  weekdayOf,
  type DateSpec,
} from "~/utils/recurrence";
import { formatSlotDateLabel } from "~/utils/calendar";
import { MAX_SLOT_ROWS_PER_EVENT } from "~/utils/validation";

/**
 * Form state for the event's dates. Kept flat (and JSON-serialisable) so it
 * can live in the same sessionStorage draft as the rest of the create form;
 * the server rebuilds the DateSpec from the hidden inputs and never trusts a
 * client-generated date list.
 *
 * The pieces render as separate fields of the create form rather than one
 * block: the type switcher sits above the date row, the end date sits inside
 * it next to the first date, and the repeat rule follows underneath.
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

/** "Event Date" only stays true for a one-day sheet. */
export function dateFieldLabel(mode: DateSelection["mode"]): string {
  if (mode === "single") return "Event Date *";
  // A run of days is first/last day; a series is first/until date.
  return mode === "range" ? "First Day *" : "First Date *";
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_INITIAL = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6];

const LABEL = "block text-xs font-semibold text-slate-700 mb-1.5";
const SMALL_LABEL = "block text-[10px] uppercase font-bold text-slate-400 mb-1.5";
const FIELD_BUTTON =
  "w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-slate-200/90 bg-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all";
const NUMBER_INPUT =
  "px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500";

const MODES: {
  key: DateSelection["mode"];
  label: string;
  /** Phone-width label — three segments have to fit one row at 375px. */
  short: string;
  Icon: typeof CalendarDays;
}[] = [
  { key: "single", label: "One day", short: "One day", Icon: CalendarDays },
  { key: "range", label: "Multiple days", short: "Multiple", Icon: CalendarRange },
  { key: "repeat", label: "Repeats", short: "Repeats", Icon: Repeat },
];

/**
 * Event type: the one control that says what kind of sheet this is. It also
 * carries every hidden input, so the whole spec posts from one place.
 */
export function DateModeTabs({
  start,
  value,
  onChange,
}: {
  start: string;
  value: DateSelection;
  onChange: (next: DateSelection) => void;
}) {
  const patch = (next: Partial<DateSelection>) => onChange({ ...value, ...next });
  const selectMode = (mode: DateSelection["mode"]) => {
    if (mode === value.mode) return;
    if (mode === "range") patch({ mode, end: value.end < start ? addDays(start, 2) : value.end });
    else if (mode === "repeat") patch({ mode, weekdays: value.weekdays.length ? value.weekdays : [weekdayOf(start)] });
    else patch({ mode: "single" });
  };
  const spec = selectionToSpec(value, start);

  return (
    <>
      {/* Hidden inputs are the contract with the action — the server re-expands
          the spec itself rather than trusting any client-side date list. */}
      <input type="hidden" name="dateMode" value={value.mode} />
      {value.mode === "range" && <input type="hidden" name="dateEnd" value={value.end} />}
      {/* Posted from the same spec the preview describes: a preset's weekday
          and interval come from the start date, never from whatever the
          custom panel last held. */}
      {spec.mode === "repeat" && (
        <>
          <input type="hidden" name="repeatType" value={spec.rule.type} />
          <input
            type="hidden"
            name="repeatInterval"
            value={"interval" in spec.rule ? spec.rule.interval : 1}
          />
          <input
            type="hidden"
            name="repeatWeekdays"
            value={spec.rule.type === "weekly" ? spec.rule.weekdays.join(",") : ""}
          />
          <input type="hidden" name="repeatEndMode" value={"after" in spec.ends ? "after" : "on"} />
          <input type="hidden" name="repeatEndDate" value={"on" in spec.ends ? spec.ends.on : ""} />
          <input type="hidden" name="repeatCount" value={"after" in spec.ends ? spec.ends.after : ""} />
        </>
      )}

      <div role="radiogroup" aria-label="Event type" className="flex gap-1 p-1 rounded-2xl bg-slate-100/80">
        {MODES.map(({ key, label, short, Icon }) => {
          const active = value.mode === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => selectMode(key)}
              className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-1.5 sm:px-2 py-2 rounded-xl text-[11px] sm:text-xs font-semibold transition-all ${
                active ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0 hidden sm:block" aria-hidden="true" />
              <span className="truncate sm:hidden">{short}</span>
              <span className="truncate hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * The second date of the date row: a range's last day, or the day a series
 * stops. A series that ends after N times shows the count here instead, so
 * the row always answers "and when does it end?".
 */
export function DateEndField({
  value,
  onChange,
}: {
  value: DateSelection;
  onChange: (next: DateSelection) => void;
}) {
  const patch = (next: Partial<DateSelection>) => onChange({ ...value, ...next });
  if (value.mode === "single") return null;

  if (value.mode === "range") {
    return (
      <div>
        <label className={LABEL}>Last Day *</label>
        <DatePicker value={value.end} onChange={(iso) => patch({ end: iso })} />
      </div>
    );
  }

  if (value.endMode === "after") {
    return (
      <div>
        <label className={LABEL}>Ends After</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max={MAX_SLOT_ROWS_PER_EVENT}
            value={value.count}
            onChange={(e) =>
              patch({
                count: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), MAX_SLOT_ROWS_PER_EVENT),
              })
            }
            className={`${NUMBER_INPUT} w-20 py-3 text-sm`}
          />
          <span className="text-sm text-slate-600">times</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className={LABEL}>Repeat Until *</label>
      <DatePicker value={value.endDate} onChange={(iso) => patch({ endDate: iso })} />
    </div>
  );
}

/** The repeat rule itself: presets, plus the custom panel when asked for. */
export function RepeatRuleField({
  start,
  value,
  onChange,
}: {
  start: string;
  value: DateSelection;
  onChange: (next: DateSelection) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const patch = (next: Partial<DateSelection>) => onChange({ ...value, ...next });

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (value.mode !== "repeat") return null;
  const presets = presetsFor(start, value.endDate);
  const isCustom = value.repeatKey === "custom";

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Repeats</label>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className={FIELD_BUTTON}
          >
            <span className="inline-flex items-center gap-2">
              <Repeat className="w-4 h-4 text-slate-400" aria-hidden="true" />
              {describeSpec(selectionToSpec(value, start), start)}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute z-20 mt-1 w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-lg p-1.5"
            >
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    patch({ repeatKey: preset.key });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left hover:bg-slate-50 transition-colors"
                >
                  <Check
                    className={`w-4 h-4 shrink-0 ${value.repeatKey === preset.key ? "text-blue-600" : "text-transparent"}`}
                  />
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  patch({
                    repeatKey: "custom",
                    weekdays: value.weekdays.length ? value.weekdays : [weekdayOf(start)],
                  });
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left hover:bg-slate-50 transition-colors"
              >
                <Check className={`w-4 h-4 shrink-0 ${isCustom ? "text-blue-600" : "text-transparent"}`} />
                Custom…
              </button>
            </div>
          )}
        </div>
      </div>

      {isCustom && (
        <div className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">Repeat every</span>
            <input
              type="number"
              min="1"
              max="12"
              value={value.interval}
              onChange={(e) => patch({ interval: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 12) })}
              className={`${NUMBER_INPUT} w-16`}
            />
            <select
              value={value.unit}
              onChange={(e) => patch({ unit: e.target.value as "week" | "month" })}
              className={NUMBER_INPUT}
            >
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </div>

          {value.unit === "week" && (
            <div>
              <span className={SMALL_LABEL}>Repeat on</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_ORDER.map((w) => {
                  const on = value.weekdays.includes(w);
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={on}
                      aria-label={WEEKDAY_SHORT[w]}
                      onClick={() =>
                        patch({
                          weekdays: on
                            ? value.weekdays.length > 1
                              ? value.weekdays.filter((d) => d !== w)
                              : value.weekdays
                            : [...value.weekdays, w].sort((a, b) => a - b),
                        })
                      }
                      className={`w-9 h-9 rounded-full text-xs font-semibold transition-all ${
                        on
                          ? "bg-blue-600 text-white"
                          : "bg-white border border-slate-200 text-slate-600 hover:border-blue-400"
                      }`}
                    >
                      {WEEKDAY_INITIAL[w]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <span className={SMALL_LABEL}>Ends</span>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2 text-slate-600">
                <input
                  type="radio"
                  name="repeatEndsRadio"
                  checked={value.endMode === "on"}
                  onChange={() => patch({ endMode: "on" })}
                  className="accent-blue-600"
                />
                On a date
              </label>
              <label className="inline-flex items-center gap-2 text-slate-600">
                <input
                  type="radio"
                  name="repeatEndsRadio"
                  checked={value.endMode === "after"}
                  onChange={() => patch({ endMode: "after" })}
                  className="accent-blue-600"
                />
                After a number of times
              </label>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Set the value in the field above. Sign-up sheets always need an end, so there is no
              &quot;never&quot;.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** "13 days · Tue, Sep 22 – Tue, Dec 15", or the reason it won't fit. */
export function DateSummary({
  value,
  dates,
  error,
}: {
  value: DateSelection;
  dates: string[];
  /** Set by the parent, which knows how many tasks each date carries. */
  error?: string | null;
}) {
  if (value.mode === "single" || dates.length === 0) return null;
  const text =
    error ||
    (dates.length === 1
      ? formatSlotDateLabel(dates[0])
      : `${dates.length} days · ${formatSlotDateLabel(dates[0])} – ${formatSlotDateLabel(dates[dates.length - 1])}`);
  return (
    <p
      className={`text-xs font-semibold rounded-xl px-3 py-2 ${
        error ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"
      }`}
    >
      {text}
    </p>
  );
}

/** Shared copy for the two limits, so the form and the action say the same thing. */
export function dateLimitError(dates: string[], taskSlots: number): string | null {
  if (dates.length > MAX_SERIES_DAYS)
    return "A sheet can run for up to one year — pick an earlier end.";
  if (taskSlots > MAX_SLOT_ROWS_PER_EVENT)
    return `That adds up to ${taskSlots} tasks across ${dates.length} days. A sheet can hold ${MAX_SLOT_ROWS_PER_EVENT} — use fewer days or fewer tasks.`;
  return null;
}
