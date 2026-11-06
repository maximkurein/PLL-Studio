import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Crosshair, Sparkles, Wand2 } from "lucide-react";
import { useStore } from "../lib/store";
import { fmtF, fmtFreq } from "../lib/format";
import type { Candidate, PlanResult } from "../lib/types";
import { Badge, Button, Card, FreqField, Hint, NumField, PageHeader, Row, Segmented, Toggle, cx } from "../components/ui";

type Tri = "auto" | "on" | "off";

const PRESETS: [string, number][] = [
  ["34.375 МГц", 34.375e6],
  ["100 МГц", 100e6],
  ["433.92 МГц", 433.92e6],
  ["868 МГц", 868e6],
  ["1 ГГц", 1e9],
  ["1.2345 ГГц", 1.2345e9],
  ["1.575 ГГц (GPS)", 1.57542e9],
  ["2.45 ГГц", 2.45e9],
  ["3.5 ГГц", 3.5e9],
  ["4.4 ГГц", 4.4e9],
];

const VCO_MIN = 2.2e9,
  VCO_MAX = 4.4e9;

function VcoBar({ fvco }: { fvco: number }) {
  const pos = (f: number) => ((f - VCO_MIN) / (VCO_MAX - VCO_MIN)) * 100;
  const cores = [
    [2.2e9, 2.93e9],
    [2.93e9, 3.66e9],
    [3.66e9, 4.4e9],
  ];
  const inRange = fvco >= VCO_MIN && fvco <= VCO_MAX;
  return (
    <div>
      <div className="relative h-8 rounded-lg overflow-hidden flex border border-line">
        {cores.map(([a, b], i) => {
          const on = fvco >= a && fvco < b + (i === 2 ? 1 : 0);
          return (
            <div
              key={i}
              className={cx("h-full grid place-items-center text-[10.5px] border-r border-line last:border-r-0", on ? "text-fg font-semibold" : "text-muted")}
              style={{ width: `${pos(b) - pos(a)}%`, background: on ? "color-mix(in srgb, var(--rf) 22%, transparent)" : "var(--panel-2)" }}
            >
              ядро {i + 1}
            </div>
          );
        })}
        {inRange && <div className="absolute top-0 bottom-0 w-[2px] bg-rf shadow-[0_0_8px_var(--rf)]" style={{ left: `calc(${pos(fvco)}% - 1px)` }} />}
      </div>
      <div className="flex justify-between text-[10.5px] text-muted mt-1 num">
        <span>2.2 ГГц</span>
        <span>3.3 ГГц</span>
        <span>4.4 ГГц</span>
      </div>
    </div>
  );
}

function OutBar({ fout, m0 }: { fout: number; m0: number }) {
  const lo = Math.log10(34.375e6),
    hi = Math.log10(4.4e9);
  const pos = (f: number) => ((Math.log10(f) - lo) / (hi - lo)) * 100;
  const divs = [1, 2, 4, 8, 16, 32, 64];
  return (
    <div>
      <div className="relative h-8 rounded-lg overflow-hidden border border-line flex flex-row-reverse">
        {divs.map((m) => {
          const a = Math.max(34.375e6, VCO_MIN / m),
            b = VCO_MAX / m;
          const on = m === m0;
          return (
            <div
              key={m}
              className={cx("h-full grid place-items-center text-[10.5px] border-l border-line", on ? "text-fg font-semibold" : "text-muted")}
              style={{ width: `${pos(b) - pos(a)}%`, background: on ? "color-mix(in srgb, var(--rf-2) 22%, transparent)" : "var(--panel-2)" }}
            >
              ÷{m}
            </div>
          );
        })}
        {fout > 0 && <div className="absolute top-0 bottom-0 w-[2px] bg-rf2" style={{ left: `calc(${pos(Math.min(Math.max(fout, 34.375e6), 4.4e9))}% - 1px)` }} />}
      </div>
      <div className="flex justify-between text-[10.5px] text-muted mt-1 num">
        <span>34.375 МГц</span>
        <span>275 МГц</span>
        <span>4.4 ГГц</span>
      </div>
    </div>
  );
}

export function PlannerView() {
  const snap = useStore((s) => s.snap)!;
  const call = useStore((s) => s.call);
  const toast = useStore((s) => s.toast);
  const d = snap.derived;
  const [target, setTarget] = useState(d.f_out_a > 0 ? d.f_out_a : 2.45e9);
  const [useStep, setUseStep] = useState(false);
  const [step, setStep] = useState(1e6);
  const [doubler, setDoubler] = useState<Tri>("auto");
  const [div2, setDiv2] = useState<Tri>("auto");
  const [rFixed, setRFixed] = useState(0);
  const [pfdMax, setPfdMax] = useState(125e6);
  const [allow16, setAllow16] = useState(true);
  const [preferInt, setPreferInt] = useState(false);
  const [res, setRes] = useState<PlanResult | null>(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);

  const req = useMemo(
    () => ({
      target_hz: target,
      ref_hz: snap.settings.ref_hz,
      channel_step_hz: useStep ? step : null,
      doubler,
      div2,
      r_fixed: rFixed > 0 ? rFixed : null,
      pfd_max_hz: pfdMax,
      allow_16bit: allow16,
      prefer_integer: preferInt,
      loop_bw_hz: Math.max(1e3, snap.loop.fc_hz),
      count: 14,
    }),
    [target, snap.settings.ref_hz, useStep, step, doubler, div2, rFixed, pfdMax, allow16, preferInt, snap.loop.fc_hz]
  );

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await call<PlanResult>("plan", req, true);
      if (alive) {
        setRes(r);
        setPick(0);
        setBusy(false);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [req, call]);

  const best = res?.candidates[pick];

  const apply = async (c: Candidate) => {
    const r = await call("apply_plan", { fields: c.fields, enable_output: true });
    if (r) toast("ok", `Настроено: ${fmtFreq(c.f_out, 6)} (fPFD ${fmtF(c.f_pfd, 4)}, N = ${c.int} + ${c.frac}/${c.modulus})`);
  };

  const nudge = async (dir: number) => {
    const s = useStep ? step : Math.max(d.channel_step_hz, 1);
    const hz = d.f_out_a + dir * s;
    const r = await call<{ candidate: Candidate }>("tune", { hz, step_hz: useStep ? step : null });
    if (r) setTarget(hz);
  };

  return (
    <div className="max-w-[1500px]">
      <PageHeader
        icon={<Crosshair size={20} />}
        title="Планировщик частоты"
        subtitle="Введите желаемую частоту — движок на Rust переберёт удвоитель, R, ÷2 и точно (рационально) подберёт INT/FRAC/MOD, оценив шум и паразитные составляющие каждого варианта."
      />

      <div className="grid gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Цель" icon={<Sparkles size={15} />}>
            <div className="flex items-center gap-2">
              <FreqField hz={target} onCommit={setTarget} big width="flex-1 min-w-0" />
            </div>
            <div className="text-[11px] text-muted mt-1.5">Форматы: 2450 (МГц), 2.45G, 433.92 МГц, 125k. Диапазон 34.375 МГц – 4.4 ГГц.</div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {PRESETS.map(([l, f]) => (
                <button
                  key={l}
                  onClick={() => setTarget(f)}
                  className={cx("rounded-full border px-2.5 h-6 text-[11.5px] transition-colors", Math.abs(target - f) < 1 ? "border-accent text-accent bg-accent/10" : "border-line text-fg2 hover:border-line2")}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <div className="text-[11.5px] text-muted mb-1">ГУН: {res ? fmtF(res.f_vco_target, 6) : "—"}</div>
                <VcoBar fvco={res?.f_vco_target ?? 0} />
              </div>
              <div>
                <div className="text-[11.5px] text-muted mb-1">Выходной делитель M0 = {res?.m0 ?? "—"}</div>
                <OutBar fout={target} m0={res?.m0 ?? 1} />
              </div>
            </div>
          </Card>

          <Card title="Ограничения поиска" icon={<Wand2 size={15} />}>
            <Row label="Опора" hint={snap.settings.ref_source === "tcxo" ? "TCXO на плате" : "SMA J1"}>
              <span className="num text-[13px] font-medium text-ref">{fmtF(snap.settings.ref_hz, 6)}</span>
            </Row>
            <Row label="Шаг сетки" hint="желаемое разрешение по частоте">
              <Toggle checked={useStep} onChange={setUseStep} />
              {useStep && <FreqField hz={step} onCommit={setStep} width="w-32" />}
            </Row>
            <Row label="Удвоитель ×2">
              <Segmented size="sm" value={doubler} onChange={setDoubler} options={[{ value: "auto", label: "Авто" }, { value: "on", label: "Вкл" }, { value: "off", label: "Выкл" }]} />
            </Row>
            <Row label="Делитель ÷2">
              <Segmented size="sm" value={div2} onChange={setDiv2} options={[{ value: "auto", label: "Авто" }, { value: "on", label: "Вкл" }, { value: "off", label: "Выкл" }]} />
            </Row>
            <Row label="R фиксирован" hint="0 — перебор">
              <NumField value={rFixed} min={0} max={1023} onCommit={setRFixed} width="w-16" />
            </Row>
            <Row label="Макс. fPFD">
              <FreqField hz={pfdMax} onCommit={setPfdMax} width="w-32" />
            </Row>
            <Row label="16-битный MOD" hint="через расширенный R7">
              <Toggle checked={allow16} onChange={setAllow16} />
            </Row>
            <Row label="Предпочесть Int-N" hint="меньше спуров, если возможно">
              <Toggle checked={preferInt} onChange={setPreferInt} />
            </Row>
          </Card>

          <Card title="Быстрая перестройка" subtitle="Шаг ± применяется сразу (tune), фильтр петли не меняется">
            <div className="flex items-center gap-2">
              <Button icon={<ChevronLeft size={14} />} onClick={() => nudge(-1)}>
                −шаг
              </Button>
              <div className="flex-1 text-center num text-[13px] font-semibold text-rf">{fmtFreq(d.f_out_a, 6)}</div>
              <Button onClick={() => nudge(1)}>
                +шаг <ChevronRight size={14} />
              </Button>
            </div>
            <div className="text-[11px] text-muted mt-2 text-center">шаг: {fmtF(useStep ? step : d.channel_step_hz, 4)}</div>
          </Card>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          {res?.error && <Hint tone="err">{res.error}</Hint>}
          <Card
            title="Варианты конфигурации"
            subtitle={busy ? "поиск…" : res ? `${res.candidates.length} решений, отсортированы по оценке качества` : ""}
            bodyClass="!px-0"
          >
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-[12px] num">
                <thead className="text-muted text-[10.5px] uppercase tracking-wider">
                  <tr className="text-left border-b border-line">
                    <th className="px-4 py-1.5 font-medium">#</th>
                    <th className="px-2 py-1.5 font-medium">fPFD</th>
                    <th className="px-2 py-1.5 font-medium">×2 / R / ÷2</th>
                    <th className="px-2 py-1.5 font-medium">INT</th>
                    <th className="px-2 py-1.5 font-medium">FRAC / MOD</th>
                    <th className="px-2 py-1.5 font-medium">Ошибка</th>
                    <th className="px-2 py-1.5 font-medium">Шум в полосе</th>
                    <th className="px-2 py-1.5 font-medium">Ближний спур</th>
                    <th className="px-2 py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {res?.candidates.map((c, i) => (
                    <tr
                      key={i}
                      onClick={() => setPick(i)}
                      className={cx("border-b border-line/60 cursor-pointer", i === pick ? "bg-accent/8" : "hover:bg-panel2")}
                    >
                      <td className="px-4 py-1.5 text-muted">{i + 1}</td>
                      <td className="px-2 py-1.5 font-medium text-pfd">{fmtF(c.f_pfd, 5)}</td>
                      <td className="px-2 py-1.5">
                        {c.doubler ? "×2" : "—"} / {c.r} / {c.div2 ? "÷2" : "—"}
                      </td>
                      <td className="px-2 py-1.5">{c.int}</td>
                      <td className="px-2 py-1.5">
                        {c.integer_mode ? (
                          <Badge tone="ok">Int-N</Badge>
                        ) : (
                          <>
                            {c.frac}/{c.modulus}
                            {c.hi_res && <Badge className="ml-1" tone="accent">16b</Badge>}
                          </>
                        )}
                      </td>
                      <td className={cx("px-2 py-1.5", Math.abs(c.error_hz) > 0.5 ? "text-warn" : "text-ok")}>{Math.abs(c.error_hz) < 1e-3 ? "0" : `${c.error_hz.toFixed(3)} Гц`}</td>
                      <td className="px-2 py-1.5">{c.inband_dbc.toFixed(1)} dBc/Гц</td>
                      <td className="px-2 py-1.5">{c.ibs_offset_hz != null ? fmtF(c.ibs_offset_hz, 3) : "—"}</td>
                      <td className="px-2 py-1.5 pr-4">
                        <Button size="sm" variant={i === pick ? "primary" : "ghost"} onClick={() => apply(c)}>
                          Применить
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {res && res.candidates.length === 0 && !res.error && <div className="py-10 text-center text-muted">Нет решений с такими ограничениями</div>}
            </div>
          </Card>

          {best && (
            <Card title={`Вариант ${pick + 1}: ${fmtFreq(best.f_out, 6)}`} subtitle="Что будет записано и почему" actions={<Button variant="primary" icon={<Check size={14} />} onClick={() => apply(best)}>Применить и включить RF_OUTA</Button>}>
              <div className="formula selectable">
                {`fPFD = ${fmtF(snap.settings.ref_hz, 6)} × ${best.doubler ? 2 : 1} / (${best.r} × ${best.div2 ? 2 : 1}) = ${fmtF(best.f_pfd, 6)}\n`}
                {`N    = ${best.int} + ${best.frac}/${best.modulus} = ${(best.int + best.frac / best.modulus).toFixed(9)}\n`}
                {`fVCO = fPFD × N = ${fmtF(best.f_vco, 6)}    →  ÷${best.m0}  →  fOUT = ${fmtF(best.f_out, 6)}`}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  {best.notes.map((n, i) => (
                    <div key={i} className="text-[12px] text-fg2 flex gap-2">
                      <span className="text-accent">•</span>
                      {n}
                    </div>
                  ))}
                  {best.frac_spur_step_hz > 0 && <div className="text-[12px] text-fg2 flex gap-2"><span className="text-accent">•</span>Сетка дробных спуров: {fmtF(best.frac_spur_step_hz, 3)}</div>}
                </div>
                <div className="flex flex-wrap gap-1.5 content-start">
                  {Object.entries(best.fields).map(([k, v]) => (
                    <span key={k} className={cx("rounded-md border px-1.5 h-6 inline-flex items-center gap-1 text-[11px] font-mono", snap.fields[k] === v ? "border-line text-muted" : "border-accent/40 text-accent bg-accent/8")}>
                      {k}={v}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
