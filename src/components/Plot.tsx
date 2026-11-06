import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./ui";

export interface Series {
  name: string;
  x: number[];
  y: number[];
  color: string;
  width?: number;
  dash?: string;
  hidden?: boolean;
  fill?: boolean;
  axis?: "y" | "y2";
}

export interface VMarker {
  x: number;
  label?: string;
  color?: string;
  dash?: boolean;
}

export interface PlotProps {
  series: Series[];
  height?: number;
  xLog?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  y2Domain?: [number, number];
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
  y2Fmt?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  y2Label?: string;
  vMarkers?: VMarker[];
  hMarkers?: { y: number; label?: string; color?: string }[];
  points?: { x: number; y: number; label?: string; color?: string }[];
  shade?: [number, number];
  variant?: "default" | "instrument";
  legend?: boolean;
  className?: string;
  tooltipX?: (v: number) => string;
}

export function shortNum(v: number): string {
  const a = Math.abs(v);
  const t = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? +x.toFixed(1) + "" : +x.toFixed(2) + "");
  if (a >= 1e9) return t(v / 1e9) + "G";
  if (a >= 1e6) return t(v / 1e6) + "M";
  if (a >= 1e3) return t(v / 1e3) + "k";
  if (a === 0) return "0";
  if (a < 1) return +v.toPrecision(2) + "";
  return t(v);
}

function niceTicks(min: number, max: number, count = 6): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

function extent(series: Series[], key: "x" | "y", axis?: "y" | "y2"): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const s of series) {
    if (s.hidden || (axis && (s.axis ?? "y") !== axis)) continue;
    for (const v of s[key]) {
      if (!isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  return [lo, hi];
}

function nearestIdx(xs: number[], x: number): number {
  let lo = 0,
    hi = xs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] < x) lo = m;
    else hi = m;
  }
  return Math.abs(xs[lo] - x) < Math.abs(xs[hi] - x) ? lo : hi;
}

export function Plot(p: PlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const h = p.height ?? 260;
  const inst = p.variant === "instrument";
  const hasY2 = p.series.some((s) => s.axis === "y2" && !s.hidden);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(200, e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const m = { l: 52, r: hasY2 ? 52 : 14, t: 10, b: p.xLabel ? 36 : 24 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;

  const xd = p.xDomain ?? extent(p.series, "x");
  const yd0 = p.yDomain ?? extent(p.series, "y", "y");
  const yd: [number, number] = p.yDomain ? yd0 : [yd0[0] - (yd0[1] - yd0[0]) * 0.05, yd0[1] + (yd0[1] - yd0[0]) * 0.05];
  const y2d = p.y2Domain ?? extent(p.series, "y", "y2");

  const sx = useMemo(() => {
    if (p.xLog) {
      const a = Math.log10(Math.max(xd[0], 1e-12)),
        b = Math.log10(Math.max(xd[1], 1e-12));
      return (v: number) => m.l + ((Math.log10(Math.max(v, 1e-12)) - a) / (b - a)) * pw;
    }
    return (v: number) => m.l + ((v - xd[0]) / (xd[1] - xd[0])) * pw;
  }, [p.xLog, xd[0], xd[1], pw, m.l]);
  const invX = (px: number) => {
    const t = (px - m.l) / pw;
    if (p.xLog) {
      const a = Math.log10(xd[0]),
        b = Math.log10(xd[1]);
      return Math.pow(10, a + t * (b - a));
    }
    return xd[0] + t * (xd[1] - xd[0]);
  };
  const sy = (v: number) => m.t + (1 - (v - yd[0]) / (yd[1] - yd[0])) * ph;
  const sy2 = (v: number) => m.t + (1 - (v - y2d[0]) / (y2d[1] - y2d[0])) * ph;

  const xTicks = useMemo(() => {
    if (!p.xLog) return { major: niceTicks(xd[0], xd[1], Math.max(3, Math.floor(pw / 90))), minor: [] as number[] };
    const major: number[] = [],
      minor: number[] = [];
    for (let k = Math.floor(Math.log10(xd[0])); k <= Math.ceil(Math.log10(xd[1])); k++) {
      const d = Math.pow(10, k);
      if (d >= xd[0] * 0.999 && d <= xd[1] * 1.001) major.push(d);
      for (let j = 2; j < 10; j++) {
        const v = j * d;
        if (v > xd[0] && v < xd[1]) minor.push(v);
      }
    }
    return { major, minor };
  }, [p.xLog, xd[0], xd[1], pw]);
  const yTicks = niceTicks(yd[0], yd[1], Math.max(3, Math.floor(ph / 42)));
  const y2Ticks = hasY2 ? niceTicks(y2d[0], y2d[1], Math.max(3, Math.floor(ph / 42))) : [];

  const paths = p.series
    .filter((s) => !s.hidden)
    .map((s) => {
      const Y = s.axis === "y2" ? sy2 : sy;
      let d = "";
      let pen = false;
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i],
          y = s.y[i];
        if (!isFinite(x) || !isFinite(y) || (p.xLog && x <= 0)) {
          pen = false;
          continue;
        }
        const X = sx(x).toFixed(1),
          YY = Y(y).toFixed(1);
        d += (pen ? "L" : "M") + X + " " + YY;
        pen = true;
      }
      let area = "";
      if (s.fill && d) area = d + `L${sx(s.x[s.x.length - 1]).toFixed(1)} ${m.t + ph}L${sx(s.x[0]).toFixed(1)} ${m.t + ph}Z`;
      return { s, d, area };
    });

  const gridC = inst ? "#13361f" : "var(--grid)";
  const axisC = inst ? "#5fbf7a" : "var(--muted)";
  const clipId = useMemo(() => "c" + Math.random().toString(36).slice(2), []);

  const hx = hover != null ? invX(hover) : null;
  const tip =
    hx != null
      ? p.series
          .filter((s) => !s.hidden && s.x.length)
          .map((s) => {
            const i = nearestIdx(s.x, hx);
            return { s, x: s.x[i], y: s.y[i] };
          })
      : [];

  return (
    <div ref={ref} className={cx("relative w-full select-none", p.className)} style={{ minHeight: h }}>
      <svg
        width={w}
        height={h}
        className={cx("block rounded-lg", inst && "bg-[#020805]")}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = e.clientX - r.left;
          setHover(x >= m.l && x <= m.l + pw ? x : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={m.l} y={m.t} width={pw} height={ph} />
          </clipPath>
        </defs>
        {p.shade && (
          <rect
            x={sx(p.shade[0])}
            y={m.t}
            width={Math.max(0, sx(p.shade[1]) - sx(p.shade[0]))}
            height={ph}
            fill="var(--accent)"
            opacity={0.07}
            clipPath={`url(#${clipId})`}
          />
        )}
        {xTicks.minor.map((v) => (
          <line key={"m" + v} x1={sx(v)} x2={sx(v)} y1={m.t} y2={m.t + ph} stroke={gridC} strokeWidth={0.6} opacity={0.6} />
        ))}
        {xTicks.major.map((v) => (
          <g key={"x" + v}>
            <line x1={sx(v)} x2={sx(v)} y1={m.t} y2={m.t + ph} stroke={gridC} />
            <text x={sx(v)} y={m.t + ph + 15} textAnchor="middle" fontSize={10.5} fill={axisC} className="num">
              {p.xFmt ? p.xFmt(v) : shortNum(v)}
            </text>
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={"y" + v}>
            <line x1={m.l} x2={m.l + pw} y1={sy(v)} y2={sy(v)} stroke={gridC} />
            <text x={m.l - 6} y={sy(v) + 3.5} textAnchor="end" fontSize={10.5} fill={axisC} className="num">
              {p.yFmt ? p.yFmt(v) : shortNum(v)}
            </text>
          </g>
        ))}
        {y2Ticks.map((v) => (
          <text key={"y2" + v} x={m.l + pw + 6} y={sy2(v) + 3.5} fontSize={10.5} fill={axisC} className="num">
            {p.y2Fmt ? p.y2Fmt(v) : shortNum(v)}
          </text>
        ))}
        <rect x={m.l} y={m.t} width={pw} height={ph} fill="none" stroke={inst ? "#1f5a33" : "var(--line-2)"} />
        {p.xLabel && (
          <text x={m.l + pw / 2} y={h - 4} textAnchor="middle" fontSize={11} fill={axisC}>
            {p.xLabel}
          </text>
        )}
        {p.yLabel && (
          <text transform={`translate(12 ${m.t + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill={axisC}>
            {p.yLabel}
          </text>
        )}
        {p.y2Label && hasY2 && (
          <text transform={`translate(${w - 8} ${m.t + ph / 2}) rotate(90)`} textAnchor="middle" fontSize={11} fill={axisC}>
            {p.y2Label}
          </text>
        )}
        <g clipPath={`url(#${clipId})`}>
          {paths.map(({ s, area }) => area && <path key={"a" + s.name} d={area} fill={s.color} opacity={0.12} />)}
          {paths.map(({ s, d }) => (
            <path
              key={s.name}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 1.6}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              style={inst ? { filter: `drop-shadow(0 0 3px ${s.color})` } : undefined}
            />
          ))}
          {p.hMarkers?.map((hm, i) => (
            <g key={"h" + i}>
              <line x1={m.l} x2={m.l + pw} y1={sy(hm.y)} y2={sy(hm.y)} stroke={hm.color ?? "var(--muted)"} strokeDasharray="4 4" />
              {hm.label && (
                <text x={m.l + pw - 4} y={sy(hm.y) - 4} textAnchor="end" fontSize={10.5} fill={hm.color ?? "var(--muted)"}>
                  {hm.label}
                </text>
              )}
            </g>
          ))}
          {p.vMarkers?.map((vm, i) => (
            <g key={"v" + i}>
              <line x1={sx(vm.x)} x2={sx(vm.x)} y1={m.t} y2={m.t + ph} stroke={vm.color ?? "var(--accent)"} strokeDasharray={vm.dash === false ? undefined : "4 4"} />
              {vm.label && (
                <text x={sx(vm.x) + 4} y={m.t + 12 + (i % 3) * 13} fontSize={10.5} fill={vm.color ?? "var(--accent)"}>
                  {vm.label}
                </text>
              )}
            </g>
          ))}
          {p.points?.map((pt, i) => (
            <g key={"p" + i}>
              <circle cx={sx(pt.x)} cy={sy(pt.y)} r={3.5} fill={pt.color ?? "var(--rf)"} stroke="var(--panel)" strokeWidth={1} />
              {pt.label && (
                <text x={sx(pt.x) + 6} y={sy(pt.y) - 6} fontSize={10.5} fill={pt.color ?? "var(--rf)"}>
                  {pt.label}
                </text>
              )}
            </g>
          ))}
        </g>
        {hover != null && (
          <g pointerEvents="none">
            <line x1={hover} x2={hover} y1={m.t} y2={m.t + ph} stroke={axisC} strokeWidth={0.8} />
            {tip.map((t) => {
              const Y = t.s.axis === "y2" ? sy2 : sy;
              return isFinite(t.y) ? <circle key={t.s.name} cx={sx(t.x)} cy={Y(t.y)} r={3} fill={t.s.color} /> : null;
            })}
          </g>
        )}
      </svg>
      {hover != null && tip.length > 0 && hx != null && (
        <div
          className="absolute pointer-events-none rounded-lg border border-line bg-panel/95 backdrop-blur px-2.5 py-1.5 text-[11.5px] shadow-lg num"
          style={{ left: Math.min(hover + 12, w - 190), top: m.t + 6, minWidth: 150 }}
        >
          <div className="text-muted mb-0.5">{p.tooltipX ? p.tooltipX(tip[0].x) : p.xFmt ? p.xFmt(tip[0].x) : shortNum(tip[0].x)}</div>
          {tip.map((t) => (
            <div key={t.s.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: t.s.color }} />
              <span className="text-fg2 truncate flex-1">{t.s.name}</span>
              <span className="font-medium">{isFinite(t.y) ? (t.s.axis === "y2" && p.y2Fmt ? p.y2Fmt(t.y) : p.yFmt ? p.yFmt(t.y) : t.y.toFixed(1)) : "—"}</span>
            </div>
          ))}
        </div>
      )}
      {p.legend && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 px-1">
          {p.series.map((s) => (
            <span key={s.name} className={cx("inline-flex items-center gap-1.5 text-[11.5px]", s.hidden ? "opacity-40" : "text-fg2")}>
              <span className="h-[3px] w-4 rounded" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
