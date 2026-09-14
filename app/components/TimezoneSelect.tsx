import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Search } from "lucide-react";
import {
  detectLocalTimezone,
  formatTimeInTimezone,
  formatUtcOffsetLabel,
  getAllTimezones,
  getOffsetMinutes,
  timezoneCity,
  timezoneRegion,
} from "~/utils/timezones";

type Props = {
  id?: string;
  /** Form field name for the hidden input. Omit for controlled-only use. */
  name?: string;
  value: string;
  onChange: (tz: string) => void;
  /** Tailwind accent, e.g. "green" (poll) or "blue" (signup). */
  accent?: "green" | "blue";
};

const ACCENT = {
  green: {
    ring: "focus-within:ring-green-500/20 focus-within:border-green-500",
    active: "bg-green-50 border-green-600 text-green-700",
    activeSub: "text-green-600",
    hover: "hover:bg-green-50",
    pinned: "bg-green-100/70 border-green-200",
  },
  blue: {
    ring: "focus-within:ring-blue-500/20 focus-within:border-blue-500",
    active: "bg-blue-50 border-blue-600 text-blue-700",
    activeSub: "text-blue-600",
    hover: "hover:bg-blue-50",
    pinned: "bg-blue-100/70 border-blue-200",
  },
} as const;

type Entry = { tz: string; offsetMin: number | null; offset: string | null };

function matchesQuery(e: Entry, q: string): boolean {
  const hay =
    `${e.tz.replace(/_/g, " ")} ${timezoneCity(e.tz)} ${timezoneRegion(e.tz)} ${e.offset ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

function groupLabel(offset: string | null, minutes: number | null): string {
  if (!offset) return "Other";
  // "GMT+03:00" -> "GMT+3:00" (NNGroup-style offset headers).
  const short = offset
    .replace("+0", "+")
    .replace("-0", "-");
  void minutes;
  return short;
}

function RowTime({ tz, now }: { tz: string; now: number }) {
  const time = useMemo(() => formatTimeInTimezone(tz, new Date(now)), [tz, now]);
  if (!time) return null;
  return <span className="text-xs tabular-nums shrink-0 font-medium">{time}</span>;
}

export default function TimezoneSelect({ id, name, value, onChange, accent = "green" }: Props) {
  const a = ACCENT[accent];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [detected, setDetected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => getAllTimezones(), []);

  useEffect(() => {
    setDetected(detectLocalTimezone());
  }, []);

  // Live clocks for the rows (30s is plenty; parent shows its own 10s clock).
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [open ]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open ]);

  const at = useMemo(() => new Date(now), [now]);

  const entries: Entry[] = useMemo(
    () =>
      all.map((tz) => ({
        tz,
        offsetMin: getOffsetMinutes(tz, at),
        offset: formatUtcOffsetLabel(tz, at),
      })),
    [all, at]
  );

  const q = query.trim();
  const filtered = useMemo(
    () => (q ? entries.filter((e) => matchesQuery(e, q)) : entries),
    [entries, q]
  );

  const showDetectedPinned =
    detected && !q && all.includes(detected) ? detected : null;

  /** Selectable rows (no headers), pinned first, then grouped by GMT offset. */
  const selectable: Entry[] = useMemo(() => {
    const rest = filtered.filter((e) => e.tz !== showDetectedPinned);
    // Selected value always stays visible even while filtering.
    if (q && value && !rest.some((e) => e.tz === value)) {
      const found = entries.find((e) => e.tz === value);
      if (found) rest.unshift(found);
    }
    rest.sort(
      (x, y) =>
        (x.offsetMin ?? 9999) - (y.offsetMin ?? 9999) ||
        timezoneCity(x.tz).localeCompare(timezoneCity(y.tz))
    );
    const pinned = showDetectedPinned
      ? entries.find((e) => e.tz === showDetectedPinned)
      : undefined;
    return [...(pinned ? [pinned] : []), ...rest];
  }, [filtered, showDetectedPinned, q, value, entries]);

  useEffect(() => {
    setHighlight(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [query ]);

  const pick = (tz: string) => {
    onChange(tz);
    setOpen(false);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, selectable.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = selectable[highlight];
      if (row) pick(row.tz);
    }
  };

  const selectedOffset = formatUtcOffsetLabel(value);
  const selectedCity = value === "UTC" ? "UTC" : timezoneCity(value);

  // Render rows with sticky GMT group headers. Pinned + selected-while-
  // filtering render outside groups so they are never buried.
  const renderList = () => {
    if (selectable.length === 0) {
      return (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          No timezones match “{q}”.
        </div>
      );
    }
    let lastGroup = "";
    let flat = -1;
    return selectable.map((e) => {
      flat += 1;
      const idx = flat;
      const isPinned = e.tz === showDetectedPinned;
      const isSelected = e.tz === value;
      const isActive = idx === highlight;
      const selected = isSelected || isActive;
      const group = groupLabel(e.offset, e.offsetMin);
      const showHeader = !q && !isPinned && group !== lastGroup;
      if (showHeader) lastGroup = group;
      // Highlighted / hovered rows get the pill look (tinted bg + accent
      // border + accent text) instead of a solid fill.
      const solid = selected;
      return (
        <div key={e.tz + (isPinned ? "-pinned" : "")}>
          {isPinned ? (
            <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Your timezone · auto-detected
            </div>
          ) : null}
          {showHeader ? (
            <div
              aria-hidden="true"
              className="sticky top-0 z-10 px-3 py-1 mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/95 backdrop-blur rounded-lg"
            >
              {group}
            </div>
          ) : null}
          <button
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => pick(e.tz)}
            onMouseEnter={() => setHighlight(idx)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left text-sm transition-colors ${isPinned ? "mb-1" : ""} ${
              selected
                ? `${a.active}`
                : isPinned
                  ? `text-slate-800 ${a.pinned}`
                  : `border-transparent text-slate-800 ${a.hover}`
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${selected || isPinned ? "font-semibold" : "font-medium"}`}>
                {e.tz === "UTC" ? "UTC" : timezoneCity(e.tz)}
                <span className={`font-normal tabular-nums ${solid ? a.activeSub : "text-slate-400"}`}>
                  {" "}({e.offset ?? "GMT"})
                </span>
              </span>
              <span className={`block text-[11px] truncate ${solid ? a.activeSub : "text-slate-400"}`}>
                {e.tz.replace(/_/g, " ")}
              </span>
            </span>
            <span className={solid ? a.activeSub : "text-slate-500"}>
              <RowTime tz={e.tz} now={now} />
            </span>
            {isSelected ? <Check className="w-4 h-4 shrink-0" aria-hidden="true" /> : null}
          </button>
          {isPinned ? (
            <div className="px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              All timezones · by GMT offset
            </div>
          ) : null}
        </div>
      );
    });
  };

  return (
    <div ref={rootRef} className="relative">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 truncate pl-4 pr-10 py-3 rounded-xl border border-slate-200/90 text-sm font-medium bg-white cursor-pointer transition-all text-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-0 ${a.ring}`}
      >
        <Globe className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {selectedCity}
          {selectedOffset ? (
            <span className="text-slate-400 font-normal"> · {selectedOffset}</span>
          ) : null}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="absolute z-50 mt-2 w-full min-w-[16rem] max-w-[min(28rem,90vw)] rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 focus-within:border-slate-300 focus-within:bg-white transition-colors">
              <Search className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search city, region, or GMT offset…"
                aria-label="Search timezones"
                className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          </div>

          <div ref={listRef} role="listbox" aria-label="Timezones" className="max-h-72 overflow-y-auto p-1.5">
            {renderList()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
