import { useEffect, useState } from "react";
import { Activity, Calculator, Check } from "lucide-react";
import { useStore } from "../lib/store";
import { fmtF, fmtFarad, fmtOhm, fmtTime, parseEng } from "../lib/format";
import type { LoopAnalysis, LoopFilter, LoopParams, Transient } from "../lib/types";
import { Plot } from "../components/Plot";
import { Badge, Button, Card, FreqField, Hint, PageHeader, Row, Segmented, Slider, Stat, Toggle, cx } from "../components/ui";

interface LoopResp {
  params: LoopParams;
  analysis: LoopAnalysis;
  transient: Transient;
  filter: LoopFilter;
}

function EngField({ value, onCommit, fmt }: { value: number; onCommit: (v: number) => void; fmt: (v: number) => string }) {
  const [txt, setTxt] = useState(fmt(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setTxt(fmt(value)), [value, fmt]);
  const commit = (s: string) => {
    const v = parseEng(s.replace(/(Ом|Ф|F|ohm)$/i, ""));
    if (v == null || !(v > 0)) return setBad(true);
    setBad(false);
    if (Math.abs(v - value) / value > 1e-9) onCommit(v);
  };
  return (
    <input
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
      className={cx("h-8 w-28 rounded-lg bg-panel2 border px-2 text-[12.5px] num outline-none", bad ? "border-err" : "border-line focus:border-accent")}
    />
  );
}

/** Schematic of the passive loop filter (3rd order optional). */
function FilterSchematic({ lf }: { lf: LoopFilter }) {
  const s = "var(--pfd)";
  const R = ({ x, y, v }: { x: number; y: number; v?: boolean }) => {
    let d = `M${x} ${y}`;
    for (let i = 0; i < 6; i++) d += v ? ` L${x + (i % 2 ? -5 : 5)} ${y + (i + 0.5) * 6}` : ` L${x + (i + 0.5) * 6} ${y + (i % 2 ? -5 : 5)}`;
    d += v ? ` L${x} ${y + 36}` : ` L${x + 36} ${y}`;
    return <path d={d} stroke={s} fill="none" strokeWidth={1.5} />;
  };
  const C = ({ x, y }: { x: number; y: number }) => (
    <g stroke={s} strokeWidth={2}>
      <line x1={x - 10} x2={x + 10} y1={y} y2={y} />
      <line x1={x - 10} x2={x + 10} y1={y + 7} y2={y + 7} />
    </g>
  );
  const t = (x: number, y: number, a: string, b: string) => (
    <>
      <text x={x} y={y} fontSize={11} fill="var(--fg)" fontWeight={600}>
        {a}
      </text>
      <text x={x} y={y + 13} fontSize={10.5} fill="var(--muted)" className="num">
        {b}
      </text>
    </>
  );
  return (
    <svg viewBox="0 0 420 170" className="w-full h-auto">
      <text x={4} y={34} fontSize={10.5} fill="var(--muted)" fontFamily="var(--font-mono)">
        CP_OUT
      </text>
      <line x1={50} x2={330} y1={40} y2={40} stroke={s} strokeWidth={1.5} />
      {/* C1 */}
      <line x1={90} x2={90} y1={40} y2={86} stroke={s} strokeWidth={1.5} />
      <C x={90} y={86} />
      <line x1={90} x2={90} y1={93} y2={140} stroke={s} strokeWidth={1.5} />
      {t(100, 92, "C1", fmtFarad(lf.c1))}
      {/* R2 + C2 */}
      <line x1={170} x2={170} y1={40} y2={50} stroke={s} strokeWidth={1.5} />
      <R x={170} y={50} v />
      <line x1={170} x2={170} y1={86} y2={100} stroke={s} strokeWidth={1.5} />
      <C x={170} y={100} />
      <line x1={170} x2={170} y1={107} y2={140} stroke={s} strokeWidth={1.5} />
      {t(180, 66, "R2", fmtOhm(lf.r2))}
      {t(180, 112, "C2", fmtFarad(lf.c2))}
      {lf.order >= 3 && (
        <>
          <rect x={236} y={30} width={40} height={20} fill="var(--panel)" />
          <R x={238} y={40} />
          {t(240, 20, "R3", fmtOhm(lf.r3))}
          <line x1={310} x2={310} y1={40} y2={92} stroke={s} strokeWidth={1.5} />
          <C x={310} y={92} />
          <line x1={310} x2={310} y1={99} y2={140} stroke={s} strokeWidth={1.5} />
          {t(320, 98, "C3", fmtFarad(lf.c3))}
        </>
      )}
      <line x1={330} x2={370} y1={40} y2={40} stroke={s} strokeWidth={1.5} />
      <text x={372} y={44} fontSize={10.5} fill="var(--muted)" fontFamily="var(--font-mono)">
        VTUNE
      </text>
      <line x1={70} x2={340} y1={140} y2={140} stroke="var(--muted)" strokeWidth={1.2} />
      {[0, 1, 2].map((i) => (
        <line key={i} x1={200 - 10 + i * 3.5} x2={200 + 10 - i * 3.5} y1={145 + i * 4} y2={145 + i * 4} stroke="var(--muted)" strokeWidth={1.2} />
      ))}
    </svg>
  );
}

export function LoopView() {
  const snap = useStore((s) => s.snap)!;
  const call = useStore((s) => s.call);
  const setSettings = useStore((s) => s.setSettings);
  const toast = useStore((s) => s.toast);
  const [data, setData] = useState<LoopResp | null>(null);
  const [df0, setDf0] = useState(snap.settings.residual_hz);
  const [fc, setFc] = useState(100e3);
  const [alpha, setAlpha] = useState(4);
  const [beta, setBeta] = useState(4);
  const [gamma, setGamma] = useState(4);
  const [order, setOrder] = useState(snap.settings.loop_filter.order);
  const [snapE, setSnapE] = useState(true);
  const [preview, setPreview] = useState<{ filter: LoopFilter; analysis: LoopAnalysis } | null>(null);

  const lf = snap.settings.loop_filter;
  const d = snap.derived;
  const key = JSON.stringify([lf, d.f_pfd, d.n_loop, d.icp_ma, snap.settings.kvco_hz_v, df0, snap.fields.CLK_DIV_MODE, snap.fields.CLK_DIV]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = await call<LoopResp>("loop_analysis", { df0_hz: df0 }, true);
      if (alive && r) setData(r);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const req = { fc_hz: fc, alpha, beta, gamma, order, snap: snapE };
  const doDesign = async (apply: boolean) => {
    const r = await call<{ filter: LoopFilter; analysis: LoopAnalysis }>("design_loop", { req, apply });
    if (!r) return;
    if (apply) {
      setPreview(null);
      await call("get_state", {}, true);
      toast("ok", `Фильтр применён: fc ${fmtF(r.analysis.fc_hz, 3)}, запас по фазе ${r.analysis.pm_deg.toFixed(1)}°`);
    } else setPreview(r);
  };

  const setLf = (patch: Partial<LoopFilter>) => setSettings({ loop_filter: { ...lf, ...patch } });

  const a = data?.analysis;
  const tr = data?.transient;
  const pmTone = !a ? "muted" : !a.stable ? "err" : a.pm_deg < 35 ? "warn" : "ok";

  return (
    <div className="max-w-[1600px]">
      <PageHeader
        icon={<Activity size={20} />}
        title="Петля ФАПЧ"
        subtitle="Пассивный фильтр между CP_OUT и VTUNE определяет полосу, запас устойчивости, шум и скорость перестройки. Измените компоненты или рассчитайте их по желаемой полосе."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8 gap-2 mb-4">
        <Stat label="Полоса (0 дБ)" value={a ? fmtF(a.fc_hz, 3) : "—"} tone="pfd" />
        <Stat label="Запас по фазе" value={a ? `${a.pm_deg.toFixed(1)}°` : "—"} tone={pmTone} />
        <Stat label="Полоса −3 дБ" value={a ? fmtF(a.f3db_hz, 3) : "—"} />
        <Stat label="Подъём АЧХ" value={a ? `${a.peaking_db.toFixed(2)} дБ` : "—"} />
        <Stat label="ICP" value={`${d.icp_ma.toFixed(2)} мА`} />
        <Stat label="Kvco" value={`${(snap.settings.kvco_hz_v / 1e6).toFixed(1)} МГц/В`} />
        <Stat label="N петли" value={d.n_loop.toFixed(3)} />
        <Stat label="Установление" value={tr ? fmtTime(tr.settle_s) : "—"} tone="rf" sub={tr?.cycle_slips ? `${tr.cycle_slips} проскальзываний цикла` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Текущий фильтр" subtitle="Значения редактируются: 680p, 10n, 1.2k …">
            <FilterSchematic lf={preview?.filter ?? lf} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 text-[12px]">
              <label className="flex items-center justify-between gap-2">
                C1 <EngField value={lf.c1} onCommit={(v) => setLf({ c1: v })} fmt={fmtFarad} />
              </label>
              <label className="flex items-center justify-between gap-2">
                C2 <EngField value={lf.c2} onCommit={(v) => setLf({ c2: v })} fmt={fmtFarad} />
              </label>
              <label className="flex items-center justify-between gap-2">
                R2 <EngField value={lf.r2} onCommit={(v) => setLf({ r2: v })} fmt={fmtOhm} />
              </label>
              <label className="flex items-center justify-between gap-2">
                Порядок
                <Segmented size="sm" value={lf.order} onChange={(o) => setLf({ order: o })} options={[{ value: 2, label: "2" }, { value: 3, label: "3" }]} />
              </label>
              {lf.order >= 3 && (
                <>
                  <label className="flex items-center justify-between gap-2">
                    R3 <EngField value={lf.r3} onCommit={(v) => setLf({ r3: v })} fmt={fmtOhm} />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    C3 <EngField value={lf.c3} onCommit={(v) => setLf({ c3: v })} fmt={fmtFarad} />
                  </label>
                </>
              )}
            </div>
            <Hint>
              Значения по умолчанию — расчётная модель. Сверьте их с компонентами на вашей плате (рядом с выводами CP_OUT/VTUNE) и впишите фактические —
              от них зависят все расчёты шума и переходного процесса.
            </Hint>
          </Card>

          <Card title="Расчёт фильтра" icon={<Calculator size={15} />} subtitle="Методика даташита: Rz = 2π·fc·N/(Icp·Kvco), Cz = α/(2π·fc·Rz) …">
            <Row label="Полоса fc">
              <FreqField hz={fc} onCommit={setFc} width="w-32" />
            </Row>
            <Row label={`α = fc/fz = ${alpha.toFixed(1)}`} hint="больше — выше запас по фазе">
              <Slider value={alpha} min={2} max={10} step={0.5} onChange={setAlpha} />
            </Row>
            <Row label={`β = fp/fc = ${beta.toFixed(1)}`} hint="больше — слабее подавление спуров">
              <Slider value={beta} min={2} max={10} step={0.5} onChange={setBeta} />
            </Row>
            {order >= 3 && (
              <Row label={`γ = fp2/fp = ${gamma.toFixed(1)}`}>
                <Slider value={gamma} min={1.5} max={10} step={0.5} onChange={setGamma} />
              </Row>
            )}
            <Row label="Порядок">
              <Segmented size="sm" value={order} onChange={setOrder} options={[{ value: 2, label: "2-й" }, { value: 3, label: "3-й" }]} />
            </Row>
            <Row label="Ряд E12/E24" hint="округлить до стандартных номиналов">
              <Toggle checked={snapE} onChange={setSnapE} />
            </Row>
            <div className="flex gap-2 mt-2">
              <Button onClick={() => doDesign(false)}>Предпросмотр</Button>
              <Button variant="primary" icon={<Check size={14} />} onClick={() => doDesign(true)}>
                Применить
              </Button>
            </div>
            {preview && (
              <div className="mt-3 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-[12px] text-fg2">
                Предпросмотр: fc <b>{fmtF(preview.analysis.fc_hz, 3)}</b>, запас <b>{preview.analysis.pm_deg.toFixed(1)}°</b>,{" "}
                C1 {fmtFarad(preview.filter.c1)}, C2 {fmtFarad(preview.filter.c2)}, R2 {fmtOhm(preview.filter.r2)}
                {preview.filter.order >= 3 && `, R3 ${fmtOhm(preview.filter.r3)}, C3 ${fmtFarad(preview.filter.c3)}`}
              </div>
            )}
          </Card>

          <Card title="Параметры петли">
            <Row label="Kvco" hint="крутизна ГУН, тип. 40 МГц/В">
              <Slider value={snap.settings.kvco_hz_v / 1e6} min={20} max={80} step={1} onChange={(v) => setSettings({ kvco_hz_v: v * 1e6 })} />
              <span className="num text-[12px] w-16 text-right">{(snap.settings.kvco_hz_v / 1e6).toFixed(0)} МГц/В</span>
            </Row>
            <Row label="Допуск захвата" hint="для времени установления">
              <FreqField hz={snap.settings.lock_tol_hz} onCommit={(v) => setSettings({ lock_tol_hz: v })} width="w-28" />
            </Row>
          </Card>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <Card
            title="Разомкнутая петля G(f): диаграмма Боде"
            subtitle="Амплитуда (слева) и фаза (справа). Запас по фазе = 180° + φ(fc)"
            actions={a && <Badge tone={pmTone === "muted" ? "muted" : pmTone}>{a.stable ? "устойчива" : "неустойчива"}</Badge>}
          >
            {a && (
              <Plot
                xLog
                height={290}
                series={[
                  { name: "|G|, дБ", x: a.f, y: a.ol_mag_db, color: "var(--pfd)", width: 2 },
                  { name: "φ(G), °", x: a.f, y: a.ol_phase_deg, color: "var(--rf)", axis: "y2", dash: "5 3" },
                ]}
                yFmt={(v) => `${v.toFixed(0)}`}
                y2Fmt={(v) => `${v.toFixed(0)}°`}
                y2Domain={[-270, -90]}
                yLabel="дБ"
                xLabel="частота, Гц"
                hMarkers={[{ y: 0, label: "0 дБ" }]}
                vMarkers={[
                  { x: a.fc_hz, label: `fc ${fmtF(a.fc_hz, 3)}`, color: "var(--pfd)" },
                  { x: a.zero_hz, label: "ноль", color: "var(--muted)" },
                  { x: a.pole1_hz, label: "полюс", color: "var(--muted)" },
                  ...(a.pole2_hz ? [{ x: a.pole2_hz, label: "полюс 2", color: "var(--muted)" }] : []),
                ]}
                tooltipX={(v) => fmtF(v, 4)}
                legend
              />
            )}
          </Card>

          <div className="grid gap-4 2xl:grid-cols-2">
            <Card title="Замкнутая петля" subtitle="H(f) — передача шума опоры/PFD; 1−H — подавление шума ГУН">
              {a && (
                <Plot
                  xLog
                  height={240}
                  series={[
                    { name: "|H| (PLL/опора)", x: a.f, y: a.cl_mag_db, color: "var(--ref)", width: 2 },
                    { name: "|1−H| (ГУН)", x: a.f, y: a.err_mag_db, color: "var(--rf)", width: 2 },
                  ]}
                  yDomain={[-60, 10]}
                  yFmt={(v) => v.toFixed(0)}
                  xLabel="смещение, Гц"
                  vMarkers={[{ x: a.f3db_hz, label: "−3 дБ", color: "var(--ref)" }]}
                  tooltipX={(v) => fmtF(v, 4)}
                  legend
                />
              )}
            </Card>
            <Card
              title="Переходный процесс"
              subtitle="Нелинейная модель: насыщение PFD, проскальзывание циклов, Lock Detect"
              actions={
                <div className="flex items-center gap-2 text-[11.5px] text-muted">
                  скачок
                  <FreqField hz={df0} onCommit={setDf0} width="w-24" />
                </div>
              }
            >
              {tr && (
                <>
                  <Plot
                    height={210}
                    series={[
                      { name: "Δf ГУН, кГц", x: tr.t_us, y: tr.f_err_hz.map((v) => v / 1e3), color: "var(--rf)", width: 2 },
                      { name: "φ ошибки, °", x: tr.t_us, y: tr.phase_err_deg, color: "var(--pfd)", axis: "y2", width: 1.2 },
                    ]}
                    xLabel="время, мкс"
                    yFmt={(v) => v.toFixed(0)}
                    y2Fmt={(v) => `${v.toFixed(0)}°`}
                    vMarkers={[
                      ...(tr.settle_s ? [{ x: tr.settle_s * 1e6, label: `±${fmtF(snap.settings.lock_tol_hz, 2)}`, color: "var(--ok)" }] : []),
                      ...(tr.ld_s ? [{ x: tr.ld_s * 1e6, label: "LD", color: "var(--dig)" }] : []),
                    ]}
                    tooltipX={(v) => `${v.toFixed(2)} мкс`}
                    legend
                  />
                  <div className="flex flex-wrap gap-2 mt-2 text-[12px]">
                    <Badge tone="ok">установление {fmtTime(tr.settle_s)}</Badge>
                    <Badge tone="dig">Lock Detect {fmtTime(tr.ld_s)}</Badge>
                    {tr.cycle_slips > 0 && <Badge tone="warn">проскальзываний: {tr.cycle_slips}</Badge>}
                  </div>
                </>
              )}
            </Card>
          </div>
          {a && a.pm_deg < 35 && (
            <Hint tone="warn">
              Запас по фазе меньше 35° — возможен выброс и «звон» при перестройке, подъём шума около fc. Увеличьте α, уменьшите ICP или пересчитайте фильтр.
            </Hint>
          )}
        </div>
      </div>
    </div>
  );
}
