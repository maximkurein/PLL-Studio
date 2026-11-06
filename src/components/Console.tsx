import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Search, Send, Trash2, X } from "lucide-react";
import { useStore } from "../lib/store";
import { hex32 } from "../lib/format";
import { Button, Segmented, cx } from "./ui";

type Filter = "all" | "write" | "read" | "note";

/** Bottom drawer: every SPI frame with decoded field changes. */
export function Console() {
  const open = useStore((s) => s.consoleOpen);
  const log = useStore((s) => s.log);
  const setConsole = useStore((s) => s.setConsole);
  const call = useStore((s) => s.call);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [raw, setRaw] = useState("");
  const [height, setHeight] = useState(260);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return log.filter((t) => {
      if (filter === "write" && t.op !== "write" && t.op !== "raw") return false;
      if (filter === "read" && t.op !== "read") return false;
      if (filter === "note" && t.op !== "note") return false;
      if (!qq) return true;
      return (
        t.note.toLowerCase().includes(qq) ||
        t.changes.some((c) => c[0].toLowerCase().includes(qq)) ||
        hex32(t.mosi).toLowerCase().includes(qq) ||
        (t.reg != null && `r${t.reg}` === qq)
      );
    });
  }, [log, filter, q]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, open]);

  if (!open) return null;

  const t0 = log.length ? log[0].t_ms : 0;
  const sendRaw = async () => {
    const s = raw.trim().replace(/^0x/i, "");
    if (!/^[0-9a-f]{1,8}$/i.test(s)) {
      useStore.getState().toast("err", "Введите 32-битное слово в hex, например 0x00320000");
      return;
    }
    const r = await call<{ miso: number }>("raw_transfer", { word: parseInt(s, 16) >>> 0 });
    if (r) {
      useStore.getState().toast("info", `MISO ← ${hex32(r.miso)}`);
      await call("get_state", {}, true);
    }
  };

  return (
    <div className="shrink-0 border-t border-line bg-panel flex flex-col" style={{ height }}>
      <div
        className="h-1.5 -mt-1 cursor-row-resize hover:bg-accent/30"
        onMouseDown={(e) => {
          const y0 = e.clientY,
            h0 = height;
          const move = (ev: MouseEvent) => setHeight(Math.min(600, Math.max(140, h0 + (y0 - ev.clientY))));
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      />
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line">
        <span className="text-[12.5px] font-semibold">SPI-консоль</span>
        <span className="text-[11px] text-muted num">{log.length} кадров</span>
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Все" },
            { value: "write", label: "Запись" },
            { value: "read", label: "Чтение" },
            { value: "note", label: "События" },
          ]}
        />
        <div className="flex items-center gap-1 h-7 rounded-lg bg-panel2 border border-line px-2">
          <Search size={12} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поле, R3, 0x…" className="bg-transparent outline-none text-[12px] w-32" />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 h-7 rounded-lg bg-panel2 border border-line pl-2 pr-1" title="Отправить произвольное 32-битное слово (3 младших бита — адрес регистра)">
          <span className="text-[11px] text-muted">raw</span>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendRaw()}
            placeholder="0x00000000"
            className="bg-transparent outline-none text-[12px] font-mono w-24"
          />
          <button className="text-muted hover:text-accent px-1" onClick={sendRaw}>
            <Send size={12} />
          </button>
        </div>
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} title="Очистить журнал" onClick={() => call("clear_log").then(() => useStore.setState({ log: [] }))} />
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setConsole(false)} title="Закрыть" />
      </div>
      <div
        ref={scroller}
        className="flex-1 overflow-auto scroll-thin font-mono text-[11.5px] selectable"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-panel text-muted text-[10.5px] uppercase tracking-wider">
            <tr className="text-left">
              <th className="px-3 py-1 font-medium w-12">#</th>
              <th className="px-2 py-1 font-medium w-20">t, мс</th>
              <th className="px-2 py-1 font-medium w-16">Оп.</th>
              <th className="px-2 py-1 font-medium w-10">Рег.</th>
              <th className="px-2 py-1 font-medium w-28">MOSI</th>
              <th className="px-2 py-1 font-medium w-28">MISO</th>
              <th className="px-2 py-1 font-medium">Изменения / событие</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={cx("border-t border-line/60 hover:bg-panel2", !t.ok && "text-err")}>
                <td className="px-3 py-0.5 text-muted">{t.id}</td>
                <td className="px-2 py-0.5 text-muted">{(t.t_ms - t0).toFixed(1)}</td>
                <td className="px-2 py-0.5">
                  {t.op === "write" ? (
                    <span className="inline-flex items-center gap-1 text-rf">
                      <ArrowUpFromLine size={11} /> W
                    </span>
                  ) : t.op === "read" ? (
                    <span className="inline-flex items-center gap-1 text-ref">
                      <ArrowDownToLine size={11} /> R
                    </span>
                  ) : t.op === "raw" ? (
                    <span className="text-pfd">RAW</span>
                  ) : (
                    <span className="text-muted">•</span>
                  )}
                </td>
                <td className="px-2 py-0.5">{t.reg != null ? `R${t.reg}` : ""}</td>
                <td className="px-2 py-0.5">{t.mosi != null ? hex32(t.mosi) : ""}</td>
                <td className="px-2 py-0.5 text-fg2">{t.miso != null ? hex32(t.miso) : ""}</td>
                <td className="px-2 py-0.5 font-sans">
                  {t.changes.length > 0 && (
                    <span className="mr-2">
                      {t.changes.map(([n, a, b]) => (
                        <span key={n} className="inline-flex items-center mr-2 font-mono">
                          <span className="text-accent">{n}</span>
                          <span className="text-muted">
                            &nbsp;{a}→
                          </span>
                          <span className="text-fg">{b}</span>
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="text-fg2">{t.note}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-8 text-center text-muted font-sans">Журнал пуст — измените любой параметр, и SPI-кадры появятся здесь.</div>}
      </div>
    </div>
  );
}
