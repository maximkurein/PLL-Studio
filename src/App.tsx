import { useEffect, type ReactNode } from "react";
import { Cpu, LoaderCircle } from "lucide-react";
import { useStore } from "./lib/store";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { Console } from "./components/Console";
import { Toasts } from "./components/Toasts";
import { ArchitectureView } from "./views/ArchitectureView";
import { BoardView } from "./views/BoardView";
import { PlannerView } from "./views/PlannerView";
import { RegistersView } from "./views/RegistersView";
import { LoopView } from "./views/LoopView";
import { NoiseView } from "./views/NoiseView";
import { LabView } from "./views/LabView";
import { HardwareView } from "./views/HardwareView";
import { LearnView } from "./views/LearnView";
import { AboutView } from "./views/AboutView";
import type { ViewId } from "./lib/types";

const VIEWS: Record<ViewId, () => ReactNode> = {
  arch: () => <ArchitectureView />,
  board: () => <BoardView />,
  planner: () => <PlannerView />,
  registers: () => <RegistersView />,
  loop: () => <LoopView />,
  noise: () => <NoiseView />,
  lab: () => <LabView />,
  hardware: () => <HardwareView />,
  learn: () => <LearnView />,
  about: () => <AboutView />,
};

export default function App() {
  const snap = useStore((s) => s.snap);
  const view = useStore((s) => s.view);
  const connError = useStore((s) => s.connError);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  // live status polling (lock detect, VTUNE, calibration progress …)
  useEffect(() => {
    let busy = false;
    const id = setInterval(async () => {
      if (busy || document.hidden || !useStore.getState().snap) return;
      busy = true;
      await useStore.getState().poll();
      busy = false;
    }, 350);
    return () => clearInterval(id);
  }, []);

  // keyboard shortcuts: ⌘/Ctrl+1…9 views, ⌘/Ctrl+0 About, ⌘/Ctrl+J console
  useEffect(() => {
    const order: ViewId[] = ["arch", "board", "registers", "planner", "loop", "noise", "lab", "hardware", "learn", "about"];
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = e.key === "0" ? 10 : Number(e.key);
      if (n >= 1 && n <= order.length) {
        e.preventDefault();
        useStore.getState().go(order[n - 1]);
      } else if (e.key === "`" || e.key === "j") {
        e.preventDefault();
        const s = useStore.getState();
        s.setConsole(!s.consoleOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!snap) {
    return (
      <div className="h-full grid place-items-center bg-bg">
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <div className="h-14 w-14 rounded-2xl bg-panel border border-line grid place-items-center text-accent">
            <Cpu size={28} />
          </div>
          <div className="text-[16px] font-semibold">PLL Studio · 8V97051</div>
          {connError ? (
            <div className="text-[12.5px] text-muted max-w-md">
              Нет связи с движком: <span className="text-err">{connError}</span>
              <br />
              В веб-режиме запустите <span className="kbd">npm run server</span> — повторное подключение идёт автоматически.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted text-[12.5px]">
              <LoaderCircle size={14} className="spin" /> Запуск движка…
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg text-fg">
      <TopBar />
      <div className="flex-1 min-h-0 flex">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <main key={view} className="flex-1 min-h-0 overflow-auto scroll-thin px-6 py-5">
            {VIEWS[view]()}
          </main>
          <Console />
        </div>
      </div>
      <Toasts />
    </div>
  );
}
