import { useMemo, type ReactNode } from "react";
import { ArrowRight, BookOpen, CircleAlert, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { useSim, useStore } from "../lib/store";
import { BLOCKS, DOMAIN_COLOR, type Domain } from "../lib/blocks";
import { fmtF, fmtFarad, fmtOhm, fmtTime } from "../lib/format";
import { FieldControl } from "../components/fields";
import { Badge, Button, Card, FreqField, Segmented, Stat, cx } from "../components/ui";
import type { Derived, Issue, Snapshot } from "../lib/types";

// ───────────────────────── SVG primitives ─────────────────────────

const flowDur = (hz: number) => `${Math.min(3.4, Math.max(0.45, 3.2 - 0.55 * (Math.log10(Math.max(hz, 1)) - 6))).toFixed(2)}s`;

function Wire({
  d,
  color,
  active = true,
  hz,
  label,
  lx,
  ly,
  anchor = "middle",
  dashed,
  arrow = true,
  width = 1.6,
}: {
  d: string;
  color: string;
  active?: boolean;
  hz?: number;
  label?: string;
  lx?: number;
  ly?: number;
  anchor?: "start" | "middle" | "end";
  dashed?: boolean;
  arrow?: boolean;
  width?: number;
}) {
  const marker = arrow ? `url(#arr-${color.replace(/[^a-z0-9]/gi, "")})` : undefined;
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={width} opacity={active ? 0.55 : 0.18} strokeDasharray={dashed ? "3 4" : undefined} markerEnd={marker} />
      {active && hz != null && !dashed && (
        <path d={d} fill="none" stroke={color} strokeWidth={width + 0.6} className="wire-flow" style={{ ["--flow-dur" as string]: flowDur(hz) }} strokeLinecap="round" />
      )}
      {label && lx != null && ly != null && (
        <text x={lx} y={ly} textAnchor={anchor} fontSize={10.5} fill={active ? color : "var(--muted)"} className="num" stroke="var(--panel-2)" strokeWidth={4} paintOrder="stroke" fontWeight={500}>
          {label}
        </text>
      )}
    </g>
  );
}

function Block({
  id,
  x,
  y,
  w,
  h,
  title,
  sub,
  dim,
  sel,
  onSel,
  warn,
  children,
  ty,
}: {
  ty?: number;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  dim?: boolean;
  sel: boolean;
  onSel: (id: string) => void;
  warn?: "error" | "warn" | null;
  children?: ReactNode;
}) {
  const info = BLOCKS[id];
  const c = DOMAIN_COLOR[info?.domain ?? "ctl"];
  return (
    <g className="cursor-pointer group" onClick={() => onSel(id)}>
      <title>{info?.title}</title>
      {sel && <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={12} fill="none" stroke={c} strokeWidth={1} opacity={0.5} strokeDasharray="3 3" />}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={9}
        fill="var(--panel)"
        stroke={c}
        strokeWidth={sel ? 2.2 : 1.3}
        strokeDasharray={dim ? "4 3" : undefined}
        opacity={dim ? 0.55 : 1}
        style={sel ? { filter: `drop-shadow(0 0 8px color-mix(in srgb, ${c} 55%, transparent))` } : undefined}
        className="transition-all group-hover:brightness-125"
      />
      <rect x={x} y={y} width={4} height={h} rx={2} fill={c} opacity={dim ? 0.3 : 0.9} />
      <text x={x + w / 2 + 2} y={ty ?? (sub ? y + h / 2 - 2 : y + h / 2 + 4)} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={dim ? "var(--muted)" : "var(--fg)"}>
        {title}
      </text>
      {sub && (
        <text x={x + w / 2 + 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={10.5} fill={dim ? "var(--muted)" : c} className="num">
          {sub}
        </text>
      )}
      {warn && <circle cx={x + w - 6} cy={y + 6} r={4} fill={warn === "error" ? "var(--err)" : "var(--warn)"} />}
      {children}
    </g>
  );
}

function Pin({ x, y, name, side, color = "var(--muted)" }: { x: number; y: number; name: string; side: "l" | "r" | "t"; color?: string }) {
  const tx = side === "l" ? x + 9 : side === "r" ? x - 9 : x;
  const anchor = side === "l" ? "start" : side === "r" ? "end" : "middle";
  return (
    <g>
      <rect x={x - 4} y={y - 4} width={8} height={8} rx={1.5} fill="var(--panel-3)" stroke={color} strokeWidth={1} />
      <text x={tx} y={side === "t" ? y + 16 : y - 6} textAnchor={anchor} fontSize={9} fill="var(--muted)" fontFamily="var(--font-mono)">
        {name}
      </text>
    </g>
  );
}

function Resistor({ x, y, vertical, len = 34 }: { x: number; y: number; vertical?: boolean; len?: number }) {
  // zig-zag starting at (x,y)
  const n = 6,
    a = 5,
    seg = len / n;
  let d = `M${x} ${y}`;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * seg;
    const o = i % 2 ? -a : a;
    d += vertical ? ` L${x + o} ${y + s}` : ` L${x + s} ${y + o}`;
  }
  d += vertical ? ` L${x} ${y + len}` : ` L${x + len} ${y}`;
  return <path d={d} fill="none" stroke="var(--pfd)" strokeWidth={1.4} strokeLinejoin="round" />;
}

function Cap({ x, y }: { x: number; y: number }) {
  // vertical capacitor, top lead ends at y, plates at y..y+6
  return (
    <g stroke="var(--pfd)" strokeWidth={1.8}>
      <line x1={x - 9} x2={x + 9} y1={y} y2={y} />
      <line x1={x - 9} x2={x + 9} y1={y + 6} y2={y + 6} />
    </g>
  );
}

// ───────────────────────── Diagram ─────────────────────────

function worst(issues: Issue[], block: string): "error" | "warn" | null {
  const l = issues.filter((i) => i.block === block);
  if (l.some((i) => i.level === "error")) return "error";
  if (l.some((i) => i.level === "warn")) return "warn";
  return null;
}

function Diagram({ snap, sel, onSel }: { snap: Snapshot; sel: string | null; onSel: (id: string) => void }) {
  const sim = useSim();
  const fieldMap = useStore((s) => s.fieldMap);
  const setSettings = useStore((s) => s.setSettings);
  const go = useStore((s) => s.go);
  const d = snap.derived;
  const F = snap.fields;
  const lf = snap.settings.loop_filter;
  const powered = snap.pins.ce && !F.POWER_DOWN;
  const vcoOn = powered && !F.VCO_POWER_DOWN;
  const locked = sim ? sim.locked : true;
  const outA = sim ? sim.outputs_live : d.out_a_en && !snap.pins.muted && powered;
  const outB = outA && d.out_b_en;
  const fNow = sim && sim.f_vco_now > 0 ? sim.f_vco_now : d.f_vco;
  const core = sim ? sim.vco_core : d.vco_core;
  const calibrating = sim?.state === "calibrating";
  const ldOn = sim ? sim.ld_pin : false;
  const tcxo = snap.settings.ref_source === "tcxo";
  const muxLabel = fieldMap.MUX_OUT?.options.find((o) => o[0] === F.MUX_OUT)?.[1] ?? "";
  const W = (b: string) => worst(d.issues, b);
  const C = (dom: Domain) => DOMAIN_COLOR[dom];
  const fbHz = d.fb_fundamental ? d.f_vco : d.f_div_out;
  const colors = ["var(--ref)", "var(--pfd)", "var(--rf)", "var(--rf-2)", "var(--dig)", "var(--ctl)", "var(--muted)"];

  const sb = (b: string) => ({ sel: sel === b, onSel, warn: W(b) });

  return (
    <svg viewBox="0 0 1200 700" className="w-full h-auto select-none" style={{ maxHeight: "calc(100vh - 210px)" }}>
      <defs>
        {colors.map((c) => (
          <marker key={c} id={`arr-${c.replace(/[^a-z0-9]/gi, "")}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0 1 L10 5 L0 9 z" fill={c} />
          </marker>
        ))}
        <pattern id="chipgrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 L0 0 0 20" fill="none" stroke="var(--grid)" strokeWidth={0.6} />
        </pattern>
        <radialGradient id="ledglow">
          <stop offset="0%" stopColor="var(--ok)" stopOpacity={0.9} />
          <stop offset="100%" stopColor="var(--ok)" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* ── chip outline ── */}
      <rect x={150} y={30} width={840} height={640} rx={18} fill="var(--panel-2)" stroke="var(--line-2)" strokeWidth={1.5} />
      <rect x={150} y={30} width={840} height={640} rx={18} fill="url(#chipgrid)" opacity={0.6} />
      <text x={172} y={58} fontSize={13} fontWeight={700} fill="var(--fg)">
        8V97051
      </text>
      <text x={238} y={58} fontSize={10.5} fill="var(--muted)">
        широкополосный синтезатор 34.375 МГц – 4.4 ГГц · Int-N / Frac-N · 32-VFQFN
      </text>
      {!powered && (
        <text x={570} y={58} fontSize={11} fill="var(--err)" textAnchor="middle">
          {snap.pins.ce ? "POWER_DOWN = 1 — программно выключен" : "CE = 0 — кристалл выключен"}
        </text>
      )}

      {/* domain zones */}
      <rect x={185} y={160} width={290} height={82} rx={12} fill="var(--ref)" opacity={0.05} />
      <text x={192} y={174} fontSize={9.5} fill="var(--ref)" opacity={0.85} letterSpacing={0.5}>
        ОПОРНЫЙ ТРАКТ
      </text>
      <rect x={455} y={300} width={430} height={322} rx={12} fill="var(--rf)" opacity={0.04} />
      <text x={735} y={316} fontSize={9.5} fill="var(--rf)" opacity={0.85} letterSpacing={0.5}>
        ВЧ-ТРАКТ И ОБРАТНАЯ СВЯЗЬ
      </text>

      {/* ── board level: reference sources ── */}
      <g className="cursor-pointer" onClick={() => setSettings({ ref_source: "tcxo" })}>
        <title>Встроенный TCXO 25 МГц (нажмите, чтобы выбрать)</title>
        <rect x={16} y={146} width={108} height={40} rx={8} fill="var(--panel)" stroke={tcxo ? "var(--ref)" : "var(--line-2)"} strokeWidth={tcxo ? 1.6 : 1} />
        <text x={70} y={163} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={tcxo ? "var(--fg)" : "var(--muted)"}>
          TCXO
        </text>
        <text x={70} y={178} textAnchor="middle" fontSize={10} fill={tcxo ? "var(--ref)" : "var(--muted)"}>
          25 МГц на плате
        </text>
      </g>
      <g className="cursor-pointer" onClick={() => setSettings({ ref_source: "sma" })}>
        <title>Внешняя опора через SMA J1 (нажмите, чтобы выбрать)</title>
        <rect x={16} y={214} width={108} height={40} rx={8} fill="var(--panel)" stroke={!tcxo ? "var(--ref)" : "var(--line-2)"} strokeWidth={!tcxo ? 1.6 : 1} />
        <text x={70} y={231} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={!tcxo ? "var(--fg)" : "var(--muted)"}>
          SMA J1
        </text>
        <text x={70} y={246} textAnchor="middle" fontSize={10} fill={!tcxo ? "var(--ref)" : "var(--muted)"}>
          {!tcxo ? fmtF(d.f_ref, 3) : "внешняя опора"}
        </text>
      </g>
      <path d="M124 166 H136 L146 200" fill="none" stroke={tcxo ? "var(--ref)" : "var(--line-2)"} strokeWidth={1.5} />
      <path d="M124 234 H136 L146 200" fill="none" stroke={!tcxo ? "var(--ref)" : "var(--line-2)"} strokeWidth={1.5} />
      <text x={16} y={136} fontSize={9.5} fill="var(--muted)" letterSpacing={0.5}>
        ПЛАТА EVB
      </text>

      {/* ── reference path ── */}
      <g className="cursor-pointer" onClick={() => onSel("ref")}>
        <title>{BLOCKS.ref.title}</title>
        <rect x={142} y={186} width={50} height={28} fill="transparent" />
        <Pin x={150} y={200} name="REF_IN" side="l" color={sel === "ref" ? "var(--fg)" : "var(--ref)"} />
      </g>
      <Wire d="M154 200 H197" color={C("ref")} active={powered} hz={d.f_ref} label={fmtF(d.f_ref, 3)} lx={176} ly={226} />
      <Block id="doubler" x={197} y={182} w={56} h={36} title="×2" sub={d.doubler ? "вкл" : "обход"} dim={!d.doubler} {...sb("doubler")} />
      <Wire d="M253 200 H295" color={C("ref")} active={powered} hz={d.f_doubled} label={d.doubler ? fmtF(d.f_doubled, 3) : ""} lx={274} ly={226} />
      <Block id="rdiv" x={295} y={180} w={72} h={40} title="÷R" sub={`R = ${d.r}`} {...sb("rdiv")} />
      <Wire d="M367 200 H402" color={C("ref")} active={powered} hz={d.f_r} />
      <Block id="rdiv2" x={402} y={182} w={52} h={36} title="÷2" sub={d.div2 ? "вкл" : "обход"} dim={!d.div2} {...sb("rdiv2")} />
      <Wire d="M454 200 H510" color={C("ref")} active={powered} hz={d.f_pfd} label={fmtF(d.f_pfd, 4)} lx={484} ly={192} />

      {/* ── PFD / CP ── */}
      <Block id="pfd" x={512} y={184} w={96} h={86} title="PFD" sub={fmtF(d.f_pfd, 4)} {...sb("pfd")}>
        <text x={522} y={204} fontSize={9} fill="var(--muted)">
          REF
        </text>
        <text x={522} y={258} fontSize={9} fill="var(--muted)">
          FB
        </text>
      </Block>
      <Wire d="M608 214 H680" color={C("pfd")} active={powered} hz={d.f_pfd} label="UP" lx={644} ly={208} />
      <Wire d="M608 242 H680" color={C("pfd")} active={powered} hz={d.f_pfd} label="DN" lx={644} ly={256} />
      <Block id="cp" x={680} y={196} w={84} h={64} title="CP" sub={F.CP_HIGHZ ? "Hi-Z" : `${d.icp_ma.toFixed(2)} мА`} dim={!!F.CP_HIGHZ} {...sb("cp")} />
      <Wire d="M764 228 H986" color={C("pfd")} active={powered && !F.CP_HIGHZ} hz={d.f_pfd} label={`±${d.icp_ma.toFixed(2)} мА`} lx={872} ly={220} />
      <Pin x={990} y={228} name="CP_OUT" side="r" color="var(--pfd)" />

      {/* ── lock detect / MUX ── */}
      <Wire d="M560 184 V117" color={C("dig")} active={powered} arrow />
      <Block id="ld" x={505} y={73} w={120} h={44} title="Lock Detect" sub={`${d.ld_window_ns} нс × ${d.ld_cycles}`} {...sb("ld")} />
      <Wire d="M625 95 H986" color={C("dig")} active={powered} label={ldOn ? "LD = 1" : "LD = 0"} lx={940} ly={88} />
      <Pin x={990} y={95} name="LD" side="r" color="var(--dig)" />
      <Wire d="M600 117 V150 H755" color={C("dig")} active={powered} dashed arrow />
      <Wire d="M367 200 H380 V140 H755" color={C("ref")} active={powered && F.MUX_OUT === 3} dashed arrow={false} />
      <Block id="mux" x={755} y={128} w={92} h={44} title="MUX" sub={muxLabel.length > 15 ? muxLabel.slice(0, 14) + "…" : muxLabel} {...sb("mux")} />
      <Wire d="M847 150 H986" color={C("dig")} active={powered && F.MUX_OUT !== 0} label={sim?.mux_level == null ? "" : sim.mux_level ? "уровень 1" : "уровень 0"} lx={880} ly={143} />
      <Pin x={990} y={150} name="MUX_OUT/SDO" side="r" color="var(--dig)" />

      {/* ── external loop filter (board) ── */}
      <g className="cursor-pointer" onClick={() => onSel("lf")} onDoubleClick={() => go("loop")}>
        <title>Петлевой фильтр на плате — двойной щелчок открывает расчёт петли</title>
        <rect x={1004} y={176} width={186} height={236} rx={12} fill="var(--pfd)" opacity={sel === "lf" ? 0.1 : 0.04} stroke="var(--pfd)" strokeOpacity={sel === "lf" ? 0.9 : 0.35} strokeDasharray="4 3" />
        <text x={1012} y={192} fontSize={9.5} fill="var(--pfd)" letterSpacing={0.5}>
          ПЕТЛЕВОЙ ФИЛЬТР · {lf.order}-й порядок
        </text>
        {/* node A from CP_OUT */}
        <Wire d="M994 228 H1150" color={C("pfd")} active={powered} arrow={false} />
        {/* R2 + C2 branch with FLSW tap */}
        <line x1={1030} x2={1030} y1={228} y2={248} stroke="var(--pfd)" strokeWidth={1.4} />
        <Resistor x={1030} y={248} vertical len={40} />
        <line x1={1030} x2={1030} y1={288} y2={318} stroke="var(--pfd)" strokeWidth={1.4} />
        <Cap x={1030} y={318} />
        <line x1={1030} x2={1030} y1={324} y2={362} stroke="var(--pfd)" strokeWidth={1.4} />
        <text x={1040} y={270} fontSize={9.5} fill="var(--fg-2)">
          R2 {fmtOhm(lf.r2)}
        </text>
        <text x={1040} y={334} fontSize={9.5} fill="var(--fg-2)">
          C2 {fmtFarad(lf.c2)}
        </text>
        {/* C1 */}
        <line x1={1090} x2={1090} y1={228} y2={300} stroke="var(--pfd)" strokeWidth={1.4} />
        <Cap x={1090} y={300} />
        <line x1={1090} x2={1090} y1={306} y2={362} stroke="var(--pfd)" strokeWidth={1.4} />
        <text x={1098} y={296} fontSize={9.5} fill="var(--fg-2)">
          C1
        </text>
        <text x={1098} y={316} fontSize={9.5} fill="var(--fg-2)">
          {fmtFarad(lf.c1)}
        </text>
        {lf.order >= 3 ? (
          <>
            <Resistor x={1112} y={228} len={30} />
            <text x={1127} y={218} fontSize={9.5} fill="var(--fg-2)" textAnchor="middle">
              R3 {fmtOhm(lf.r3)}
            </text>
            <line x1={1142} x2={1162} y1={228} y2={228} stroke="var(--pfd)" strokeWidth={1.4} />
            <line x1={1162} x2={1162} y1={228} y2={330} stroke="var(--pfd)" strokeWidth={1.4} />
            <Cap x={1162} y={330} />
            <line x1={1162} x2={1162} y1={336} y2={362} stroke="var(--pfd)" strokeWidth={1.4} />
            <text x={1156} y={352} fontSize={9.5} fill="var(--fg-2)" textAnchor="end">
              C3 {fmtFarad(lf.c3)}
            </text>
          </>
        ) : (
          <line x1={1112} x2={1162} y1={228} y2={228} stroke="var(--pfd)" strokeWidth={1.4} />
        )}
        <line x1={1022} x2={1170} y1={362} y2={362} stroke="var(--muted)" strokeWidth={1.2} />
        {[0, 1, 2].map((i) => (
          <line key={i} x1={1090 - 8 + i * 3} x2={1090 + 8 - i * 3} y1={366 + i * 3} y2={366 + i * 3} stroke="var(--muted)" strokeWidth={1.2} />
        ))}
        <circle cx={1162} cy={228} r={2.5} fill="var(--pfd)" />
        <circle cx={1030} cy={228} r={2.5} fill="var(--pfd)" />
        <circle cx={1090} cy={228} r={2.5} fill="var(--pfd)" />
        {/* VTUNE return */}
        <Wire d="M1162 228 H1180 V396 H994" color={C("pfd")} active={powered} arrow={false} label={sim ? `VTUNE ${sim.vtune.toFixed(2)} В` : "VTUNE"} lx={1098} ly={390} />
      </g>
      {/* FLSW to R2 tap */}
      <Wire d="M994 300 H1022" color={C("dig")} active={powered && F.CLK_DIV_MODE === 1} dashed arrow={false} />
      <circle cx={1026} cy={300} r={2.5} fill="var(--dig)" opacity={F.CLK_DIV_MODE === 1 ? 1 : 0.4} />
      <Pin x={990} y={300} name="FLSW" side="r" color="var(--dig)" />
      <Pin x={990} y={396} name="VTUNE" side="r" color="var(--pfd)" />

      {/* ── VCO ── */}
      <Wire d="M986 396 H862" color={C("pfd")} active={powered} />
      <Block id="vco" x={740} y={330} w={122} h={88} title="VCO · 3 ядра" ty={350} {...sb("vco")}>
        {[0, 1, 2].map((i) => {
          const on = vcoOn && core === i;
          return (
            <g key={i}>
              <rect x={752 + i * 34} y={360} width={30} height={22} rx={4} fill={on ? "var(--rf)" : "var(--panel-3)"} opacity={on ? 0.9 : 1} stroke={on ? "var(--rf)" : "var(--line-2)"} />
              <text x={767 + i * 34} y={375} textAnchor="middle" fontSize={9} fontWeight={600} fill={on ? "var(--accent-fg)" : "var(--muted)"}>
                {["2.2", "2.9", "3.7"][i]}
              </text>
            </g>
          );
        })}
        <text x={801} y={404} textAnchor="middle" fontSize={10.5} fill={calibrating ? "var(--warn)" : vcoOn ? "var(--rf)" : "var(--muted)"} className="num">
          {!vcoOn ? "выключен" : calibrating ? "калибровка…" : fmtF(fNow, 4)}
        </text>
      </Block>

      {/* VCO → M0 */}
      <Wire d="M801 418 V448" color={C("rf")} active={vcoOn} hz={d.f_vco} />
      <Block id="m0" x={762} y={448} w={78} h={42} title="÷M0" sub={`÷${d.m0}`} dim={d.m0 === 1} {...sb("m0")} />
      <Wire d="M840 469 H884" color={C("rf")} active={vcoOn} hz={d.f_div_out} label={fmtF(d.f_div_out, 4)} lx={862} ly={442} />
      <Block id="outa" x={884} y={450} w={64} h={40} title="OUT A" sub={d.out_a_en ? `${d.pwr_a_dbm > 0 ? "+" : ""}${d.pwr_a_dbm} dBm` : "выкл"} dim={!d.out_a_en} {...sb("outa")} />
      <Wire d="M948 462 H986" color={C("rf")} active={outA} hz={d.f_out_a} arrow={false} />
      <Wire d="M948 478 H986" color={C("rf")} active={outA} hz={d.f_out_a} arrow={false} />
      <Pin x={990} y={462} name="" side="r" color="var(--rf)" />
      <Pin x={990} y={478} name="" side="r" color="var(--rf)" />
      <text x={982} y={446} fontSize={9} fill="var(--muted)" textAnchor="end" fontFamily="var(--font-mono)">
        RF_OUTA ±
      </text>

      {/* OUT B (VCO direct or divided) */}
      <Wire d={F.RF_OUTB_SEL ? "M862 350 H872 V570 H884" : "M856 469 V570 H884"} color={C("rf")} active={vcoOn && d.out_b_en} hz={d.f_out_b} arrow />
      <Block id="outb" x={884} y={552} w={64} h={40} title="OUT B" sub={d.out_b_en ? `${d.pwr_b_dbm > 0 ? "+" : ""}${d.pwr_b_dbm} dBm` : "выкл"} dim={!d.out_b_en} {...sb("outb")} />
      <Wire d="M948 564 H986" color={C("rf")} active={outB} hz={d.f_out_b} arrow={false} />
      <Wire d="M948 580 H986" color={C("rf")} active={outB} hz={d.f_out_b} arrow={false} />
      <Pin x={990} y={564} name="" side="r" color="var(--rf)" />
      <Pin x={990} y={580} name="" side="r" color="var(--rf)" />
      <text x={982} y={548} fontSize={9} fill="var(--muted)" textAnchor="end" fontFamily="var(--font-mono)">
        RF_OUTB ±
      </text>

      {/* board: RF connectors */}
      {[462, 478].map((y, i) => (
        <g key={y}>
          <line x1={994} x2={1040} y1={y} y2={y} stroke="var(--rf)" strokeWidth={1.4} opacity={outA ? 0.8 : 0.25} />
          <circle cx={1050} cy={y + (i ? 8 : -8)} r={9} fill="var(--panel)" stroke="var(--rf)" strokeWidth={1.4} opacity={outA ? 1 : 0.4} />
          <circle cx={1050} cy={y + (i ? 8 : -8)} r={3} fill="var(--rf)" opacity={outA ? 1 : 0.3} />
          <line x1={1040} x2={1041} y1={y} y2={y + (i ? 8 : -8)} stroke="var(--rf)" />
          <text x={1066} y={y + (i ? 12 : -4)} fontSize={10} fill="var(--fg-2)">
            {i ? "nRF_OUTA" : "RF_OUTA"} SMA
          </text>
        </g>
      ))}
      <text x={1066} y={505} fontSize={11} fontWeight={600} fill={outA ? "var(--rf)" : "var(--muted)"} className="num">
        {outA ? `${fmtF(d.f_out_a, 4)} · ${d.pwr_a_dbm > 0 ? "+" : ""}${d.pwr_a_dbm} dBm` : snap.pins.muted ? "MUTE" : "нет сигнала"}
      </text>
      <text x={1004} y={576} fontSize={9.5} fill="var(--muted)">
        RF_OUTB не выведен на разъёмы EVB
      </text>

      {/* board: LD LED / MUX test point */}
      <circle cx={1040} cy={95} r={16} fill="url(#ledglow)" opacity={ldOn ? 0.8 : 0} />
      <circle cx={1040} cy={95} r={6} fill={ldOn ? "var(--ok)" : "var(--panel-3)"} stroke={ldOn ? "var(--ok)" : "var(--line-2)"} />
      <line x1={994} x2={1034} y1={95} y2={95} stroke="var(--dig)" opacity={0.5} />
      <text x={1054} y={99} fontSize={10} fill="var(--fg-2)">
        светодиод LD
      </text>
      <line x1={994} x2={1034} y1={150} y2={150} stroke="var(--dig)" opacity={0.5} />
      <circle cx={1038} cy={150} r={4} fill="none" stroke="var(--dig)" />
      <text x={1050} y={154} fontSize={10} fill="var(--fg-2)">
        тест-точка MUX_OUT
      </text>

      {/* ── feedback path ── */}
      <Wire d="M740 360 H712 V408 H668" color={C("rf")} active={vcoOn && d.fb_fundamental} hz={d.f_vco} arrow />
      <Wire d="M762 469 H694 V432 H668" color={C("rf")} active={vcoOn && !d.fb_fundamental} hz={d.f_div_out} arrow />
      <Block id="fbmux" x={612} y={396} w={56} h={48} title="FB" sub={d.fb_fundamental ? "VCO" : "M0"} {...sb("fbmux")} />
      <Wire d="M612 420 H572" color={C("rf")} active={vcoOn} hz={fbHz} label={fmtF(fbHz, 4)} lx={592} ly={386} />
      <Block id="ndiv" x={470} y={392} w={102} h={56} title="N-делитель" sub={`N = ${d.n.toFixed(d.integer_mode ? 0 : 5)}`} {...sb("ndiv")} />
      <Wire d="M470 420 H446 V256 H510" color={C("pfd")} active={vcoOn} hz={d.f_pfd} label={locked ? fmtF(d.f_pfd, 4) : "≠ fPFD"} lx={482} ly={274} />
      <Block id="sdm" x={470} y={500} w={102} h={44} title="ΣΔ-модулятор" sub={d.integer_mode ? "Int-N · выкл" : `${d.sdm_order}-й порядок${F.NOISE_MODE === 3 ? " + dither" : ""}`} dim={d.integer_mode} {...sb("sdm")} />
      <Wire d="M521 500 V450" color={C("dig")} active={vcoOn && !d.integer_mode} hz={d.f_pfd} />
      <text x={528} y={478} fontSize={9.5} fill="var(--muted)">
        INT+FRAC/MOD
      </text>

      {/* ── fast lock timer ── */}
      <Block id="fastlock" x={588} y={560} w={128} h={46} title="Таймер 12 бит" sub={["выкл", "Fast Lock", "Phase Resync", "резерв"][F.CLK_DIV_MODE] ?? ""} dim={F.CLK_DIV_MODE === 0} {...sb("fastlock")} />
      <Wire d="M716 583 H728 V300 H986" color={C("dig")} active={powered && F.CLK_DIV_MODE === 1} dashed arrow={false} />

      {/* ── control: SPI, registers, pins ── */}
      <Pin x={150} y={398} name="SCLK" side="l" color="var(--ctl)" />
      <Pin x={150} y={420} name="SDI" side="l" color="var(--ctl)" />
      <Pin x={150} y={442} name="nCS" side="l" color="var(--ctl)" />
      {[398, 420, 442].map((y) => (
        <line key={y} x1={154} x2={208} y1={y} y2={y} stroke="var(--ctl)" strokeWidth={1.3} opacity={0.6} />
      ))}
      <Block id="spi" x={208} y={386} w={104} h={68} title="SPI" sub="32 бит · MSB first" {...sb("spi")} />
      <Wire d="M260 454 V510" color={C("ctl")} active />
      <Block id="logic" x={196} y={510} w={128} h={56} title="Регистры R0–R7" sub={snap.dirty.some(Boolean) ? `${snap.dirty.filter(Boolean).length} не записано` : "синхронно"} {...sb("logic")} />
      <Wire d="M324 530 H470" color={C("ctl")} active dashed />
      <Wire d="M324 548 H420 V583 H588" color={C("ctl")} active dashed />
      <text x={334} y={524} fontSize={9.5} fill="var(--muted)">
        управление всеми блоками
      </text>

      <Pin x={150} y={612} name="CE" side="l" color={snap.pins.ce ? "var(--ok)" : "var(--err)"} />
      <Pin x={150} y={640} name="MUTE" side="l" color={snap.pins.muted ? "var(--err)" : "var(--ctl)"} />
      <Block id="pins" x={208} y={604} w={104} h={44} title="CE / MUTE" sub={`CE=${snap.pins.ce ? 1 : 0} · MUTE=${snap.pins.muted ? 0 : 1}`} {...sb("pins")} />
      <line x1={154} x2={208} y1={612} y2={612} stroke="var(--ctl)" opacity={0.6} />
      <line x1={154} x2={208} y1={640} y2={640} stroke="var(--ctl)" opacity={0.6} />
      <Wire d="M312 632 H916 V592" color={snap.pins.muted ? "var(--err)" : C("ctl")} active dashed />
      <text x={760} y={626} fontSize={9.5} fill={snap.pins.muted ? "var(--err)" : "var(--muted)"}>
        MUTE → выходные буферы
      </text>

      {/* board: USB→SPI bridge */}
      <g className="cursor-pointer" onClick={() => go("hardware")}>
        <title>Источник SPI-кадров — откройте «Подключение»</title>
        <rect x={16} y={384} width={108} height={74} rx={8} fill="var(--panel)" stroke="var(--ctl)" strokeWidth={1.2} />
        <text x={70} y={406} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--fg)">
          {snap.link.kind === "sim" ? "Симулятор" : "SPI-мост"}
        </text>
        <text x={70} y={422} textAnchor="middle" fontSize={9.5} fill="var(--muted)">
          {snap.link.kind === "sim" ? "виртуальный чип" : snap.link.name.slice(0, 18)}
        </text>
        <text x={70} y={442} textAnchor="middle" fontSize={9.5} fill="var(--accent)">
          USB ⇄ SPI
        </text>
      </g>
      {[398, 420, 442].map((y) => (
        <line key={y} x1={124} x2={146} y1={y} y2={y} stroke="var(--ctl)" strokeWidth={1.3} opacity={0.7} />
      ))}
      <text x={16} y={604} fontSize={9.5} fill="var(--muted)">
        джампер CE
      </text>
      <line x1={70} x2={146} y1={612} y2={612} stroke="var(--ctl)" opacity={0.5} strokeDasharray="2 3" />
      <line x1={70} x2={146} y1={640} y2={640} stroke="var(--ctl)" opacity={0.5} strokeDasharray="2 3" />
      <text x={16} y={656} fontSize={9.5} fill="var(--muted)">
        MUTE (GPIO)
      </text>
    </svg>
  );
}

// ───────────────────────── Inspector ─────────────────────────

function metrics(id: string, snap: Snapshot, d: Derived, sim: Snapshot["sim"]): [string, string, string?][] {
  const F = snap.fields;
  const lf = snap.settings.loop_filter;
  switch (id) {
    case "ref":
      return [
        ["fREF", fmtF(d.f_ref, 6), "ref"],
        ["Источник", snap.settings.ref_source === "tcxo" ? "TCXO на плате" : "SMA J1"],
      ];
    case "doubler":
      return [
        ["Удвоитель", d.doubler ? "включён" : "обход"],
        ["После ×2", fmtF(d.f_doubled, 6), "ref"],
      ];
    case "rdiv":
      return [
        ["R", String(d.r)],
        ["fREF·(1+D)/R", fmtF(d.f_r, 6), "ref"],
      ];
    case "rdiv2":
    case "pfd":
      return [
        ["fPFD", fmtF(d.f_pfd, 6), "pfd"],
        ["TPFD", `${d.t_pfd_ns.toFixed(3)} нс`],
        ["Режим", d.integer_mode ? "Integer-N" : "Fractional-N"],
        ["Предел fPFD", d.integer_mode ? "310 МГц" : "125 МГц"],
      ];
    case "cp":
      return [
        ["ICP", `${d.icp_ma.toFixed(3)} мА`, "pfd"],
        ["RCP", fmtOhm(snap.settings.rcp_ohm)],
        ["Состояние", F.CP_HIGHZ ? "Hi-Z" : "активна"],
        ["Полоса петли", fmtF(snap.loop.fc_hz, 3)],
      ];
    case "lf":
      return [
        ["Полоса fc", fmtF(snap.loop.fc_hz, 3), "pfd"],
        ["Запас по фазе", `${snap.loop.pm_deg.toFixed(1)}°`, snap.loop.pm_deg > 40 ? "ok" : "warn"],
        ["C1 / C2", `${fmtFarad(lf.c1)} / ${fmtFarad(lf.c2)}`],
        ["R2", fmtOhm(lf.r2)],
        ...(lf.order >= 3 ? ([["R3 / C3", `${fmtOhm(lf.r3)} / ${fmtFarad(lf.c3)}`]] as [string, string][]) : []),
      ];
    case "vco":
      return [
        ["fVCO (план)", fmtF(d.f_vco, 6), "rf"],
        ["Ядро", `${(sim?.vco_core ?? d.vco_core) + 1} из 3`],
        ["Поддиапазон", sim ? String(sim.sub_band) : "—"],
        ["VTUNE", sim ? `${sim.vtune.toFixed(3)} В` : "—", sim && (sim.vtune < 0.5 || sim.vtune > 2.5) ? "err" : undefined],
        ["Такт калибровки", fmtF(d.f_band_sel, 3), d.f_band_sel > 500e3 || d.f_band_sel < 125e3 ? "warn" : undefined],
        ["Калибровка", sim ? fmtTime(sim.band_select_us * 1e-6) : "—"],
      ];
    case "m0":
      return [
        ["M0", `÷${d.m0}`],
        ["fVCO/M0", fmtF(d.f_div_out, 6), "rf"],
      ];
    case "fbmux":
      return [
        ["Обратная связь", d.fb_fundamental ? "fundamental (VCO)" : "divided (после M0)"],
        ["N петли", d.n_loop.toFixed(6)],
      ];
    case "ndiv":
      return [
        ["INT", String(d.int)],
        ["FRAC / MOD", `${d.frac} / ${d.modulus}`],
        ["N", d.n.toFixed(9), "rf"],
        ["Шаг сетки", fmtF(d.channel_step_hz, 3)],
        ["Разрядность", d.hi_res ? "16 бит" : "12 бит"],
        ["Фаза", `${d.phase_deg.toFixed(3)}°`],
      ];
    case "sdm":
      return [
        ["Порядок", d.integer_mode ? "выкл (Int-N)" : String(d.sdm_order)],
        ["Шум/спуры", F.NOISE_MODE === 3 ? "Low Spur (dither)" : "Low Noise"],
        ["Шаг дробных спуров", d.frac_spur_step_hz > 0 ? fmtF(d.frac_spur_step_hz, 3) : "—"],
        ["Ближний IBS", d.ibs_offset_hz != null ? fmtF(d.ibs_offset_hz, 3) : "—"],
      ];
    case "ld":
      return [
        ["Окно", `${d.ld_window_ns} нс`, d.ld_window_ns >= d.t_pfd_ns ? "err" : undefined],
        ["Циклов", String(d.ld_cycles)],
        ["Вывод LD", sim ? (sim.ld_pin ? "1 (захват)" : "0") : "—", sim?.ld_pin ? "ok" : undefined],
        ["Время захвата", sim?.lock_time_us != null ? fmtTime(sim.lock_time_us * 1e-6) : "—"],
      ];
    case "outa":
      return [
        ["fOUT A", fmtF(d.f_out_a, 6), "rf"],
        ["Мощность", `${d.pwr_a_dbm} dBm`],
        ["Состояние", d.out_a_en ? (snap.pins.muted ? "MUTE" : "включён") : "выключен"],
      ];
    case "outb":
      return [
        ["fOUT B", fmtF(d.f_out_b, 6), "rf"],
        ["Мощность", `${d.pwr_b_dbm} dBm`],
        ["Состояние", d.out_b_en ? "включён" : "выключен"],
      ];
    case "spi":
    case "logic":
      return [
        ["Связь", snap.link.kind === "sim" ? "симулятор" : snap.link.name],
        ["Не записано", snap.dirty.map((x, i) => (x ? `R${i}` : "")).filter(Boolean).join(" ") || "—"],
        ["Ждут записи R0", snap.pending_db.join(", ") || "—"],
      ];
    case "fastlock":
      return [
        ["CLK_DIV", String(F.CLK_DIV)],
        ["TSYNC / таймер", fmtTime(d.t_sync_s)],
      ];
    case "pins":
      return [
        ["CE", snap.pins.ce ? "1 — работа" : "0 — выключен", snap.pins.ce ? "ok" : "err"],
        ["MUTE", snap.pins.muted ? "0 — выходы заглушены" : "1 — выходы активны"],
      ];
    default:
      return [];
  }
}

function Inspector({ id }: { id: string }) {
  const snap = useStore((s) => s.snap)!;
  const meta = useStore((s) => s.meta);
  const call = useStore((s) => s.call);
  const go = useStore((s) => s.go);
  const setSettings = useStore((s) => s.setSettings);
  const sim = useSim();
  const info = BLOCKS[id];
  const d = snap.derived;
  const fieldBlocks = id === "rdiv2" ? ["rdiv2"] : id === "lf" ? [] : [id];
  const fields = (meta?.fields ?? []).filter((f) => fieldBlocks.includes(f.block) && f.access !== "fixed");
  const issues = d.issues.filter((i) => i.block === id || (id === "lf" && i.block === "loop"));
  const ms = metrics(id, snap, d, sim);
  if (!info) return null;
  const c = DOMAIN_COLOR[info.domain];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-xl grid place-items-center text-[12px] font-bold" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}>
          {info.short.slice(0, 3)}
        </div>
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold leading-tight">{info.title}</h3>
          <p className="text-[12px] text-muted leading-relaxed mt-1">{info.desc}</p>
        </div>
      </div>

      {ms.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {ms.map(([l, v, tone]) => (
            <Stat key={l} label={l} value={v} tone={tone} />
          ))}
        </div>
      )}

      {issues.map((i, k) => (
        <div key={k} className={cx("flex gap-2 rounded-lg border px-2.5 py-2 text-[12px]", i.level === "error" ? "border-err/35 bg-err/8" : i.level === "warn" ? "border-warn/35 bg-warn/8" : "border-line bg-panel2")}>
          {i.level === "error" ? <CircleAlert size={14} className="text-err shrink-0 mt-0.5" /> : i.level === "warn" ? <TriangleAlert size={14} className="text-warn shrink-0 mt-0.5" /> : <Info size={14} className="text-accent shrink-0 mt-0.5" />}
          <span className="text-fg2 leading-snug">{i.msg}</span>
        </div>
      ))}

      {id === "ref" && (
        <div className="flex flex-col gap-2">
          <Segmented
            value={snap.settings.ref_source}
            onChange={(v) => setSettings({ ref_source: v })}
            options={[
              { value: "tcxo", label: "TCXO 25 МГц" },
              { value: "sma", label: "Внешний SMA J1" },
            ]}
          />
          <p className="text-[12px] text-muted">Источник для расчётов. Подключение J1 требует доработки платы по руководству EVB, стр. 11.</p>
          {snap.settings.ref_source === "sma" && (
            <div className="flex items-center gap-2 text-[12px] text-muted">
              Частота опоры <FreqField hz={snap.settings.ref_hz} onCommit={(hz) => setSettings({ ref_hz: hz })} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {id === "vco" && (
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => call("write_register", { index: 0 })}>
            Перекалибровать (запись R0)
          </Button>
        )}
        {(id === "lf" || id === "cp") && (
          <Button size="sm" icon={<ArrowRight size={13} />} onClick={() => go("loop")}>
            Расчёт петли
          </Button>
        )}
        {(id === "ndiv" || id === "rdiv" || id === "m0" || id === "pfd") && (
          <Button size="sm" icon={<ArrowRight size={13} />} onClick={() => go("planner")}>
            Планировщик частоты
          </Button>
        )}
        {id === "sdm" && (
          <Button size="sm" icon={<ArrowRight size={13} />} onClick={() => go("noise")}>
            Шум и спуры
          </Button>
        )}
        {(id === "spi" || id === "logic" || id === "mux") && (
          <Button size="sm" icon={<ArrowRight size={13} />} onClick={() => go("registers")}>
            Карта регистров
          </Button>
        )}
        {info.learn && (
          <Button size="sm" variant="ghost" icon={<BookOpen size={13} />} onClick={() => go("learn")}>
            Теория в Академии
          </Button>
        )}
      </div>

      {fields.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wider text-muted font-medium mt-1">Поля регистров блока</div>
          {fields.map((f) => (
            <FieldControl key={f.name} name={f.name} />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── View ─────────────────────────

export function ArchitectureView() {
  const snap = useStore((s) => s.snap)!;
  const block = useStore((s) => s.block);
  const selectBlock = useStore((s) => s.selectBlock);
  const d = snap.derived;
  const sel = block && BLOCKS[block] ? block : "pfd";

  const eq = useMemo(() => {
    const k = (d.doubler ? 2 : 1) / (d.r * (d.div2 ? 2 : 1));
    return { k };
  }, [d]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Архитектура 8V97051 и плата EVB"
          subtitle="Нажмите на любой блок — справа откроются его параметры и поля регистров. Анимация проводников показывает прохождение сигнала."
          actions={
            <div className="hidden 2xl:flex items-center gap-2">
              {(["ref", "pfd", "rf", "dig", "ctl"] as Domain[]).map((dm) => (
                <span key={dm} className="flex items-center gap-1 text-[11px] text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: DOMAIN_COLOR[dm] }} />
                  {{ ref: "опора", pfd: "PFD/петля", rf: "ВЧ", dig: "цифровые", ctl: "управление" }[dm]}
                </span>
              ))}
            </div>
          }
          bodyClass="!px-2 !pb-2"
        >
          <Diagram snap={snap} sel={sel} onSel={selectBlock} />
        </Card>
        <Card className="xl:max-h-[calc(100vh-140px)] xl:overflow-y-auto scroll-thin">
          <Inspector id={sel} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Уравнение синтезатора" subtitle="Как частота опоры превращается в выходную — с текущими значениями регистров">
          <div className="formula selectable">
            {`fPFD = fREF × (1 + D) / (R × (1 + T)) = ${fmtF(d.f_ref, 6)} × ${d.doubler ? 2 : 1} / (${d.r} × ${d.div2 ? 2 : 1}) = ${fmtF(d.f_pfd, 6)}\n`}
            {`fVCO = fPFD × (INT + FRAC/MOD) = ${fmtF(d.f_pfd, 6)} × (${d.int} + ${d.frac}/${d.modulus}) = ${fmtF(d.f_vco, 6)}\n`}
            {`fOUT = fVCO / M0 = ${fmtF(d.f_vco, 6)} / ${d.m0} = ${fmtF(d.f_out_a, 6)}\n`}
            {`шаг = fPFD / MOD / M0 = ${fmtF(d.channel_step_hz, 3)}   ·   коэффициент опоры ${eq.k.toFixed(4)}`}
          </div>
        </Card>
        <Card title="Проверка конфигурации" subtitle={d.issues.length ? `${d.issues.length} замечаний` : "Нарушений не найдено"}>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto scroll-thin">
            {d.issues.length === 0 && (
              <div className="flex items-center gap-2 text-[12px] text-ok">
                <Badge tone="ok">OK</Badge> Все ограничения даташита соблюдены
              </div>
            )}
            {d.issues.map((i, k) => (
              <button key={k} onClick={() => selectBlock(BLOCKS[i.block] ? i.block : sel)} className="flex items-start gap-2 text-left rounded-lg px-2 py-1 hover:bg-panel3">
                <Badge tone={i.level === "error" ? "err" : i.level === "warn" ? "warn" : "muted"}>{BLOCKS[i.block]?.short ?? i.block}</Badge>
                <span className="text-[12px] text-fg2 leading-snug">{i.msg}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
