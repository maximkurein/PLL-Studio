import { useCallback, useEffect, useRef, useState } from "react";
import { BookmarkPlus, ChevronLeft, ChevronRight, Lock, Play, Power, Radio, Repeat, ScanLine, Square, Trash2, Waves } from "lucide-react";
import { lockInfo, useSim, useStore } from "../lib/store";
import { fmtF, fmtFreq, fmtTime } from "../lib/format";
import type { Derived, GenPreset, ScopeView } from "../lib/types";
import { Badge, Button, Card, FreqField, Hint, Led, NumField, Segmented, Toggle, cx } from "../components/ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const F_MIN = 34.375e6;
const F_MAX = 4.4e9;
const clampF = (hz: number, lo = F_MIN, hi = F_MAX) => Math.min(hi, Math.max(lo, hz));

const STEPS: [string, number][] = [
  ["1 Гц", 1],
  ["1 кГц", 1e3],
  ["10 кГц", 1e4],
  ["100 кГц", 1e5],
  ["1 МГц", 1e6],
  ["10 МГц", 1e7],
  ["100 МГц", 1e8],
];

/** Quick frequencies that a 600 MHz scope shows well, plus a few RF bands. */
const QUICK: number[] = [34.375e6, 50e6, 100e6, 200e6, 300e6, 433.92e6, 500e6, 600e6, 868e6, 1e9, 2.45e9];

const fmtV = (v: number) => (v >= 1 ? `${v.toFixed(2)} В` : `${(v * 1e3).toFixed(v < 0.01 ? 1 : 0)} мВ`);
const fmtDbm = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)} dBm`;

interface GenArgs {
  hz?: number;
  level_dbm?: number;
  rf_on?: boolean;
}
interface GenReply {
  derived: Derived;
  candidate: { error_hz: number; f_out: number } | null;
}

/**
 * Coalescing writer: while one gen_set is on the wire, later requests merge
 * into one pending call, so a fast wheel never queues dozens of USB writes.
 */
function useGenWriter(onDone: (r: GenReply | null, sent: GenArgs) => void) {
  const pending = useRef<GenArgs | null>(null);
  const busy = useRef(false);
  const [inflight, setInflight] = useState(false);
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setInflight(true);
    while (pending.current) {
      const args = pending.current;
      pending.current = null;
      const r = await useStore.getState().call<GenReply>("gen_set", args as Record<string, unknown>);
      onDone(r, args);
    }
    busy.current = false;
    setInflight(false);
  }, [onDone]);
  const send = useCallback(
    (a: GenArgs) => {
      pending.current = { ...(pending.current ?? {}), ...a };
      void pump();
    },
    [pump]
  );
  /** Direct write that waits for its own reply (sweep). */
  const sendNow = useCallback(async (a: GenArgs) => {
    while (busy.current) await sleep(5);
    busy.current = true;
    const r = await useStore.getState().call<GenReply>("gen_set", a as Record<string, unknown>, true);
    busy.current = false;
    return r;
  }, []);
  return { send, sendNow, inflight, busyRef: busy };
}

// ───────────────────────── big digit display ─────────────────────────

/** 4 400.000 000 МГц: exponents 9…0 of the frequency in Hz. */
function FreqDigits({ hz, sel, onSel, onChange, disabled }: { hz: number; sel: number; onSel: (e: number) => void; onChange: (hz: number) => void; disabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const hzRef = useRef(hz);
  hzRef.current = hz;
  const n = Math.round(hz);
  const digits = String(n).padStart(10, "0").split("").map(Number);
  const lead = String(n).length; // significant integer digits in Hz

  // native, non-passive wheel so the page does not scroll under the cursor
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const t = (e.target as HTMLElement).closest("[data-exp]") as HTMLElement | null;
      if (!t || disabled) return;
      e.preventDefault();
      const exp = Number(t.dataset.exp);
      onSel(exp);
      const dir = e.deltaY < 0 ? 1 : -1;
      // advance the ref at once: several wheel ticks may arrive before a re-render
      hzRef.current = clampF(hzRef.current + dir * 10 ** exp);
      onChange(hzRef.current);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onChange, onSel, disabled]);

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(clampF(hz + (e.key === "ArrowUp" ? 1 : -1) * 10 ** sel));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSel(Math.min(9, sel + 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSel(Math.max(0, sel - 1));
    }
  };

  const cell = (i: number) => {
    const exp = 9 - i;
    const dim = exp >= lead && exp > 6;
    return (
      <button
        key={exp}
        type="button"
        data-exp={exp}
        tabIndex={-1}
        onClick={() => onSel(exp)}
        className={cx(
          "relative px-[1px] rounded-md transition-colors hover:bg-panel3/80",
          dim ? "text-line2" : "text-fg",
          exp === sel && "text-accent"
        )}
        title={`Колесо / ↑↓: ±${fmtF(10 ** exp)}`}
      >
        {digits[i]}
        {exp === sel && <span className="absolute left-[3px] right-[3px] -bottom-[2px] h-[3px] rounded-full bg-accent" />}
      </button>
    );
  };
  const sep = (ch: string, k: string) =>
    ch === " " ? (
      <span key={k} className="inline-block w-[0.28em]" />
    ) : (
      <span key={k} className="text-muted px-[0.04em]">
        {ch}
      </span>
    );

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={onKey}
      className={cx("outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-accent/40 inline-flex items-baseline", disabled && "opacity-60")}
    >
      <span className="font-mono num font-semibold tracking-tight leading-none text-[clamp(34px,5.2vw,64px)] flex items-baseline">
        {[cell(0), sep(" ", "s1"), cell(1), cell(2), cell(3), sep(".", "dot"), cell(4), cell(5), cell(6), sep(" ", "s2"), cell(7), cell(8), cell(9)]}
      </span>
      <span className="ml-3 text-[18px] text-muted font-medium">МГц</span>
    </div>
  );
}

// ───────────────────────── scope ─────────────────────────

function ScopeScreen({ v }: { v: ScopeView }) {
  const W = 500,
    H = 320,
    DX = 10,
    DY = 8;
  const span = v.t_div_s * DX;
  const yOf = (u: number) => H / 2 - (u / (v.v_div * DY)) * H;
  const trace = (key: "vpk_seen" | "vpk_in") => {
    let p = "";
    const N = 600;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * span;
      let u = 0;
      for (const h of v.harmonics) u += h[key] * Math.sin(2 * Math.PI * h.f_hz * t);
      p += (i ? "L" : "M") + ((i / N) * W).toFixed(1) + " " + Math.min(H + 4, Math.max(-4, yOf(u))).toFixed(1);
    }
    return p;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-xl bg-[#05080d] border border-line" role="img" aria-label="Ожидаемая осциллограмма RF_OUTA">
      {Array.from({ length: DX + 1 }, (_, i) => (
        <line key={"x" + i} x1={(i * W) / DX} x2={(i * W) / DX} y1={0} y2={H} stroke={i === DX / 2 ? "#2a3446" : "#161d2a"} strokeWidth={1} />
      ))}
      {Array.from({ length: DY + 1 }, (_, i) => (
        <line key={"y" + i} y1={(i * H) / DY} y2={(i * H) / DY} x1={0} x2={W} stroke={i === DY / 2 ? "#2a3446" : "#161d2a"} strokeWidth={1} />
      ))}
      {!v.sine_like && <path d={trace("vpk_in")} fill="none" stroke="#fbbf24" strokeOpacity={0.25} strokeWidth={1.2} strokeDasharray="3 4" />}
      <path d={trace("vpk_seen")} fill="none" stroke="#fbbf24" strokeWidth={2} style={{ filter: "drop-shadow(0 0 4px rgb(251 191 36 / 0.55))" }} />
      <text x={8} y={16} fill="#7d8aa0" fontSize={11} className="num">
        {fmtTime(v.t_div_s)}/дел · {fmtV(v.v_div)}/дел · 50 Ом
      </text>
      <text x={W - 8} y={16} fill="#fbbf24" fontSize={11} textAnchor="end" className="num">
        {fmtF(v.f_out, 4)} · {fmtV(v.vpp_seen)} пик-пик
      </text>
    </svg>
  );
}

function ScopeCard() {
  const snap = useStore((s) => s.snap)!;
  const call = useStore((s) => s.call);
  const setSettings = useStore((s) => s.setSettings);
  const d = snap.derived;
  const sim = useSim();
  const live = sim ? sim.outputs_live : d.out_a_en;
  const { scope_bw_hz: bw, scope_atten_db: att } = snap.settings;
  const [v, setV] = useState<ScopeView | null>(null);
  useEffect(() => {
    let alive = true;
    void call<ScopeView>("gen_scope", {}, true).then((r) => alive && setV(r));
    return () => void (alive = false);
  }, [call, d.f_out_a, d.pwr_a_dbm, live, bw, att]);

  return (
    <Card bodyClass="@container" title="Проверка на осциллографе" icon={<ScanLine size={15} />} subtitle="Что покажет прибор с заданной полосой: амплитуда, форма, настройки развёртки">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-fg2 mb-3">
        <label className="flex items-center gap-2">
          полоса <FreqField hz={bw} onCommit={(hz) => setSettings({ scope_bw_hz: hz })} width="w-28" />
        </label>
        <label className="flex items-center gap-2">
          аттенюатор
          <Segmented size="sm" value={att} onChange={(x) => setSettings({ scope_atten_db: x })} options={[0, 3, 6, 10, 20].map((x) => ({ value: x, label: `${x} дБ` }))} />
        </label>
      </div>
      {v && (
        <>
          <ScopeScreen v={v} />
          <div className="grid grid-cols-2 @xl:grid-cols-4 gap-2 mt-3">
            <Mini label="В полосе" value={v.in_band ? "да" : "нет"} tone={v.in_band ? "ok" : "err"} />
            <Mini label="Амплитуда 50 Ом" value={fmtV(v.vpp_50)} sub="пик-пик" />
            <Mini label="На экране" value={fmtV(v.vpp_seen)} sub={`спад ${v.rolloff_db.toFixed(1)} дБ`} />
            <Mini label="На входе" value={fmtDbm(v.at_scope_dbm)} sub={`дискр. ≥ ${(v.sample_rate_min / 1e9).toFixed(1)} Гвыб/с`} />
          </div>
          <div className="mt-3 rounded-xl border border-line bg-panel2 px-3 py-2 text-[12px] text-fg2 leading-relaxed">
            <b className="text-fg">Настройки прибора:</b> вход <b>50 Ом</b> (или проходной терминатор 50 Ом), связь DC, ограничение полосы выкл., развёртка{" "}
            <b className="num">{fmtTime(v.t_div_s)}/дел</b>, вертикаль <b className="num">{fmtV(v.v_div)}/дел</b>, синхронизация по фронту на 0 В.
            <br />
            <b className="text-fg">Подключение:</b> RF_OUTA → вход осциллографа коротким кабелем 50 Ом; неиспользуемый nRF_OUTA нагрузите на 50 Ом.
          </div>
          {v.notes.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {v.notes.map((n) => (
                <Hint key={n} tone="warn">
                  {n}
                </Hint>
              ))}
            </div>
          )}
          <div className="text-[11px] text-muted mt-2">
            Оценка: выход после делителя M0 моделируется прямоугольником с уровнем первой гармоники по даташиту; АЧХ прибора — гауссова (−3 дБ на границе полосы). Пунктир — форма без ограничения полосы.
          </div>
        </>
      )}
    </Card>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-panel2 border border-line px-3 py-2 min-w-0">
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className="text-[15px] font-semibold num truncate" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-muted truncate num">{sub}</div>}
    </div>
  );
}

// ───────────────────────── sweep ─────────────────────────

function SweepCard({ write, onPoint, running, setRunning }: { write: (a: GenArgs) => Promise<GenReply | null>; onPoint: (hz: number) => void; running: boolean; setRunning: (b: boolean) => void }) {
  const [start, setStart] = useState(50e6);
  const [stop, setStop] = useState(600e6);
  const [mode, setMode] = useState<"lin" | "log">("lin");
  const [step, setStep] = useState(10e6);
  const [points, setPoints] = useState(50);
  const [dwell, setDwell] = useState(200);
  const [repeat, setRepeat] = useState(true);
  const [bounce, setBounce] = useState(false);
  const [pos, setPos] = useState<{ i: number; n: number; hz: number } | null>(null);
  const flag = useRef(false);
  useEffect(() => () => void (flag.current = false), []);

  const grid = (): number[] => {
    const a = clampF(Math.min(start, stop)),
      b = clampF(Math.max(start, stop));
    let g: number[];
    if (mode === "lin") {
      const n = Math.min(2000, Math.floor((b - a) / Math.max(1, step) + 1e-9) + 1);
      g = Array.from({ length: n }, (_, i) => a + i * step);
    } else {
      const n = Math.max(2, Math.min(2000, points));
      g = Array.from({ length: n }, (_, i) => a * (b / a) ** (i / (n - 1)));
    }
    if (start > stop) g.reverse();
    if (bounce && g.length > 2) g = [...g, ...g.slice(1, -1).reverse()];
    return g;
  };
  const g = grid();
  const cycle = g.length * dwell;

  const go = async () => {
    flag.current = true;
    setRunning(true);
    do {
      for (let i = 0; i < g.length && flag.current; i++) {
        const t0 = performance.now();
        const r = await write({ hz: g[i] });
        if (!r) {
          flag.current = false;
          break;
        }
        onPoint(g[i]);
        setPos({ i, n: g.length, hz: g[i] });
        await sleep(Math.max(0, dwell - (performance.now() - t0)));
      }
    } while (repeat && flag.current);
    flag.current = false;
    setRunning(false);
  };
  const halt = () => {
    flag.current = false;
    setRunning(false);
  };

  return (
    <Card
      title="Свип"
      bodyClass="@container"
      icon={<Waves size={15} />}
      subtitle="Ступенчатая перестройка с паузой на каждой точке; каждая точка — запись R0 и калибровка ГУН"
      actions={
        running ? (
          <Button variant="danger" size="sm" icon={<Square size={12} />} onClick={halt}>
            Стоп
          </Button>
        ) : (
          <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={go} disabled={g.length < 2}>
            Запуск
          </Button>
        )
      }
    >
      <div className="grid grid-cols-[auto_1fr] @lg:grid-cols-[auto_1fr_auto_1fr] items-center gap-x-3 gap-y-2 text-[12px] text-fg2">
        <span>от</span>
        <FreqField hz={start} onCommit={setStart} width="w-full" />
        <span>до</span>
        <FreqField hz={stop} onCommit={setStop} width="w-full" />
        <span>шкала</span>
        <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "lin", label: "линейная" }, { value: "log", label: "логарифм." }]} />
        {mode === "lin" ? (
          <>
            <span>шаг</span>
            <FreqField hz={step} onCommit={setStep} width="w-full" />
          </>
        ) : (
          <>
            <span>точек</span>
            <NumField value={points} min={2} max={2000} onCommit={setPoints} width="w-full" />
          </>
        )}
        <span>пауза</span>
        <NumField value={dwell} min={20} max={60000} step={10} onCommit={setDwell} width="w-full" unit="мс" />
        <span />
        <div className="flex flex-wrap gap-4">
          <Toggle checked={repeat} onChange={setRepeat} label="повтор" />
          <Toggle checked={bounce} onChange={setBounce} label="туда-обратно" />
        </div>
      </div>
      <div className="mt-3">
        <div className="h-2 rounded-full bg-panel3 overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: pos ? `${((pos.i + 1) / pos.n) * 100}%` : "0%" }} />
        </div>
        <div className="flex justify-between text-[11.5px] text-muted mt-1.5 num">
          <span>
            {g.length} точек · цикл ≈ {fmtTime(cycle / 1e3)}
          </span>
          <span>{pos && running ? `${pos.i + 1}/${pos.n} · ${fmtF(pos.hz, 6)}` : "остановлен"}</span>
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────── memories ─────────────────────────

function MemoryCard({ hz, level, recall }: { hz: number; level: number; recall: (p: GenPreset) => void }) {
  const snap = useStore((s) => s.snap)!;
  const setSettings = useStore((s) => s.setSettings);
  const list = snap.settings.gen_presets ?? [];
  const save = () => {
    const p: GenPreset = { name: fmtF(hz, 6), hz, level_dbm: level };
    const next = [...list.filter((x) => !(x.hz === hz && x.level_dbm === level)), p].slice(-24);
    void setSettings({ gen_presets: next });
  };
  return (
    <Card
      title="Память"
      icon={<BookmarkPlus size={15} />}
      subtitle="Быстрый выбор частоты; сохранённые ячейки хранятся в конфигурации"
      actions={
        <Button size="sm" icon={<BookmarkPlus size={12} />} onClick={save}>
          Сохранить
        </Button>
      }
    >
      <div className="text-[11px] uppercase tracking-wider text-muted mb-1.5">Быстрые частоты</div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((f) => (
          <button
            key={f}
            onClick={() => recall({ name: "", hz: f, level_dbm: level })}
            className={cx(
              "h-7 px-2.5 rounded-lg border text-[12px] num transition-colors",
              Math.abs(hz - f) < 0.5 ? "border-accent text-accent bg-accent/10" : "border-line bg-panel2 hover:border-line2 text-fg2",
              f > snap.settings.scope_bw_hz && "opacity-60"
            )}
            title={f > snap.settings.scope_bw_hz ? "Выше полосы осциллографа" : undefined}
          >
            {fmtF(f, 3)}
          </button>
        ))}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-muted mt-3 mb-1.5">Сохранённые</div>
      {list.length === 0 ? (
        <div className="text-[12px] text-muted">Пусто — нажмите «Сохранить», чтобы запомнить текущие частоту и уровень.</div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-1.5">
          {list.map((p, i) => (
            <div key={i} className="group flex items-center gap-2 rounded-lg border border-line bg-panel2 pl-2.5 pr-1 h-8 hover:border-line2">
              <button className="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => recall(p)}>
                <span className="text-[12.5px] num font-medium truncate">{p.name}</span>
                <span className="text-[11px] text-muted num">{fmtDbm(p.level_dbm)}</span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={12} />}
                className="opacity-0 group-hover:opacity-100"
                title="Удалить"
                onClick={() => setSettings({ gen_presets: list.filter((_, k) => k !== i) })}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ───────────────────────── view ─────────────────────────

export function GeneratorView() {
  const snap = useStore((s) => s.snap)!;
  const meta = useStore((s) => s.meta);
  const status = useStore((s) => s.status);
  const sim = useSim();
  const d = snap.derived;
  const levels = meta?.gen?.levels ?? [-4, -1, 2, 5, 6, 7];
  const fMin = meta?.gen?.f_min ?? F_MIN,
    fMax = meta?.gen?.f_max ?? F_MAX;

  const [target, setTarget] = useState(d.f_out_a > 0 ? d.f_out_a : 100e6);
  const [errHz, setErrHz] = useState<number | null>(null);
  const [sel, setSel] = useState(6);
  const [sweeping, setSweeping] = useState(false);
  const own = useRef<number | null>(null);

  const onDone = useCallback((r: GenReply | null, sent: GenArgs) => {
    if (!r) return;
    own.current = r.derived.f_out_a;
    if (sent.hz != null && r.candidate) setErrHz(r.candidate.f_out - sent.hz);
  }, []);
  const w = useGenWriter(onDone);

  // follow frequency changes made elsewhere (planner, registers, import)
  useEffect(() => {
    if (!w.busyRef.current && own.current !== null && Math.abs(d.f_out_a - own.current) > 0.5) {
      setTarget(d.f_out_a);
      setErrHz(null);
    }
    own.current = d.f_out_a;
  }, [d.f_out_a, w.busyRef]);

  const setHz = useCallback(
    (hz: number) => {
      const f = clampF(hz, fMin, fMax);
      setTarget(f);
      w.send({ hz: f });
    },
    [w, fMin, fMax]
  );

  const live = sim ? sim.outputs_live : d.out_a_en && !snap.pins.muted;
  const rfOn = d.out_a_en;
  const li = lockInfo(sim, snap.link.caps.ld ? status?.ld : null);
  const stepHz = 10 ** sel;
  const level = d.pwr_a_dbm;
  const hw = snap.link.kind !== "sim";
  const blocked = d.issues.filter((i) => i.level === "error");

  const sweepWrite = useCallback(
    async (a: GenArgs) => {
      const r = await w.sendNow(a);
      if (r) onDone(r, a);
      return r;
    },
    [w, onDone]
  );

  return (
    <div className="max-w-[1400px] mx-auto flex flex-col gap-4">
      {/* ── hero ── */}
      <section className="card relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-70 transition-opacity"
          style={{
            background: live
              ? "radial-gradient(900px 260px at 18% -40%, color-mix(in srgb, var(--rf) 16%, transparent), transparent 70%)"
              : "radial-gradient(900px 260px at 18% -40%, color-mix(in srgb, var(--muted) 10%, transparent), transparent 70%)",
          }}
        />
        <div className="relative flex flex-wrap gap-x-8 gap-y-5 p-5 md:p-6">
          <div className="flex-1 min-w-[min(100%,520px)]">
            <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted">
              <Radio size={13} className={live ? "text-rf" : ""} />
              RF_OUTA · SMA
              <span className="normal-case tracking-normal">· {fmtF(fMin, 3)} – {fmtF(fMax, 2)}</span>
              {w.inflight && <span className="normal-case tracking-normal text-accent">· запись…</span>}
            </div>
            <FreqDigits hz={target} sel={sel} onSel={setSel} onChange={setHz} disabled={sweeping} />
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Button size="sm" icon={<ChevronLeft size={14} />} onClick={() => setHz(target - stepHz)} disabled={sweeping} title="Минус шаг" />
              <Segmented size="sm" value={sel} onChange={setSel} options={STEPS.map(([l, v]) => ({ value: Math.round(Math.log10(v)), label: l }))} />
              <Button size="sm" icon={<ChevronRight size={14} />} onClick={() => setHz(target + stepHz)} disabled={sweeping} title="Плюс шаг" />
              <span className="mx-1 h-5 w-px bg-line" />
              <FreqField hz={target} onCommit={setHz} width="w-36" placeholder="433.92M" />
            </div>
            <div className="text-[11.5px] text-muted mt-3 num flex flex-wrap gap-x-4 gap-y-1">
              <span>
                фактически <b className="text-fg2">{fmtFreq(d.f_out_a, 6)}</b>
              </span>
              <span>
                ошибка <b className={cx(errHz != null && Math.abs(errHz) >= 1 ? "text-warn" : "text-fg2")}>{errHz == null ? "—" : `${errHz.toFixed(3)} Гц`}</b>
              </span>
              <span>
                шаг сетки <b className="text-fg2">{fmtF(d.channel_step_hz, 4)}</b>
              </span>
              <span className="hidden md:inline">колесо над цифрой или ↑↓ ←→</span>
            </div>
          </div>

          <div className="flex flex-col gap-4 w-full sm:w-[300px]">
            <button
              type="button"
              onClick={() => w.send({ rf_on: !rfOn })}
              className={cx(
                "h-[76px] rounded-2xl border flex items-center justify-between px-5 transition-all",
                rfOn ? "border-rf/50 bg-rf/12 text-rf shadow-[0_0_32px_-8px_var(--rf)]" : "border-line bg-panel2 text-muted hover:border-line2"
              )}
              title="RF_OUTA_EN"
            >
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[11px] uppercase tracking-wider opacity-80">Выход</span>
                <span className="text-[24px] font-semibold tracking-tight">RF {rfOn ? "ON" : "OFF"}</span>
              </span>
              <span className={cx("h-11 w-11 rounded-full grid place-items-center border-2", rfOn ? "border-rf bg-rf text-[var(--bg)]" : "border-line2")}>
                <Power size={20} strokeWidth={2.5} />
              </span>
            </button>
            <div>
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted mb-1.5">
                <span>Уровень</span>
                <span className="normal-case tracking-normal num">{fmtDbm(level)}</span>
              </div>
              <Segmented
                className="w-full flex-nowrap [&>button]:flex-1"
                value={level}
                onChange={(v) => w.send({ level_dbm: v })}
                options={levels.map((l) => ({ value: l, label: `${l > 0 ? "+" : ""}${l}`, title: fmtDbm(l) }))}
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-panel2 px-3 h-10">
              <Led tone={li.tone} pulse={li.tone === "warn"} />
              <span className="text-[12.5px] font-medium">{li.text}</span>
              {sim?.lock_time_us != null && li.tone === "ok" && <span className="ml-auto text-[11.5px] text-muted num">{fmtTime(sim.lock_time_us * 1e-6)}</span>}
              {li.tone === "off" && hw && <span className="ml-auto text-[11px] text-muted">смотрите LED LD на плате</span>}
            </div>
          </div>
        </div>

        <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border-t border-line bg-panel2/50">
          {[
            ["Режим", d.integer_mode ? "целый N" : `дробный · ${d.hi_res ? "16" : "12"} бит`],
            ["N", d.n.toFixed(d.integer_mode ? 0 : 6)],
            ["fVCO", fmtF(d.f_vco, 5)],
            ["Делитель", `÷${d.m0}`],
            ["fPFD", fmtF(d.f_pfd, 4)],
            ["Опора", `${fmtF(d.f_ref, 4)} · ${snap.settings.ref_source === "tcxo" ? "TCXO" : "SMA"}`],
          ].map(([k, v]) => (
            <div key={k} className="px-4 py-2.5 border-r border-line last:border-r-0 min-w-0">
              <div className="text-[11px] text-muted">{k}</div>
              <div className="text-[13px] font-medium num truncate">{v}</div>
            </div>
          ))}
        </div>
      </section>

      {blocked.length > 0 && (
        <Hint tone="err">
          {blocked.map((b) => (
            <div key={b.msg}>{b.msg}</div>
          ))}
        </Hint>
      )}
      {hw && (
        <div className="flex items-center gap-2 text-[11.5px] text-muted px-1">
          <Lock size={12} />
          Управление генератором пишет регистры в {snap.link.name} сразу, независимо от авто-записи. Логика платы 3.3 В.
          {!snap.link.caps.mute && <Badge tone="muted">MUTE — перемычка JP1</Badge>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <ScopeCard />
        <div className="flex flex-col gap-4">
          <MemoryCard
            hz={target}
            level={level}
            recall={(p) => {
              setTarget(clampF(p.hz, fMin, fMax));
              w.send({ hz: clampF(p.hz, fMin, fMax), level_dbm: p.level_dbm });
            }}
          />
          <SweepCard write={sweepWrite} onPoint={setTarget} running={sweeping} setRunning={setSweeping} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted px-1">
        <Repeat size={11} /> Тонкая настройка петли, шумов и спуров — в разделах «Планировщик», «Петля ФАПЧ» и «Шум и спектр».
      </div>
    </div>
  );
}
