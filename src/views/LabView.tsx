import { useEffect, useRef, useState } from "react";
import { Bug, FlaskConical, Play, Repeat, Square, Thermometer, Timer, Waves } from "lucide-react";
import { useSim, useStore } from "../lib/store";
import { rpc } from "../lib/api";
import { fmtF, fmtTime } from "../lib/format";
import type { Derived, SimStatus, Status } from "../lib/types";
import { Plot } from "../components/Plot";
import { Badge, Button, Card, FreqField, Hint, NumField, PageHeader, Row, Slider, Stat, Toggle } from "../components/ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SweepRow {
  hz: number;
  fout: number;
  vtune: number | null;
  core: number | null;
  lock_us: number | null;
  locked: boolean;
  m0: number;
}

function useRunner() {
  const [running, setRunning] = useState(false);
  const flag = useRef(false);
  useEffect(() => () => void (flag.current = false), []);
  return {
    running,
    flag,
    start: () => {
      flag.current = true;
      setRunning(true);
    },
    stop: () => {
      flag.current = false;
      setRunning(false);
    },
  };
}

async function tuneAndMeasure(hz: number, dwell: number): Promise<SweepRow | null> {
  const call = useStore.getState().call;
  const r = await call<{ derived: Derived; sim: SimStatus | null }>("tune", { hz }, true);
  if (!r) return null;
  await sleep(dwell);
  const st = await rpc<Status>("status");
  useStore.setState({ status: st });
  const s = st.sim;
  return { hz, fout: r.derived.f_out_a, vtune: s?.vtune ?? null, core: s?.vco_core ?? null, lock_us: s?.lock_time_us ?? null, locked: s?.locked ?? !!st.ld, m0: r.derived.m0 };
}

function SweepCard() {
  const [start, setStart] = useState(1e9);
  const [stop, setStop] = useState(4.4e9);
  const [points, setPoints] = useState(40);
  const [dwell, setDwell] = useState(60);
  const [rows, setRows] = useState<SweepRow[]>([]);
  const run = useRunner();

  const go = async () => {
    run.start();
    const acc: SweepRow[] = [];
    setRows([]);
    for (let i = 0; i < points && run.flag.current; i++) {
      const hz = start + ((stop - start) * i) / Math.max(1, points - 1);
      const r = await tuneAndMeasure(hz, dwell);
      if (r) {
        acc.push(r);
        setRows([...acc]);
      }
    }
    run.stop();
  };

  const unlocked = rows.filter((r) => !r.locked).length;
  return (
    <Card
      title="Свип частоты"
      icon={<Waves size={15} />}
      subtitle="Перестройка по сетке точек с измерением VTUNE, ядра ГУН и времени захвата в каждой точке"
      actions={
        run.running ? (
          <Button variant="danger" size="sm" icon={<Square size={12} />} onClick={run.stop}>
            Стоп
          </Button>
        ) : (
          <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={go}>
            Запуск
          </Button>
        )
      }
    >
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-fg2 mb-3">
        <label className="flex items-center gap-2">
          от <FreqField hz={start} onCommit={setStart} width="w-28" />
        </label>
        <label className="flex items-center gap-2">
          до <FreqField hz={stop} onCommit={setStop} width="w-28" />
        </label>
        <label className="flex items-center gap-2">
          точек <NumField value={points} min={2} max={500} onCommit={setPoints} width="w-12" />
        </label>
        <label className="flex items-center gap-2">
          пауза <NumField value={dwell} min={0} max={5000} onCommit={setDwell} width="w-12" unit="мс" />
        </label>
      </div>
      {rows.length > 1 ? (
        <Plot
          height={240}
          series={[
            { name: "VTUNE, В", x: rows.map((r) => r.fout), y: rows.map((r) => r.vtune ?? NaN), color: "var(--pfd)", width: 2 },
            { name: "Захват, мкс", x: rows.map((r) => r.fout), y: rows.map((r) => r.lock_us ?? NaN), color: "var(--rf)", axis: "y2", width: 1.4 },
          ]}
          hMarkers={[
            { y: 0.5, label: "0.5 В", color: "var(--err)" },
            { y: 2.5, label: "2.5 В", color: "var(--err)" },
          ]}
          yDomain={[0, 3.3]}
          y2Domain={[0, Math.max(10, ...rows.map((r) => r.lock_us ?? 0)) * 1.25]}
          xFmt={(v) => fmtF(v, 2)}
          yFmt={(v) => v.toFixed(1)}
          y2Fmt={(v) => v.toFixed(0)}
          tooltipX={(v) => fmtF(v, 5)}
          legend
        />
      ) : (
        <div className="h-[240px] grid place-items-center text-[12px] text-muted border border-dashed border-line rounded-xl">
          Запустите свип — график VTUNE и времени захвата построится по точкам
        </div>
      )}
      {rows.length > 0 && (
        <div className="flex gap-2 mt-2 flex-wrap">
          <Badge tone="muted">{rows.length} точек</Badge>
          <Badge tone={unlocked ? "err" : "ok"}>{unlocked ? `${unlocked} без захвата` : "захват во всех точках"}</Badge>
          <Badge tone="muted">
            ядра ГУН: {[...new Set(rows.map((r) => (r.core ?? -1) + 1))].filter((c) => c > 0).join(", ")}
          </Badge>
          <Badge tone="muted">M0: {[...new Set(rows.map((r) => r.m0))].join(", ")}</Badge>
        </div>
      )}
    </Card>
  );
}

function HopCard() {
  const [fa, setFa] = useState(2.4e9);
  const [fb, setFb] = useState(2.48e9);
  const [period, setPeriod] = useState(400);
  const [hist, setHist] = useState<{ n: number; hz: number; lock_us: number | null }[]>([]);
  const run = useRunner();
  const go = async () => {
    run.start();
    const acc: typeof hist = [];
    let n = 0;
    while (run.flag.current && n < 200) {
      const hz = n % 2 ? fb : fa;
      const r = await tuneAndMeasure(hz, Math.max(30, period));
      if (r) {
        acc.push({ n, hz, lock_us: r.lock_us });
        setHist(acc.slice(-60));
      }
      n++;
    }
    run.stop();
  };
  const lt = hist.map((h) => h.lock_us).filter((v): v is number => v != null);
  const avg = lt.length ? lt.reduce((a, b) => a + b, 0) / lt.length : null;
  return (
    <Card
      title="Прыжки частоты A ↔ B"
      icon={<Repeat size={15} />}
      subtitle="Каждый прыжок — запись R0, калибровка ГУН и захват петли"
      actions={
        run.running ? (
          <Button variant="danger" size="sm" icon={<Square size={12} />} onClick={run.stop}>
            Стоп
          </Button>
        ) : (
          <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={go}>
            Запуск
          </Button>
        )
      }
    >
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-fg2 mb-3">
        <label className="flex items-center gap-2">
          A <FreqField hz={fa} onCommit={setFa} width="w-28" />
        </label>
        <label className="flex items-center gap-2">
          B <FreqField hz={fb} onCommit={setFb} width="w-28" />
        </label>
        <label className="flex items-center gap-2">
          период <NumField value={period} min={30} max={10000} onCommit={setPeriod} width="w-14" unit="мс" />
        </label>
      </div>
      <div className="flex items-end gap-[3px] h-28 border-b border-line">
        {hist.map((h) => (
          <div
            key={h.n}
            title={`${fmtF(h.hz, 4)}: ${h.lock_us?.toFixed(1) ?? "—"} мкс`}
            className="flex-1 rounded-t"
            style={{
              height: `${Math.min(100, ((h.lock_us ?? 0) / Math.max(...lt, 1)) * 100)}%`,
              background: h.n % 2 ? "var(--rf-2)" : "var(--ref)",
              minHeight: 2,
            }}
          />
        ))}
      </div>
      <div className="flex gap-2 mt-2 text-[12px]">
        <Badge tone="ref">A</Badge>
        <Badge tone="rf">B</Badge>
        <span className="text-muted">Среднее время захвата:</span>
        <b className="num">{avg != null ? fmtTime(avg * 1e-6) : "—"}</b>
      </div>
    </Card>
  );
}

function TempCard() {
  const sim = useSim();
  const snap = useStore((s) => s.snap)!;
  const call = useStore((s) => s.call);
  const setField = useStore((s) => s.setField);
  const [t, setT] = useState(sim?.temp_c ?? 25);
  if (!sim)
    return (
      <Card title="Температурный дрейф" icon={<Thermometer size={15} />}>
        <Hint>Эксперимент доступен в режиме симулятора. С реальной платой используйте термокамеру или фен и наблюдайте LD и спектр.</Hint>
      </Card>
    );
  const dt = sim.temp_c - sim.cal_temp_c;
  return (
    <Card title="Температурный дрейф ГУН" icon={<Thermometer size={15} />} subtitle="Калибровка выбирает поддиапазон при текущей температуре; дальше петля компенсирует дрейф через VTUNE">
      <Row label={`Температура ${t.toFixed(0)} °C`} hint={`калибровка была при ${sim.cal_temp_c.toFixed(0)} °C (Δ ${dt > 0 ? "+" : ""}${dt.toFixed(0)} °C)`}>
        <Slider
          value={t}
          min={-40}
          max={125}
          step={1}
          onChange={(v) => {
            setT(v);
            void call("sim_control", { temp_c: v }, true);
          }}
        />
      </Row>
      <div className="grid grid-cols-3 gap-2 my-2">
        <Stat label="VTUNE" value={sim.vtune.toFixed(3)} unit="В" tone={sim.vtune < 0.5 || sim.vtune > 2.5 ? "err" : "pfd"} />
        <Stat label="Состояние" value={sim.locked ? "захват" : "нет"} tone={sim.locked ? "ok" : "err"} />
        <Stat label="fVCO сейчас" value={fmtF(sim.f_vco_now, 4)} />
      </div>
      <div className="relative h-3 rounded-full bg-panel3 overflow-hidden my-2">
        <div className="absolute inset-y-0 bg-ok/25" style={{ left: `${(0.5 / 3.3) * 100}%`, width: `${(2 / 3.3) * 100}%` }} />
        <div className="absolute inset-y-0 w-1 rounded bg-pfd" style={{ left: `calc(${Math.min(100, Math.max(0, (sim.vtune / 3.3) * 100))}% - 2px)` }} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => call("write_register", { index: 0 })}>
          Перекалибровать (R0)
        </Button>
        <Toggle checked={!!snap.fields.BAND_SEL_DISABLE} onChange={(v) => setField("BAND_SEL_DISABLE", v ? 1 : 0)} label="BAND_SEL_DISABLE" />
      </div>
      <p className="text-[11.5px] text-muted mt-2 leading-relaxed">
        Даташит гарантирует удержание захвата при изменении температуры после калибровки на всём диапазоне (−40…+85 °C). Попробуйте откалибровать при −40 °C и нагреть до
        +125 °C — VTUNE уйдёт к краю и петля потеряет захват.
      </p>
    </Card>
  );
}

function PhaseCard() {
  const snap = useStore((s) => s.snap)!;
  const call = useStore((s) => s.call);
  const d = snap.derived;
  const [ph, setPh] = useState(d.phase);
  useEffect(() => setPh(d.phase), [d.phase]);
  const apply = async (p: number) => {
    const hi = d.hi_res;
    const fields: Record<string, number> = hi ? { PHASE: (p >> 4) & 0xfff, EXT_PHASE: p & 15 } : { PHASE: p & 0xfff };
    await call("set_fields", { values: fields }, true);
    if (!snap.auto_apply) await call("apply", {}, true);
  };
  return (
    <Card title="Сдвиг фазы выхода" icon={<Timer size={15} />} subtitle="PHASE задаёт сдвиг 360°·PHASE/MOD относительно опоры (двойная буферизация — применяется записью R0)">
      {d.integer_mode ? (
        <Hint>Сдвиг фазы работает в дробном режиме (FRAC ≠ 0). Выберите частоту с дробным N в планировщике.</Hint>
      ) : (
        <>
          <Row label={`PHASE = ${ph}`} hint={`шаг ${d.phase_step_deg.toFixed(4)}°`}>
            <Slider value={ph} min={0} max={Math.max(1, d.modulus - 1)} onChange={(v) => setPh(Math.round(v))} />
            <Button size="sm" onClick={() => apply(ph)}>
              Применить
            </Button>
          </Row>
          <svg viewBox="0 0 400 90" className="w-full h-auto mt-1">
            {[0, 1].map((k) => {
              const shift = k ? (((ph / Math.max(1, d.modulus)) * 360) % 360) / 360 : 0;
              let p = "";
              for (let x = 0; x <= 400; x += 4) {
                const y = 22 + k * 44 - 14 * Math.sin(((x / 400) * 3 - shift) * 2 * Math.PI);
                p += (x ? "L" : "M") + x + " " + y.toFixed(1);
              }
              return <path key={k} d={p} stroke={k ? "var(--rf)" : "var(--ref)"} fill="none" strokeWidth={1.8} />;
            })}
          </svg>
          <div className="text-[12px] text-fg2">
            Текущий сдвиг: <b className="num">{d.phase_deg.toFixed(3)}°</b> (после записи R0)
          </div>
        </>
      )}
    </Card>
  );
}

function FaultCard() {
  const snap = useStore((s) => s.snap)!;
  const sim = useSim();
  const call = useStore((s) => s.call);
  const setField = useStore((s) => s.setField);
  const F = snap.fields;
  return (
    <Card title="Отказы и защитные механизмы" icon={<Bug size={15} />} subtitle="Посмотрите, как кристалл реагирует на ошибки и как это видно в флагах R6/R7">
      <div className="flex flex-col gap-1">
        <Row label="CP в Hi-Z" hint="петля разомкнута — ГУН дрейфует">
          <Toggle checked={!!F.CP_HIGHZ} onChange={(v) => setField("CP_HIGHZ", v ? 1 : 0)} tone="warn" />
        </Row>
        <Row label="MTLD" hint="выход молчит до захвата">
          <Toggle checked={!!F.MTLD} onChange={(v) => setField("MTLD", v ? 1 : 0)} />
        </Row>
        <Row label="Программный POWER_DOWN">
          <Toggle checked={!!F.POWER_DOWN} onChange={(v) => setField("POWER_DOWN", v ? 1 : 0)} tone="err" />
        </Row>
        <Row label="Вывод CE">
          <Toggle checked={snap.pins.ce} onChange={(v) => call("set_pins", { ce: v })} tone="ok" />
        </Row>
        <Row label="SPI-ошибка" hint="кадр из 31 такта (только симулятор)">
          <Button size="sm" disabled={!sim} onClick={() => call("sim_control", { inject_spi_error: true })}>
            Внедрить
          </Button>
        </Row>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        <Badge tone={sim?.band_sel_done ? "ok" : "muted"}>BAND_SEL_DONE</Badge>
        <Badge tone={sim?.loss_dig_lock ? "err" : "muted"}>LOSS_DIG_LOCK</Badge>
        <Badge tone={sim?.loss_anlg_lock ? "err" : "muted"}>LOSS_ANLG_LOCK</Badge>
        <Badge tone={sim?.spi_error ? "err" : "muted"}>SPI_ERROR</Badge>
        <Button size="sm" variant="ghost" onClick={() => call("clear_sticky")}>
          Сбросить sticky
        </Button>
      </div>
      {sim?.reason && <div className="text-[12px] text-warn mt-2">{sim.reason}</div>}
    </Card>
  );
}

export function LabView() {
  return (
    <div className="max-w-[1600px]">
      <PageHeader
        icon={<FlaskConical size={20} />}
        title="Лаборатория"
        subtitle="Готовые эксперименты. Работают с симулятором и с реальной платой (через SPI-мост); на реальной плате результаты смотрите на анализаторе спектра."
      />
      <div className="grid gap-4 2xl:grid-cols-2">
        <SweepCard />
        <HopCard />
        <TempCard />
        <PhaseCard />
        <FaultCard />
      </div>
    </div>
  );
}
