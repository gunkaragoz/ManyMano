import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

interface DatePickerProps {
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  name?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  /** Accent color for selected day, focus ring, and Today affordances. Defaults to blue. */
  accent?: "blue" | "green";
}

function parseISO(v: string | undefined): { y: number; m: number; d: number } | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatDisplay(iso: string): string {
  const p = parseISO(iso);
  if (!p) return iso;
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function DatePicker({
  value,
  defaultValue,
  onChange,
  name,
  required,
  placeholder = "Pick a day",
  className = "",
  accent = "blue",
}: DatePickerProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue || "");
  const current = controlled ? value || "" : internal;

  const [open, setOpen] = useState(false);
  const parsed = parseISO(current);
  const today = new Date();
  const [viewY, setViewY] = useState(parsed?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState((parsed?.m ?? today.getMonth() + 1) - 1);
  const wrapRef = useRef<HTMLDivElement>(null);

  // When a new controlled value arrives (e.g. draft load), sync the calendar view.
  useEffect(() => {
    const p = parseISO(current);
    if (p) {
      setViewY(p.y);
      setViewM(p.m - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(viewY, viewM, 1).getDay();
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    const daysInPrev = new Date(viewY, viewM, 0).getDate();
    const prevM = viewM === 0 ? 11 : viewM - 1;
    const prevY = viewM === 0 ? viewY - 1 : viewY;
    const nextM = viewM === 11 ? 0 : viewM + 1;
    const nextY = viewM === 11 ? viewY + 1 : viewY;
    const out: Array<{ y: number; m: number; d: number; inMonth: boolean }> = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      out.push({ y: prevY, m: prevM + 1, d: daysInPrev - i, inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ y: viewY, m: viewM + 1, d, inMonth: true });
    }
    while (out.length % 7 !== 0 || out.length < 42) {
      const last = out[out.length - 1];
      // Fill trailing days; roll into next month after current month ends.
      const inNext = out.length >= firstWeekday + daysInMonth;
      const d = inNext ? out.filter((c) => !c.inMonth && c.m === nextM + 1).length + 1 : last.d + 1;
      out.push({ y: nextY, m: nextM + 1, d, inMonth: false });
      if (out.length >= 42) break;
    }
    return out.slice(0, 42);
  }, [viewY, viewM]);

  const commit = (iso: string) => {
    if (!controlled) setInternal(iso);
    onChange?.(iso);
    setOpen(false);
  };

  const go = (delta: number) => {
    const d = new Date(viewY, viewM + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
  };

  const monthLabel = new Date(viewY, viewM, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  const selectedKey = parsed ? toISO(parsed.y, parsed.m, parsed.d) : "";
  const todayKey = toISO(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const accentStyles =
    accent === "green"
      ? {
          triggerFocus: "focus:ring-green-500/20 focus:border-green-500",
          selectedDay: "bg-green-600 text-white font-bold shadow-sm",
          dayHover: "text-slate-700 hover:bg-green-50 hover:text-green-700 font-medium",
          todayRing: "ring-1 ring-green-500 font-bold",
          todayDot: "w-2 h-2 rounded-full bg-slate-300 hover:bg-green-500 transition-colors",
          todayButton: "text-[11px] font-bold text-green-600 hover:text-green-700",
        }
      : {
          triggerFocus: "focus:ring-blue-500/20 focus:border-blue-500",
          selectedDay: "bg-blue-600 text-white font-bold shadow-sm",
          dayHover: "text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium",
          todayRing: "ring-1 ring-blue-500 font-bold",
          todayDot: "w-2 h-2 rounded-full bg-slate-300 hover:bg-blue-500 transition-colors",
          todayButton: "text-[11px] font-bold text-blue-600 hover:text-blue-700",
        };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={current} required={required} />}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 ${accentStyles.triggerFocus} transition-all flex items-center gap-2 text-left text-slate-800 hover:border-slate-300 min-w-0`}
      >
        <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
        <span className={`${current ? "font-semibold" : "text-slate-400"} truncate whitespace-nowrap min-w-0 flex-1`}>
          {current ? formatDisplay(current) : placeholder}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute z-30 mt-2 w-64 rounded-2xl border border-slate-200 bg-white shadow-xl p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-slate-900">{monthLabel}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous month"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewY(today.getFullYear());
                  setViewM(today.getMonth());
                }}
                aria-label="Go to today"
                title="Go to today"
                className={accentStyles.todayDot}
              />
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next month"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((w) => (
              <span
                key={w}
                className="text-center text-[10px] uppercase font-bold text-slate-400 py-1"
              >
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c, i) => {
              const key = toISO(c.y, c.m, c.d);
              const isSelected = key === selectedKey;
              const isToday = key === todayKey;
              return (
                <button
                  key={`${key}-${i}`}
                  type="button"
                  onClick={() => commit(key)}
                  className={[
                    "h-8 w-8 mx-auto rounded-full text-xs flex items-center justify-center transition-all",
                    isSelected
                      ? accentStyles.selectedDay
                      : c.inMonth
                        ? accentStyles.dayHover
                        : "text-slate-300 hover:bg-slate-50",
                    !isSelected && isToday ? accentStyles.todayRing : "",
                  ].join(" ")}
                >
                  {c.d}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                const t = new Date();
                commit(toISO(t.getFullYear(), t.getMonth() + 1, t.getDate()));
              }}
              className={accentStyles.todayButton}
            >
              Today
            </button>
            {current && !required && (
              <button
                type="button"
                onClick={() => {
                  if (!controlled) setInternal("");
                  onChange?.("");
                  setOpen(false);
                }}
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
