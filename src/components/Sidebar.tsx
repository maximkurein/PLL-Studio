import {
  Activity,
  AudioWaveform,
  Binary,
  CircuitBoard,
  Crosshair,
  FlaskConical,
  GraduationCap,
  Info,
  Microchip,
  Thermometer,
  Usb,
} from "lucide-react";
import type { ReactNode } from "react";
import { useSim, useStore } from "../lib/store";
import type { ViewId } from "../lib/types";
import { cx } from "./ui";

const NAV: { id: ViewId; label: string; hint: string; icon: ReactNode; group: string }[] = [
  { id: "arch", label: "Архитектура", hint: "Блок-схема кристалла", icon: <Microchip size={16} />, group: "Устройство" },
  { id: "board", label: "Плата EVB", hint: "Разъёмы, джамперы, питание", icon: <CircuitBoard size={16} />, group: "Устройство" },
  { id: "registers", label: "Регистры", hint: "R0–R7, биты, чтение", icon: <Binary size={16} />, group: "Устройство" },
  { id: "planner", label: "Планировщик", hint: "Частота → INT/FRAC/MOD", icon: <Crosshair size={16} />, group: "Расчёт" },
  { id: "loop", label: "Петля ФАПЧ", hint: "Фильтр, Боде, переходный", icon: <Activity size={16} />, group: "Расчёт" },
  { id: "noise", label: "Шум и спектр", hint: "Фазовый шум, джиттер, спуры", icon: <AudioWaveform size={16} />, group: "Расчёт" },
  { id: "lab", label: "Лаборатория", hint: "Свип, прыжки, эксперименты", icon: <FlaskConical size={16} />, group: "Практика" },
  { id: "hardware", label: "Подключение", hint: "USB/SPI-мост, симулятор", icon: <Usb size={16} />, group: "Практика" },
  { id: "learn", label: "Академия", hint: "Как работает PLL", icon: <GraduationCap size={16} />, group: "Практика" },
  { id: "about", label: "О программе", hint: "Версия, автор, исходный код", icon: <Info size={16} />, group: "Приложение" },
];

export function Sidebar() {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const snap = useStore((s) => s.snap)!;
  const sim = useSim();
  const app = useStore((s) => s.meta?.app);
  let group = "";

  return (
    <nav className="w-[212px] shrink-0 border-r border-line bg-bg2/60 flex flex-col">
      <div className="flex-1 overflow-y-auto scroll-thin px-2.5 py-3">
        {NAV.map((n, i) => {
          const header = n.group !== group;
          group = n.group;
          return (
            <div key={n.id}>
              {header && <div className={cx("px-2 pb-1 text-[10.5px] uppercase tracking-wider text-muted font-medium", i > 0 && "pt-3")}>{n.group}</div>}
              <button
                onClick={() => go(n.id)}
                className={cx(
                  "group w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                  view === n.id ? "bg-panel text-fg shadow-sm ring-1 ring-line" : "text-fg2 hover:bg-panel3/70 hover:text-fg"
                )}
              >
                <span className={cx("shrink-0", view === n.id ? "text-accent" : "text-muted group-hover:text-fg2")}>{n.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium leading-tight">{n.label}</span>
                  <span className="block text-[10.5px] text-muted leading-tight truncate">{n.hint}</span>
                </span>
                <span className="ml-auto text-[10px] text-muted opacity-0 group-hover:opacity-100 num">{(i + 1) % 10}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="m-2.5 rounded-xl border border-line bg-panel p-3 text-[11.5px] space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted">Потребление</span>
          <span className="num font-medium">{snap.power.power_mw.toFixed(0)} мВт</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Ток 3.3 В</span>
          <span className="num">{snap.power.total_ma.toFixed(0)} мА</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted flex items-center gap-1">
            <Thermometer size={12} /> Tj
          </span>
          <span className="num">{snap.power.tj_c.toFixed(0)} °C</span>
        </div>
        {sim && (
          <div className="flex items-center justify-between">
            <span className="text-muted">VTUNE</span>
            <span className={cx("num", (sim.vtune < 0.5 || sim.vtune > 2.5) && "text-err")}>{sim.vtune.toFixed(3)} В</span>
          </div>
        )}
        <div className="h-1.5 rounded-full bg-panel3 overflow-hidden mt-1" title="Петля: полоса и запас по фазе">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(4, (snap.loop.pm_deg / 70) * 100))}%`,
              background: snap.loop.stable ? (snap.loop.pm_deg > 40 ? "var(--ok)" : "var(--warn)") : "var(--err)",
            }}
          />
        </div>
        <div className="flex items-center justify-between text-muted">
          <span>Петля {(snap.loop.fc_hz / 1e3).toFixed(1)} кГц</span>
          <span className="num">ЗФ {snap.loop.pm_deg.toFixed(0)}°</span>
        </div>
      </div>
      {app && (
        <button onClick={() => go("about")} className="px-4 pb-3 -mt-1 text-left text-[10.5px] text-muted hover:text-accent num" title={`О программе — ${app.name} v${app.version}, ${app.author}`}>
          <span className="block">{app.name} v{app.version}</span>
          <span className="block">{app.author}</span>
        </button>
      )}
    </nav>
  );
}
