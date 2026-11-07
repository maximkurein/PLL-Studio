import { Moon, Power, Send, Sun, SquareTerminal, Volume2, VolumeX, Zap } from "lucide-react";
import { lockInfo, useSim, useStore } from "../lib/store";
import { isMac, isTauri } from "../lib/api";
import { fmtF, fmtMHzGrouped } from "../lib/format";
import { Button, Led, Toggle, cx } from "./ui";

function Readout({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }) {
  return (
    <div className="flex flex-col leading-none min-w-0" data-tauri-drag-region>
      <span className="text-[10px] uppercase tracking-wider text-muted" data-tauri-drag-region>
        {label}
      </span>
      <span className={cx("num font-semibold truncate", big ? "text-[17px]" : "text-[13px] mt-0.5")} style={{ color }} data-tauri-drag-region>
        {value}
      </span>
    </div>
  );
}

export function TopBar() {
  const snap = useStore((s) => s.snap)!;
  const status = useStore((s) => s.status);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const call = useStore((s) => s.call);
  const consoleOpen = useStore((s) => s.consoleOpen);
  const setConsole = useStore((s) => s.setConsole);
  const go = useStore((s) => s.go);
  const sim = useSim();
  const d = snap.derived;
  const li = lockInfo(sim, snap.link.caps.ld ? status?.ld : null);
  const dirty = snap.dirty.filter(Boolean).length;
  const errors = d.issues.filter((i) => i.level === "error").length;
  const outLive = sim ? sim.outputs_live : d.out_a_en && !snap.pins.muted;

  return (
    <header
      data-tauri-drag-region
      className={cx("h-[52px] shrink-0 flex items-center gap-4 border-b border-line bg-bg2/80 backdrop-blur pr-3", isTauri && isMac ? "pl-[84px]" : "pl-4")}
    >
      <div className="flex items-center gap-2.5 shrink-0" data-tauri-drag-region>
        <div className="h-7 w-7 rounded-lg grid place-items-center text-accentfg" style={{ background: "linear-gradient(135deg, var(--accent), var(--pfd))" }}>
          <Zap size={15} strokeWidth={2.5} />
        </div>
        <div className="leading-tight" data-tauri-drag-region>
          <div className="text-[13px] font-semibold tracking-tight" data-tauri-drag-region>
            PLL Studio
          </div>
          <div className="text-[10.5px] text-muted" data-tauri-drag-region>
            Renesas 8V97051 · EVB
          </div>
        </div>
      </div>

      <div className="h-7 w-px bg-line" />

      <button
        onClick={() => go("planner")}
        title="RF_OUTA — открыть планировщик частоты"
        className="flex items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-panel3 transition-colors min-w-0"
      >
        <Readout label={outLive ? "RF_OUTA" : "RF_OUTA · выкл"} value={`${fmtMHzGrouped(d.f_out_a)} МГц`} color={outLive ? "var(--rf)" : "var(--muted)"} big />
      </button>
      <div className="hidden lg:flex items-center gap-4 min-w-0" data-tauri-drag-region>
        <Readout label="fVCO" value={fmtF(d.f_vco, 4)} color="var(--rf-2)" />
        <Readout label="fPFD" value={fmtF(d.f_pfd, 4)} color="var(--pfd)" />
        <Readout label="N" value={d.n.toFixed(d.integer_mode ? 0 : 6)} color="var(--fg)" />
        <Readout label="ICP" value={`${d.icp_ma.toFixed(2)} мА`} color="var(--fg-2)" />
      </div>

      <button
        onClick={() => go("arch", "ld")}
        className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 h-8 hover:border-line2"
        title={sim?.reason ?? "Состояние захвата"}
      >
        <Led tone={li.tone} pulse={li.tone === "warn"} />
        <span className="text-[12px] font-medium whitespace-nowrap">{li.text}</span>
        {sim?.lock_time_us != null && li.tone === "ok" && <span className="text-[11px] text-muted num">{sim.lock_time_us.toFixed(0)} мкс</span>}
      </button>

      {errors > 0 && (
        <button onClick={() => go("arch")} className="text-[11.5px] rounded-full px-2.5 h-7 bg-err/12 text-err border border-err/30 whitespace-nowrap">
          {errors} {errors === 1 ? "ошибка" : "ошибки"} конфигурации
        </button>
      )}

      <div className="flex-1" data-tauri-drag-region />

      <button
        onClick={() => go("hardware")}
        className={cx(
          "hidden md:flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[11.5px] border whitespace-nowrap",
          snap.link_error ? "border-err/40 text-err bg-err/10" : snap.link.kind === "sim" ? "border-pfd/30 text-pfd bg-pfd/10" : "border-ok/30 text-ok bg-ok/10"
        )}
        title={snap.link_error ?? snap.link.detail}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {snap.link.kind === "sim" ? "Симулятор" : snap.link.name}
      </button>

      <Toggle
        checked={snap.auto_apply}
        onChange={(on) => call("set_auto_apply", { on })}
        label={<span className="hidden xl:inline">Авто-запись</span>}
        title="Автоматически писать изменённые регистры в кристалл (R7→R0)"
      />
      <Button
        variant={dirty ? "primary" : "subtle"}
        size="sm"
        icon={<Send size={13} />}
        onClick={() => call("apply")}
        title="Записать изменённые регистры (в порядке R7→R0)"
        disabled={!dirty}
      >
        Записать{dirty ? ` (${dirty})` : ""}
      </Button>

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          icon={<Power size={14} />}
          active={snap.link.caps.ce && snap.pins.ce}
          disabled={!snap.link.caps.ce}
          onClick={() => call("set_pins", { ce: !snap.pins.ce })}
          title={!snap.link.caps.ce ? "CE задаётся перемычкой JP2 и не считывается через USB" : snap.pins.ce ? "CE = 1 (кристалл включён). Нажмите, чтобы выключить" : "CE = 0 (кристалл выключен)"}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={snap.pins.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          active={snap.pins.muted}
          disabled={!snap.link.caps.mute}
          onClick={() => call("set_pins", { muted: !snap.pins.muted })}
          title={!snap.link.caps.mute ? "MUTE задаётся перемычкой JP1; доступны поля RF_OUTA_EN/RF_OUTB_EN" : snap.pins.muted ? "MUTE активен — выходы заглушены" : "Заглушить RF-выходы выводом MUTE"}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<SquareTerminal size={14} />}
          active={consoleOpen}
          onClick={() => setConsole(!consoleOpen)}
          title="SPI-консоль (⌘/Ctrl + J)"
        />
        <Button
          size="sm"
          variant="ghost"
          icon={theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Тема оформления"
        />
      </div>
    </header>
  );
}
