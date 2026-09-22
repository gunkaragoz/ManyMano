import { useEffect, useRef, useState } from "react";
import { CalendarDays, CalendarRange, Check, ChevronDown, Repeat } from "lucide-react";
import DatePicker from "~/components/DatePicker";
import {
  addDays,
  describeSpec,
  expandDates,
  presetsFor,
  weekdayOf,
  type DateSpec,
} from "~/utils/recurrence";
import { formatSlotDateLabel } from "~/utils/calendar";
import { MAX_DATES_PER_EVENT } from "~/utils/validation";

/**
 * Form state for the "when" block. Kept flat (and JSON-serialisable) so it can
 * live in the same sessionStorage draft as the rest of the create form; the
 * server rebuilds the DateSpec from the hidden inputs and never trusts a
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

export function defaultSelection(start: string): DateSelection {
  return {
    mode: "single",
    end: addDays(start, 2),
    repeatKey: "none",
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

/** The days a shift can be limited to: dates for a range, weekdays for a repeat. */
export function dayChoicesFor(
  sel: DateSelection,
  dates: string[]
): { key: string; label: string }[] {
  if (sel.mode === "range" && dates.length > 1 && dates.length <= MAX_DATES_PER_EVENT) {
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

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_INITIAL = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6];

const fieldButton =
  "w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-slate-200/90 bg-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all";

const MODES: {
  key: DateSelection["mode"];
  label: string;
  /** Phone-width label — three segments have to fit one row at 375px. */
  short: string;
  Icon: typeof CalendarDays;
}[] = [
  { key: "single", label: "One day", short: "One day", Icon: CalendarDays },
  { key: "range", label: "Date range", short: "Range", Icon: CalendarRange },
  { key: "repeat", label: "Repeats", short: "Repeats", Icon: Repeat },
];

export default function RepeatPicker({
  start,
  value,
  onChange,
  dates,
}: {
  start: string;
  value: DateSelection;
  onChange: (next: DateSelection) => void;
  /** Expanded dates, computed by the parent (it needs them for the day chips too). */
  dates: string[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const presets = presetsFor(start, value.endDate);
  const isRange = value.mode === "range";
  const spec = selectionToSpec(value, start);
  const tooMany = dates.length > MAX_DATES_PER_EVENT;

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

  const patch = (next: Partial<DateSelection>) => onChange({ ...value, ...next });

  const repeatLabel = value.mode === "repeat" ? describeSpec(spec, start) : "Pick how it repeats";

  const summary = tooMany
    ? `That's more than ${MAX_DATES_PER_EVENT} dates — pick an earlier end.`
    : dates.length === 1
      ? formatSlotDateLabel(dates[0])
      : `${dates.length} dates · ${formatSlotDateLabel(dates[0])} – ${formatSlotDateLabel(dates[dates.length - 1])}`;

  const selectMode = (mode: DateSelection["mode"]) => {
    if (mode === value.mode) return;
    if (mode === "range") patch({ mode, end: value.end < start ? addDays(start, 2) : value.end });
    else if (mode === "repeat") {
      // Land on a real rule rather than an empty combobox.
      patch({ mode, repeatKey: value.repeatKey === "none" ? "weekly" : value.repeatKey });
    } else patch({ mode: "single" });
  };

  return (
    <div className="space-y-3">
      {/* Hidden inputs are the contract with the action — the server re-expands
          the spec itself rather than trusting any client-side date list. */}
      <input type="hidden" name="dateMode" value={value.mode} />
      {isRange && <input type="hidden" name="dateEnd" value={value.end} />}
      {value.mode === "repeat" && (
        <>
          <input
            type="hidden"
            name="repeatType"
            value={
              value.repeatKey === "custom"
                ? value.unit === "month"
                  ? "monthlyNth"
                  : "weekly"
                : value.repeatKey === "monthly"
                  ? "monthlyNth"
                  : value.repeatKey === "none"
                    ? "weekly"
                    : value.repeatKey
            }
          />
          <input type="hidden" name="repeatInterval" value={value.interval} />
          <input type="hidden" name="repeatWeekdays" value={value.weekdays.join(",")} />
          <input type="hidden" name="repeatEndMode" value={value.endMode} />
          <input type="hidden" name="repeatEndDate" value={value.endDate} />
          <input type="hidden" name="repeatCount" value={value.count} />
        </>
      )}

      {/* One row, three explicit choices — the mode is never implied by a
          detail control being filled in. */}
      <div role="radiogroup" aria-label="How often" className="flex gap-1 p-1 rounded-2xl bg-slate-100/80">
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
                active
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0 hidden sm:block" aria-hidden="true" />
              <span className="truncate sm:hidden">{short}</span>
              <span className="truncate hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {isRange && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 shrink-0">Last day</span>
          <div className="min-w-[190px] grow sm:grow-0">
            <DatePicker value={value.end} onChange={(iso) => patch({ end: iso })} />
          </div>
        </div>
      )}

      {value.mode === "repeat" && (
        <div className="flex flex-wrap items-center gap-2">
        <div className="relative grow min-w-[220px]" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className={fieldButton}
          >
            <span className="inline-flex items-center gap-2">
              <Repeat className="w-4 h-4 text-slate-400" aria-hidden="true" />
              {repeatLabel}
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
                <Check
                  className={`w-4 h-4 shrink-0 ${value.repeatKey === "custom" ? "text-blue-600" : "text-transparent"}`}
                />
                Custom…
              </button>
            </div>
          )}
        </div>
        {/* The end is always visible and editable — except in Custom, which has
            its own Ends section and would otherwise show it twice. */}
        {value.repeatKey === "custom" ? null : value.endMode === "on" ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-slate-600">Until</span>
            <div className="min-w-[190px]">
              <DatePicker value={value.endDate} onChange={(iso) => patch({ endDate: iso })} />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => patch({ endMode: "on" })}
            className="shrink-0 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-all"
          >
            Ends after {value.count} times — use an end date
          </button>
        )}
        </div>
      )}

      {value.mode === "repeat" && value.repeatKey === "custom" && (
        <div className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">Repeat every</span>
            <input
              type="number"
              min="1"
              max="12"
              value={value.interval}
              onChange={(e) => patch({ interval: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 12) })}
              className="w-16 px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <select
              value={value.unit}
              onChange={(e) => patch({ unit: e.target.value as "week" | "month" })}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </div>

          {value.unit === "week" && (
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                Repeat on
              </span>
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
            <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">Ends</span>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="inline-flex items-center gap-2 text-slate-600">
                  <input
                    type="radio"
                    name="repeatEndsRadio"
                    checked={value.endMode === "on"}
                    onChange={() => patch({ endMode: "on" })}
                    className="accent-blue-600"
                  />
                  on
                </label>
                <div className="min-w-[170px]">
                  <DatePicker value={value.endDate} onChange={(iso) => patch({ endDate: iso, endMode: "on" })} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="inline-flex items-center gap-2 text-slate-600">
                  <input
                    type="radio"
                    name="repeatEndsRadio"
                    checked={value.endMode === "after"}
                    onChange={() => patch({ endMode: "after" })}
                    className="accent-blue-600"
                  />
                  after
                </label>
                <input
                  type="number"
                  min="1"
                  max={MAX_DATES_PER_EVENT}
                  value={value.count}
                  onChange={(e) =>
                    patch({
                      count: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), MAX_DATES_PER_EVENT),
                      endMode: "after",
                    })
                  }
                  className="w-20 px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-slate-600">times</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Sign-up sheets always need an end date, so there is no &quot;never&quot;.
            </p>
          </div>
        </div>
      )}

      {value.mode !== "single" && (
        <p
          className={`text-xs font-semibold rounded-xl px-3 py-2 ${
            tooMany ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"
          }`}
        >
          {summary}
        </p>
      )}
    </div>
  );
}
