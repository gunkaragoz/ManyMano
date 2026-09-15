import { useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";

interface TimePickerProps {
  /** 24h "HH:MM" value (controlled). */
  value?: string;
  defaultValue?: string;
  onChange?: (hhmm: string) => void;
  name?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  /** Accent color for selected cells and focus ring. Defaults to blue. */
  accent?: "blue" | "green";
  /** "sm" matches compact (text-xs) rows, e.g. create/signup shifts. Defaults to "md". */
  size?: "sm" | "md";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Normalize "H:MM"/"HH:MM" to "HH:MM". "" when invalid. */
function normalize24(value: string | undefined): string {
  if (!value) return "";
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = parseInt(m[1], 10);
  if (h < 0 || h > 23) return "";
  return `${pad(h)}:${m[2]}`;
}

/** "14:10" -> "2:10 PM". Falls back to the raw input. */
export function formatTime12(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  if (h < 0 || h > 23) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

/**
 * Leniently parse what the user typed. Accepts "10:10", "10:10 AM",
 * "10:10am", "10a", "22:10", bare hour "10" (= :00). Returns 24h "HH:MM"
 * or null when unparseable.
 */
function parseTyped(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (!t) return null;
  const merMatch = t.match(/^(.*?)\s*([ap])\s*m?$/);
  let body = t;
  let mer: string | null = null;
  if (merMatch && merMatch[1].length > 0) {
    body = merMatch[1].trim();
    mer = merMatch[2];
  }
  const parts = body.split(":");
  if (parts.length > 2 || !/^\d{1,2}$/.test(parts[0])) return null;
  const h = parseInt(parts[0], 10);
  let min = 0;
  if (parts.length === 2) {
    if (!/^\d{1,2}$/.test(parts[1])) return null;
    min = parseInt(parts[1], 10);
  }
  if (min < 0 || min > 59) return null;
  let h24: number;
  if (mer) {
    if (h < 1 || h > 12) return null;
    h24 = (h % 12) + (mer === "p" ? 12 : 0);
  } else {
    if (h < 0 || h > 23) return null;
    h24 = h;
  }
  return `${pad(h24)}:${pad(min)}`;
}

/**
 * Typeable time field + cute spinner dropdown. The native <input
 * type="time"> popup is browser chrome and can't be styled, so this keeps
 * free typing (any minute, e.g. 10:10) while the dropdown matches the app.
 * Submits 24h "HH:MM" via a hidden input, like DatePicker does for dates.
 */
export default function TimePicker({
  value,
  defaultValue,
  onChange,
  name,
  required,
  placeholder = "10:00 AM",
  className = "",
  accent = "blue",
  size = "md",
}: TimePickerProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue || "");
  const current = controlled ? value || "" : internal;

  // Display text. Synced from the committed value only when the value
  // changed elsewhere, so mid-typing drafts are never clobbered.
  const [text, setText] = useState(() => {
    const n = normalize24(current);
    return n ? formatTime12(n) : current;
  });
  const committedRef = useRef(normalize24(current));
  useEffect(() => {
    const n = normalize24(current);
    if (n !== committedRef.current) {
      committedRef.current = n;
      setText(n ? formatTime12(n) : "");
    }
  }, [current]);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hourColRef = useRef<HTMLDivElement>(null);
  const minColRef = useRef<HTMLDivElement>(null);

  const parsed = parseTyped(text);
  const invalid = text.trim().length > 0 && parsed === null;

  const commit = (hhmm: string) => {
    committedRef.current = hhmm;
    if (!controlled) setInternal(hhmm);
    onChange?.(hhmm);
    setText(formatTime12(hhmm));
  };

  const handleText = (next: string) => {
    setText(next);
    const n = parseTyped(next);
    if (n) {
      committedRef.current = n;
      if (!controlled) setInternal(n);
      onChange?.(n);
    }
  };

  const handleBlur = () => {
    // Snap valid drafts to canonical display; revert invalid ones.
    const n = parseTyped(text);
    if (n) setText(formatTime12(n));
    else if (committedRef.current) setText(formatTime12(committedRef.current));
  };

  // Spinner position derives from the live draft when valid, else the value.
  const effective = parsed || normalize24(current) || "10:00";
  const effH24 = parseInt(effective.slice(0, 2), 10);
  const effMin = effective.slice(3, 5);
  const effH12 = effH24 % 12 || 12;
  const effMer = effH24 >= 12 ? "PM" : "AM";

  const hours = useMemo(
    () => ["12", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"],
    []
  );
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => pad(i)), []);

  const pick = (h12: number, min: string, mer: string) => {
    const h24 = (h12 % 12) + (mer === "PM" ? 12 : 0);
    commit(`${pad(h24)}:${min}`);
  };

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

  // Scroll spinner columns to the current selection when opened.
  useEffect(() => {
    if (!open) return;
    for (const ref of [hourColRef, minColRef]) {
      ref.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: "nearest" });
    }
  }, [open ]);

  const ring = invalid
    ? "border-rose-300 focus-within:ring-rose-500/20 focus-within:border-rose-400"
    : accent === "green"
      ? "border-slate-200 focus-within:ring-green-500/20 focus-within:border-green-500"
      : "border-slate-200 focus-within:ring-blue-500/20 focus-within:border-blue-500";
  const selCell =
    accent === "green"
      ? "bg-green-600 text-white font-bold shadow-sm"
      : "bg-blue-600 text-white font-bold shadow-sm";
  const cellHover =
    accent === "green"
      ? "text-slate-700 hover:bg-green-50 hover:text-green-700"
      : "text-slate-700 hover:bg-blue-50 hover:text-blue-700";

  const compact = size === "sm";
  const colCls = `${compact ? "max-h-36" : "max-h-52"} overflow-y-auto space-y-0.5`;
  const cellCls = (active: boolean) =>
    [
      `w-full ${compact ? "px-0.5 py-0.5 text-xs" : "px-2 py-1.5 text-sm"} rounded-lg tabular-nums transition-colors`,
      active ? selCell : cellHover,
    ].join(" ");

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={parsed || ""} required={required} />}
      <div
        className={`w-full ${size === "sm" ? "h-8" : "h-10"} rounded-xl border bg-white transition-all flex items-center min-w-0 focus-within:ring-2 focus-within:outline-none ${ring}`}
      >
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-label="Start time — type any time, e.g. 10:10 AM"
          placeholder={placeholder}
          value={text}
          onChange={(e) => handleText(e.target.value)}
          onBlur={handleBlur}
          className={`flex-1 min-w-0 bg-transparent ${size === "sm" ? "px-2.5 text-xs" : "px-3 text-sm"} font-semibold tabular-nums text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none`}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Open time picker"
          className="shrink-0 h-full px-2.5 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <Clock className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div role="dialog" aria-label="Choose a time" className={`absolute z-30 mt-2 left-0 ${compact ? "w-[148px] p-1" : "w-[248px] p-2.5"} rounded-2xl border border-slate-200 bg-white shadow-xl`}>
          <div className={`grid grid-cols-3 ${compact ? "gap-0.5" : "gap-1.5"}`}>
            <span aria-hidden="true" className="text-center text-[10px] uppercase font-bold tracking-wide text-slate-400 pb-0.5">Hr</span>
            <span aria-hidden="true" className="text-center text-[10px] uppercase font-bold tracking-wide text-slate-400 pb-0.5">Min</span>
            <span aria-hidden="true" className="text-center text-[10px] uppercase font-bold tracking-wide text-slate-400 pb-0.5">AM / PM</span>
            <div ref={hourColRef} className={colCls}>
              {hours.map((h) => {
                const active = parseInt(h, 10) === effH12;
                return (
                  <button
                    key={h}
                    type="button"
                    data-sel={active || undefined}
                    onClick={() => pick(parseInt(h, 10), effMin, effMer)}
                    className={cellCls(active)}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
            <div ref={minColRef} className={colCls}>
              {minutes.map((m) => {
                const active = m === effMin;
                return (
                  <button
                    key={m}
                    type="button"
                    data-sel={active || undefined}
                    onClick={() => pick(effH12, m, effMer)}
                    className={cellCls(active)}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            <div className={colCls}>
              {(["AM", "PM"] as const).map((mer) => {
                const active = mer === effMer;
                return (
                  <button
                    key={mer}
                    type="button"
                    data-sel={active || undefined}
                    onClick={() => pick(effH12, effMin, mer)}
                    className={cellCls(active)}
                  >
                    {mer}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={`mt-1.5 w-full ${compact ? "h-7 text-[11px]" : "h-9 text-xs"} rounded-xl font-bold text-white shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] ${
              accent === "green" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
