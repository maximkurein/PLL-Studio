import { useEffect, useMemo, useRef, useState } from "react";
import { BookDown, Binary, Download, Eraser, FileUp, RotateCcw, Send, Upload } from "lucide-react";
import { useStore } from "../lib/store";
import { hex32 } from "../lib/format";
import { openTextFile, saveTextFile } from "../lib/api";
import type { FieldDef } from "../lib/types";
import { FieldControl, bitsLabel } from "../components/fields";
import { Badge, Button, Card, NumField, PageHeader, cx } from "../components/ui";

const PALETTE = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6", "#eab308", "#3b82f6", "#f97316", "#84cc16"];

const REG_TITLES = [
  "INT · FRAC — делитель N (запись запускает калибровку и применяет буферы)",
  "PHASE · MOD · отключение калибровки",
  "Опорный тракт, CP, MUX_OUT, Lock Detect",
  "Таймер Fast Lock / Phase Resync, такт калибровки",
  "Выходы RF_OUTA/B, M0, обратная связь, такт калибровки",
  "Режим вывода LD",
  "ΣΔ, высокая мощность, статус калибровки и захвата (расширенный)",
  "16-битный режим, readback, sticky-флаги, ID (расширенный)",
];

function BitGrid({ reg, word, fields, focus, onBit, onField }: { reg: number; word: number; fields: FieldDef[]; focus: string | null; onBit: (bit: number) => void; onField: (f: FieldDef) => void }) {
  const owner = useMemo(() => {
    const o: (FieldDef | null)[] = Array(32).fill(null);
    fields.forEach((f) => {
      for (let b = f.lsb; b <= f.msb; b++) o[b] = f;
    });
    o[0] = o[1] = o[2] = null; // address bits
    return o;
  }, [fields]);
  const colorOf = (f: FieldDef) => PALETTE[fields.indexOf(f) % PALETTE.length];

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[repeat(32,minmax(0,1fr))] gap-[2px]">
        {Array.from({ length: 32 }, (_, i) => 31 - i).map((b) => {
          const f = owner[b];
          const v = (word >>> b) & 1;
          const isAddr = b < 3;
          const col = f ? colorOf(f) : undefined;
          return (
            <button
              key={b}
              title={isAddr ? `D${b}: адрес регистра (${reg})` : f ? `D${b}: ${f.name} — ${f.title}` : `D${b}: не используется`}
              onClick={() => (isAddr ? undefined : f && f.access !== "rw" ? onField(f) : onBit(b))}
              className={cx(
                "h-7 rounded-[5px] text-[11px] font-mono font-semibold transition-all border",
                isAddr ? "cursor-default" : "hover:brightness-125",
                f && focus === f.name && "ring-2 ring-accent"
              )}
              style={{
                background: isAddr ? "var(--panel-3)" : f ? `color-mix(in srgb, ${col} ${v ? 55 : 14}%, transparent)` : "var(--panel-2)",
                borderColor: f ? `color-mix(in srgb, ${col} 50%, transparent)` : "var(--line)",
                color: isAddr ? "var(--muted)" : v ? "var(--fg)" : "var(--muted)",
              }}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[repeat(32,minmax(0,1fr))] gap-[2px] text-[9px] text-muted font-mono text-center">
        {Array.from({ length: 32 }, (_, i) => 31 - i).map((b) => (
          <span key={b}>{b % 4 === 3 || b === 0 ? b : ""}</span>
        ))}
      </div>
      <div className="relative h-5">
        {fields
          .filter((f) => f.lsb >= 3 || f.msb >= 3)
          .map((f) => {
            const left = ((31 - f.msb) / 32) * 100;
            const width = ((f.msb - Math.max(f.lsb, 3) + 1) / 32) * 100;
            return (
              <button
                key={f.name}
                onClick={() => onField(f)}
                className="absolute top-0 h-5 rounded-[4px] text-[9.5px] font-mono truncate px-0.5 hover:brightness-125"
                style={{ left: `${left}%`, width: `calc(${width}% - 2px)`, background: `color-mix(in srgb, ${colorOf(f)} 18%, transparent)`, color: colorOf(f) }}
                title={`${f.name} ${bitsLabel(f)}`}
              >
                {f.name}
              </button>
            );
          })}
      </div>
    </div>
  );
}

export function RegistersView() {
  const snap = useStore((s) => s.snap)!;
  const meta = useStore((s) => s.meta);
  const call = useStore((s) => s.call);
  const toast = useStore((s) => s.toast);
  const focusField = useStore((s) => s.focusField);
  const focus = useStore((s) => s.focus);
  const fieldMap = useStore((s) => s.fieldMap);
  const [reg, setReg] = useState(() => (focusField && fieldMap[focusField] ? fieldMap[focusField].reg : 0));
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusField && fieldMap[focusField]) {
      setReg(fieldMap[focusField].reg);
      setTimeout(() => listRef.current?.querySelector(`[data-field="${focusField}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    }
  }, [focusField, fieldMap]);

  const fieldsOf = (r: number) => (meta?.fields ?? []).filter((f) => f.reg === r);
  const word = snap.regs[reg];
  const rb = snap.readback;

  const flipBit = (b: number) => call("set_register", { index: reg, value: (word ^ (1 << b)) >>> 0 });

  const doExport = async () => {
    const r = await call<{ text: string }>("export_config");
    if (!r) return;
    const p = await saveTextFile("8V97051_config.txt", r.text);
    if (p) toast("ok", `Конфигурация сохранена: ${p}`);
  };
  const doImport = async () => {
    const text = await openTextFile();
    if (text == null) return;
    const r = await call("import_config", { text });
    if (r) toast("ok", "Конфигурация загружена");
  };

  return (
    <div className="max-w-[1600px]">
      <PageHeader
        icon={<Binary size={20} />}
        title="Карта регистров"
        subtitle="8 регистров × 32 бита. Щелчок по биту инвертирует его, по имени поля — открывает редактор. Записи идут в порядке R7→R0; запись R0 применяет двойные буферы и запускает калибровку ГУН."
        actions={
          <>
            <Button icon={<Send size={13} />} onClick={() => call("write_all")} title="Записать все регистры R7→R0">
              Записать всё
            </Button>
            <Button icon={<Download size={13} />} onClick={() => call("read_all")} disabled={!snap.link.caps.readback} title="Прочитать все регистры через MUX_OUT=SDO">
              Прочитать всё
            </Button>
            <Button icon={<Eraser size={13} />} onClick={() => call("clear_sticky")} title="Сбросить sticky-флаги R7 (запись 1)">
              Сброс флагов
            </Button>
            <Button icon={<RotateCcw size={13} />} onClick={() => call("reset_defaults", { starter: true })} title="Рабочая стартовая конфигурация (калибровка ГУН в допустимом диапазоне)">
              Стартовая
            </Button>
            <Button variant="ghost" icon={<BookDown size={13} />} onClick={() => call("reset_defaults", { starter: false })} title="Значения после сброса по даташиту">
              По даташиту
            </Button>
            <Button variant="ghost" icon={<Upload size={13} />} onClick={doExport}>
              Экспорт
            </Button>
            <Button variant="ghost" icon={<FileUp size={13} />} onClick={doImport}>
              Импорт
            </Button>
          </>
        }
      />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-2 min-w-0">
          {Array.from({ length: 8 }, (_, r) => r).map((r) => {
            const dirty = snap.dirty[r];
            const dev = snap.dev_regs?.[r];
            const match = rb?.valid[r] ? rb.matches[r] : null;
            return (
              <div
                key={r}
                onClick={() => setReg(r)}
                className={cx("card px-4 py-3 cursor-pointer transition-all", r === reg ? "ring-1 ring-accent" : "hover:border-line2")}
              >
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className="text-[14px] font-semibold w-7">R{r}</span>
                  <div onClick={(e) => e.stopPropagation()}>
                    <NumField hex value={snap.regs[r]} onCommit={(v) => call("set_register", { index: r, value: v >>> 0 })} width="w-24" />
                  </div>
                  {dirty ? <Badge tone="warn">не записан</Badge> : <Badge tone="ok">записан</Badge>}
                  {match === true && <Badge tone="ok">readback ✓ {hex32(rb!.words[r])}</Badge>}
                  {match === false && <Badge tone="err">readback ≠ {hex32(rb!.words[r])}</Badge>}
                  {dev != null && dev !== snap.regs[r] && <span className="text-[11px] text-muted font-mono">в кристалле {hex32(dev)}</span>}
                  <span className="text-[11.5px] text-muted truncate flex-1 min-w-0">{REG_TITLES[r]}</span>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => call("write_register", { index: r })} title={`Записать R${r}`}>
                      W
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => call("read_register", { index: r })} disabled={!snap.link.caps.readback} title={`Прочитать R${r}`}>
                      R
                    </Button>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <BitGrid
                    reg={r}
                    word={snap.regs[r]}
                    fields={fieldsOf(r)}
                    focus={focusField}
                    onBit={(b) => {
                      setReg(r);
                      if (r === reg) void flipBit(b);
                      else void call("set_register", { index: r, value: (snap.regs[r] ^ (1 << b)) >>> 0 });
                    }}
                    onField={(f) => {
                      setReg(r);
                      focus(f.name);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Card
          title={`Поля R${reg}`}
          subtitle={REG_TITLES[reg]}
          className="xl:sticky xl:top-0 self-start xl:max-h-[calc(100vh-130px)]"
          bodyClass="overflow-y-auto scroll-thin flex flex-col gap-2 min-h-0 flex-1"
        >
          <div ref={listRef} className="flex flex-col gap-2">
            {snap.pending_db.length > 0 && (
              <div className="text-[12px] rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-fg2">
                Ожидают записи R0 (двойная буферизация): <b className="text-accent">{snap.pending_db.join(", ")}</b>
              </div>
            )}
            {fieldsOf(reg).map((f) => (
              <div key={f.name} data-field={f.name} className={cx("rounded-xl", focusField === f.name && "ring-2 ring-accent")}>
                <FieldControl name={f.name} />
              </div>
            ))}
            <div className="text-[11px] text-muted px-1">Биты D2:D0 — адрес регистра ({reg.toString(2).padStart(3, "0")}), добавляются автоматически.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
