// Zero-dependency SVG charts for /pulse. No new npm deps, SSR-safe.
import { useState } from "react";

export function Sparkline({
  values,
  stroke = "#2563eb",
  width = 120,
  height = 32,
  label,
}: {
  values: number[];
  stroke?: string;
  width?: number;
  height?: number;
  label?: string;
}) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => {
    const x = Math.round(i * step * 10) / 10;
    const y = Math.round((height - 3 - (v / max) * (height - 8)) * 10) / 10;
    return `${x},${y}`;
  });
  const line = pts.join(" ");
  const area = values.length > 0 ? `0,${height} ${line} ${width},${height}` : "";
  const [hover, setHover] = useState<number | null>(null);
  const pick = (clientX: number, target: Element) => {
    const r = (target as Element).getBoundingClientRect();
    if (r.width <= 0 || values.length === 0) return null;
    const ratio = (clientX - r.left) / r.width;
    const idx = Math.round(ratio * (values.length - 1));
    return Math.max(0, Math.min(values.length - 1, idx));
  };
  return (
    <div className="relative inline-block">
      {hover !== null && values[hover] !== undefined && (
        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold tabular-nums text-white shadow-lg z-10">
          {values[hover]}
        </div>
      )}
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? `Trend: ${values.join(", ")}`}
      className="overflow-visible block"
      onMouseMove={(e) => setHover(pick(e.clientX, e.currentTarget))}
      onMouseLeave={() => setHover(null)}
    >
      {area && <polygon points={area} fill={stroke} opacity={0.12} />}
      {line && (
        <polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {values.map((v, i) => {
        const x = i * step;
        const y = height - 3 - (v / max) * (height - 8);
        if (hover === i) {
          return <circle key={i} cx={x} cy={y} r={4} fill={stroke} opacity={0.35} />;
        }
        return i === values.length - 1 ? (
          <circle key={i} cx={x} cy={y} r={2.5} fill={stroke} />
        ) : null;
      })}
    </svg>
    </div>
  );
}

export function DailyChart({
  days,
  series,
}: {
  days: Array<{ label: string; events: number; signups: number; votes: number }>;
  series: Array<"events" | "signups" | "votes">;
}) {
  const colors: Record<string, string> = { events: "#2563eb", signups: "#22c55e", votes: "#a855f7" };
  const W = 720;
  const H = 230;
  const PAD_L = 36;
  const PAD_B = 28;
  const PAD_T = 14;
  const innerW = W - PAD_L - 10;
  const innerH = H - PAD_T - PAD_B;
  const totals = days.map((d) => series.reduce((s, k) => s + d[k], 0));
  const max = Math.max(1, ...totals);
  // Nice ceiling + ticks: round max up to 1/2/2.5/5 * 10^k, then ~4 gridlines.
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const ceil = nice * pow;
  const stepPow = Math.pow(10, Math.floor(Math.log10(ceil / 4)));
  const stepNorm = ceil / 4 / stepPow;
  const step = (stepNorm <= 1 ? 1 : stepNorm <= 2 ? 2 : stepNorm <= 2.5 ? 2.5 : 5) * stepPow;
  const yTicks: number[] = [];
  for (let t = 0; t <= ceil + 1e-9; t += step) yTicks.push(Math.round(t * 100) / 100);
  const n = days.length;
  const slotW = innerW / Math.max(1, n);
  const barW = Math.max(4, Math.min(22, slotW * 0.52));
  const topR = Math.min(5, barW / 2.5);
  // Rect with rounded TOP corners only (rx rounds all four, which carves
  // notches into stacked joints — hence a path for the top segment).
  const topRoundedPath = (x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M ${x},${y + h} V ${y + rr} Q ${x},${y} ${x + rr},${y} H ${x + w - rr} Q ${x + w},${y} ${x + w},${y + rr} V ${y + h} Z`;
  };
  const yFor = (v: number) => PAD_T + innerH - (v / ceil) * innerH;
  const baseline = yFor(0);
  const labelEvery = n <= 10 ? 1 : n <= 31 ? Math.ceil(n / 8) : Math.ceil(n / 10);
  // Precompute label indices: every labelEvery-th tick, plus the last day.
  // If the last day is too close to the previous tick (e.g. only 1 slot away)
  // the two texts overlap (see "Sep 15 / Sep 16"), so drop the
  // second-to-last tick and keep the final label instead.
  const labelIdx = new Set<number>();
  for (let i = 0; i < n; i += labelEvery) labelIdx.add(i);
  if (n > 1) {
    const lastRegular = Math.floor((n - 1) / labelEvery) * labelEvery;
    const gap = n - 1 - lastRegular;
    if (gap !== 0) {
      const minGap = labelEvery === 1 ? 1 : 2;
      if (gap < minGap) labelIdx.delete(lastRegular);
      labelIdx.add(n - 1);
    }
  }

  // 7-day moving average of total activity (subtle slate line).
  const avg = totals.map((_, i) => {
    const win = totals.slice(Math.max(0, i - 6), i + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
  const avgPts = avg
    .map((v, i) => `${Math.round((PAD_L + i * slotW + slotW / 2) * 10) / 10},${Math.round(yFor(v) * 10) / 10}`)
    .join(" ");

  // Immediate custom tooltip (native <title> has a ~1s delay). A transparent
  // rect per day captures hover across the full slot — including zero days —
  // and state updates render the card synchronously.
  const [hover, setHover] = useState<number | null>(null);
  const hoverDay = hover !== null ? days[hover] : null;
  const hoverCx = hover !== null ? PAD_L + hover * slotW + slotW / 2 : 0;
  const hoverLeftPct = (hoverCx / W) * 100;
  // Keep the card on-screen: anchor left / center / right by horizontal slot.
  const hoverRatio = hover !== null ? hoverCx / W : 0.5;
  const hoverTransform =
    hoverRatio < 0.22 ? "translateX(-4%)" : hoverRatio > 0.78 ? "translateX(-96%)" : "translateX(-50%)";

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="relative block h-auto w-full min-w-[540px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Daily activity over ${n} days, peak ${max} actions in a day`}
        className="block h-auto w-full"
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - 6} y1={yFor(t)} y2={yFor(t)} stroke="#e8edf3" strokeWidth={1} />
            <text x={PAD_L - 7} y={yFor(t) + 3.5} textAnchor="end" fontSize={10.5} fill="#94a3b8" className="tabular-nums">
              {t}
            </text>
          </g>
        ))}
        {n > 1 && (
          <polyline
            points={avgPts}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            strokeLinecap="round"
            opacity={0.7}
          />
        )}
        {days.map((d, i) => {
          const cx = PAD_L + i * slotW + slotW / 2;
          const x = cx - barW / 2;
          const total = totals[i];
          // Stacked bar, bottom-up. Joints stay seamless: square corners
          // everywhere except the very top (path with rounded top corners),
          // and each upper segment overlaps the one below by 1px so no
          // antialiased hairline seam shows between colors.
          const nonEmpty = series.filter((s) => d[s] > 0);
          const topKey = nonEmpty[nonEmpty.length - 1];
          let acc = 0;
          const isHover = hover === i;
          return (
            <g key={d.label + i}>
              {isHover && (
                <rect
                  x={PAD_L + i * slotW + 1}
                  y={PAD_T}
                  width={Math.max(0, slotW - 2)}
                  height={innerH}
                  rx={6}
                  fill="#0f172a"
                  opacity={0.05}
                />
              )}
              {total === 0 ? (
                <line
                  x1={x}
                  x2={x + barW}
                  y1={baseline - 0.5}
                  y2={baseline - 0.5}
                  stroke={isHover ? "#94a3b8" : "#e2e8f0"}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              ) : (
                series.map((s, si) => {
                  const v = d[s];
                  const y0 = yFor(acc);
                  acc += v;
                  const y1 = yFor(acc);
                  if (v <= 0) return null;
                  const isTop = s === topKey;
                  const isBottom = si === 0 || series.slice(0, si).every((k) => d[k] <= 0);
                  const y = y1;
                  const h = Math.max(1.5, y0 - y1 + (isBottom ? 0 : 1));
                  return isTop ? (
                    <path key={s} d={topRoundedPath(x, y, barW, h, topR)} fill={colors[s]} opacity={isHover || hover === null ? 1 : 0.35} />
                  ) : (
                    <rect key={s} x={x} y={y} width={barW} height={h} fill={colors[s]} opacity={isHover || hover === null ? 1 : 0.35} />
                  );
                })
              )}
              {labelIdx.has(i) && (
                <text x={cx} y={H - 9} textAnchor="middle" fontSize={10.5} fill="#94a3b8">
                  {d.label}
                </text>
              )}
              {/* Full-slot hover target: makes empty days hoverable, zero delay. */}
              <rect
                x={PAD_L + i * slotW}
                y={0}
                width={slotW}
                height={H - PAD_B}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseMove={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hoverDay && (
        <div
          className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-xl"
          style={{ left: `${hoverLeftPct}%`, transform: hoverTransform }}
        >
          <div className="font-bold">{hoverDay.label}</div>
          <div className="mt-1 space-y-0.5 tabular-nums">
            {series.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colors[s] }} />
                <span className="capitalize text-slate-300">{s}</span>
                <span className="ml-auto pl-3 font-bold">{hoverDay[s]}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 border-t border-white/15 pt-1 mt-1">
              <span className="text-slate-300">Total</span>
              <span className="ml-auto pl-3 font-bold">{totals[hover!]}</span>
            </div>
            {avg[hover!] !== undefined && (
              <div className="text-[10px] text-slate-400 tabular-nums">
                7-day avg {avg[hover!].toFixed(1)}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export function Donut({
  segments,
  size = 140,
  thickness = 22,
  label,
}: {
  segments: Array<{ value: number; color: string; name: string }>;
  size?: number;
  thickness?: number;
  label?: string;
}) {
  const realTotal = segments.reduce((s, x) => s + x.value, 0);
  const total = realTotal || 1;
  const R = (size - thickness) / 2;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? "Share donut"}>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {segments.map((s) => {
          const frac = s.value / total;
          const dash = `${frac * C} ${C - frac * C}`;
          const rot = (acc / total) * 360;
          acc += s.value;
          return s.value > 0 ? (
            <circle
              key={s.name}
              cx={size / 2}
              cy={size / 2}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              transform={`rotate(${-90 + rot} ${size / 2} ${size / 2})`}
              strokeLinecap="butt"
            >
              <title>{`${s.name}: ${s.value}`}</title>
            </circle>
          ) : null;
        })}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={20} fontWeight={800} fill="#0f172a">
          {realTotal}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={10} fill="#64748b">
          total
        </text>
      </svg>
      <ul className="space-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.name} className="flex items-center gap-2 text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="font-semibold text-slate-800">{s.value}</span>
            <span>{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HBar({
  pct,
  color = "#2563eb",
  label,
}: {
  pct: number;
  color?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="h-2 rounded-full bg-slate-100 overflow-hidden"
      role="img"
      aria-label={label ?? `${clamped}%`}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}
