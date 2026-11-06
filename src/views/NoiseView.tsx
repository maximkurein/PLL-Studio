import { useEffect, useRef, useState } from "react";
import { AudioWaveform, Pause, Play } from "lucide-react";
import { useStore } from "../lib/store";
import { fmtF } from "../lib/format";
import type { NoiseResult, Spectrum } from "../lib/types";
import { Plot, shortNum } from "../components/Plot";
import { Badge, Button, Card, FreqField, PageHeader, Segmented, Stat, Toggle } from "../components/ui";

const SPANS: [string, number][] = [
  ["10 кГц", 10e3],
  ["100 кГц", 100e3],
  ["1 МГц", 1e6],
  ["10 МГц", 10e6],
  ["100 МГц", 100e6],
  ["1 ГГц", 1e9],
];

export function NoiseView() {
  const snap = useStore((s) => s.snap)!;
  const call = useStore((s) => s.call);
  const setSettings = useStore((s) => s.setSettings);
  const [outB, setOutB] = useState(false);
  const [nr, setNr] = useState<NoiseResult | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [span, setSpan] = useState(1e6);
  const [live, setLive] = useState(true);
  const [sp, setSp] = useState<Spectrum | null>(null);
  const [maxHold, setMaxHold] = useState(false);
  const hold = useRef<number[] | null>(null);
  const seed = useRef(1);
  const d = snap.derived;
  const f1 = snap.settings.jitter_f1,
    f2 = snap.settings.jitter_f2;

  const key = JSON.stringify([snap.regs, snap.settings, outB]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = await call<NoiseResult>("phase_noise", { f1, f2, output_b: outB }, true);
      if (alive && r) setNr(r);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // virtual spectrum analyser sweep
  useEffect(() => {
    hold.current = null;
  }, [span, outB, maxHold]);
  useEffect(() => {
    let alive = true;
    const sweep = async () => {
      const r = await call<Spectrum>("spectrum", { span_hz: span, seed: seed.current++, output_b: outB }, true);
      if (!alive || !r) return;
      if (maxHold) {
        hold.current = hold.current && hold.current.length === r.dbm.length ? hold.current.map((v, i) => Math.max(v, r.dbm[i])) : r.dbm.slice();
      }
      setSp(r);
    };
    void sweep();
    if (!live) return () => void (alive = false);
    const id = setInterval(sweep, 450);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [span, live, outB, maxHold, call, key]);

  const toggle = (n: string) => setHidden((h) => ({ ...h, [n]: !h[n] }));
  const series = nr
    ? [
        { name: "Итог", x: nr.f, y: nr.total, color: "var(--fg)", width: 2.4 },
        { name: "ГУН", x: nr.f, y: nr.vco, color: "var(--rf)", dash: "5 3" },
        { name: "PLL (PFD/CP)", x: nr.f, y: nr.pll, color: "var(--pfd)", dash: "5 3" },
        { name: "Опора", x: nr.f, y: nr.reference, color: "var(--ref)", dash: "5 3" },
        { name: "ΣΔ", x: nr.f, y: nr.sdm, color: "var(--dig)", dash: "2 3" },
        { name: "Пол выхода", x: nr.f, y: nr.floor, color: "var(--muted)", dash: "2 3" },
      ].map((s) => ({ ...s, hidden: hidden[s.name] }))
    : [];

  return (
    <div className="max-w-[1600px]">
      <PageHeader
        icon={<AudioWaveform size={20} />}
        title="Фазовый шум, джиттер и спектр"
        subtitle="Модель складывает вклад опоры, PFD/накачки, ΣΔ-модулятора и ГУН с учётом передаточных функций петли. Справа — виртуальный анализатор спектра выхода."
        actions={<Segmented value={outB ? 1 : 0} onChange={(v) => setOutB(v === 1)} options={[{ value: 0, label: "RF_OUTA" }, { value: 1, label: "RF_OUTB" }]} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-2 mb-4">
        <Stat label="Частота выхода" value={nr ? fmtF(nr.f_out, 5) : "—"} tone="rf" />
        <Stat label={`RMS-джиттер ${shortNum(f1)}Гц–${shortNum(f2)}Гц`} value={nr ? nr.jitter_fs.toFixed(0) : "—"} unit="фс" tone="accent" />
        <Stat label="RMS фазовая ошибка" value={nr ? nr.phase_err_deg.toFixed(3) : "—"} unit="°" />
        <Stat label="Интегр. шум" value={nr ? nr.integrated_dbc.toFixed(1) : "—"} unit="dBc" />
        {nr?.marks.slice(0, 2).map(([o, v]) => (
          <Stat key={o} label={`L(f) @ ${fmtF(o, 0)}`} value={v.toFixed(1)} unit="dBc/Гц" />
        ))}
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Card
          title="Фазовый шум L(f)"
          subtitle="Нажмите на легенду, чтобы скрыть вклад. Затенение — полоса интегрирования джиттера"
          actions={
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <FreqField hz={f1} onCommit={(v) => setSettings({ jitter_f1: v })} width="w-24" />—
              <FreqField hz={f2} onCommit={(v) => setSettings({ jitter_f2: v })} width="w-24" />
            </div>
          }
        >
          {nr && (
            <>
              <Plot
                xLog
                height={340}
                series={series}
                xDomain={[nr.f[0], nr.f[nr.f.length - 1]]}
                yDomain={[-180, -60]}
                shade={[f1, f2]}
                yFmt={(v) => v.toFixed(0)}
                yLabel="dBc/Гц"
                xLabel="отстройка от несущей, Гц"
                vMarkers={[{ x: snap.loop.fc_hz, label: "fc петли", color: "var(--pfd)" }]}
                points={nr.marks.map(([x, y]) => ({ x, y, label: `${y.toFixed(1)}`, color: "var(--fg)" }))}
                tooltipX={(v) => fmtF(v, 3)}
              />
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {series.map((s) => (
                  <button key={s.name} onClick={() => toggle(s.name)} className={`inline-flex items-center gap-1.5 text-[11.5px] ${s.hidden ? "opacity-35" : "text-fg2"}`}>
                    <span className="h-[3px] w-4 rounded" style={{ background: s.color }} />
                    {s.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card
          title="Виртуальный анализатор спектра"
          subtitle={sp ? `Центр ${fmtF(sp.center_hz, 6)} · полоса обзора ${fmtF(sp.span_hz, 3)} · RBW ${fmtF(sp.rbw_hz, 2)}` : ""}
          actions={
            <div className="flex items-center gap-2">
              <Toggle checked={maxHold} onChange={setMaxHold} label="Max hold" />
              <Button size="sm" variant={live ? "primary" : "subtle"} icon={live ? <Pause size={13} /> : <Play size={13} />} onClick={() => setLive(!live)}>
                {live ? "Стоп" : "Пуск"}
              </Button>
            </div>
          }
        >
          <div className="rounded-xl p-2 bg-[#020805] border border-[#123a20]">
            {sp && (
              <Plot
                variant="instrument"
                height={300}
                series={[
                  ...(maxHold && hold.current ? [{ name: "Max hold", x: sp.f, y: hold.current, color: "#2e7d4f", width: 1 }] : []),
                  { name: "Трасса", x: sp.f, y: sp.dbm, color: "#4ade80", width: 1.3 },
                ]}
                xDomain={[sp.center_hz - sp.span_hz / 2, sp.center_hz + sp.span_hz / 2]}
                yDomain={[-130, 10]}
                xFmt={(v) => shortNum(v - sp.center_hz)}
                yFmt={(v) => v.toFixed(0)}
                tooltipX={(v) => fmtF(v, 6)}
              />
            )}
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-[11.5px] text-muted">Обзор:</span>
            <Segmented size="sm" value={span} onChange={setSpan} options={SPANS.map(([l, v]) => ({ value: v, label: l }))} />
            <div className="flex-1" />
            {sp && <Badge tone={sp.carrier_dbm > -50 ? "rf" : "muted"}>несущая {sp.carrier_dbm.toFixed(1)} dBm</Badge>}
          </div>
          {sp && sp.markers.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sp.markers.slice(1, 8).map(([f, l, n], i) => (
                <Badge key={i} tone="muted">
                  {n}: {shortNum(f - sp.center_hz)}Гц · {l.toFixed(0)} dBm
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 mt-4 xl:grid-cols-2">
        <Card title="Паразитные составляющие (оценка)" subtitle="Уровень относительно несущей после фильтрации петлёй">
          {nr && nr.spurs.length > 0 ? (
            <table className="w-full text-[12px] num">
              <thead className="text-muted text-[10.5px] uppercase tracking-wider">
                <tr className="text-left border-b border-line">
                  <th className="py-1.5 font-medium">Тип</th>
                  <th className="py-1.5 font-medium">Отстройка</th>
                  <th className="py-1.5 font-medium">Уровень</th>
                  <th className="py-1.5 font-medium">Описание</th>
                </tr>
              </thead>
              <tbody>
                {nr.spurs.map((s, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className="py-1.5">
                      <Badge tone={s.kind === "pfd" ? "pfd" : s.kind === "ibs" ? "warn" : "dig"}>{s.kind === "pfd" ? "PFD" : s.kind === "ibs" ? "IBS" : "дробный"}</Badge>
                    </td>
                    <td className="py-1.5">{fmtF(s.offset_hz, 4)}</td>
                    <td className={`py-1.5 font-medium ${s.level_dbc > -60 ? "text-warn" : ""}`}>{s.level_dbc.toFixed(1)} dBc</td>
                    <td className="py-1.5 text-fg2 font-sans">{s.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[12px] text-muted">Существенных паразитных составляющих не ожидается.</div>
          )}
        </Card>
        <Card title="Что влияет на шум" subtitle="Подсказки по текущей конфигурации">
          <ul className="text-[12.5px] text-fg2 leading-relaxed list-disc ml-4 space-y-1">
            <li>
              Нормированный пол PLL: −231 + 10·log(fPFD) + 20·log(N) ={" "}
              <b className="text-fg num">{(-231 + 10 * Math.log10(Math.max(d.f_pfd, 1)) + 20 * Math.log10(Math.max(d.n_loop, 1))).toFixed(1)} dBc/Гц</b>. Выше fPFD → ниже шум в полосе.
            </li>
            <li>
              Ток накачки {d.icp_ma.toFixed(2)} мА: больший ICP уменьшает вклад шума накачки, но расширяет полосу — пересчитайте фильтр.
            </li>
            <li>Каждое деление M0 на 2 даёт −6 дБ к шуму ГУН и PLL до уровня пола выходного буфера (≈ −158 dBc/Гц).</li>
            <li>
              {d.integer_mode
                ? "Сейчас Integer-N: ΣΔ выключен, дробных спуров нет."
                : `Frac-N: ΣΔ ${d.sdm_order}-го порядка. Режим ${snap.fields.NOISE_MODE === 3 ? "Low Spur (dither) размазывает спуры в шум" : "Low Noise — ниже шум, возможны дробные спуры"}.`}
            </li>
            <li>Опора: шум TCXO растёт на 20·log(fVCO/fREF) = {(20 * Math.log10(Math.max(d.f_vco, 1) / Math.max(d.f_ref, 1))).toFixed(1)} дБ внутри полосы петли.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
