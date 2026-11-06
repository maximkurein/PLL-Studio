import { useStore, useField } from "../lib/store";
import { Badge, NumField, Segmented, Select, Toggle, cx } from "./ui";

const MIN: Record<string, number> = { INT: 8, MOD: 2, R_COUNTER: 1, CLK_DIV: 1, BAND_SEL_DIV: 1 };

export function bitsLabel(f: { reg: number; msb: number; lsb: number }) {
  return `R${f.reg}[${f.msb === f.lsb ? `D${f.msb}` : `D${f.msb}:D${f.lsb}`}]`;
}

/** Auto-generated editor for any register field (from the Rust metadata). */
export function FieldControl({ name, compact, hideDesc }: { name: string; compact?: boolean; hideDesc?: boolean }) {
  const f = useStore((s) => s.fieldMap[name]);
  const v = useField(name);
  const setField = useStore((s) => s.setField);
  const focus = useStore((s) => s.focus);
  const go = useStore((s) => s.go);
  if (!f) return null;
  const width = f.msb - f.lsb + 1;
  const max = width >= 32 ? 0xffffffff : 2 ** width - 1;
  const ro = f.access !== "rw";
  const optLabel = f.options.find((o) => o[0] === v)?.[1];

  let control: React.ReactNode;
  if (ro) {
    control = (
      <Badge tone={f.access === "sticky" ? "warn" : "muted"}>
        {optLabel ?? v} · {f.access === "ro" ? "только чтение" : f.access === "sticky" ? "sticky" : "фиксировано"}
      </Badge>
    );
  } else if (f.options.length > 0 && f.options.length <= 4 && f.options.every((o) => o[1].length < 26)) {
    control = <Segmented size="sm" options={f.options.map(([val, label]) => ({ value: val, label }))} value={v} onChange={(x) => setField(name, x)} />;
  } else if (f.options.length > 0) {
    control = <Select options={f.options.map(([val, label]) => ({ value: val, label: `${label}  (${val})` }))} value={v} onChange={(x) => setField(name, x)} />;
  } else if (width === 1) {
    control = <Toggle checked={v === 1} onChange={(x) => setField(name, x ? 1 : 0)} />;
  } else {
    control = <NumField value={v} min={MIN[name] ?? 0} max={max} onCommit={(x) => setField(name, x)} width={width > 10 ? "w-20" : "w-14"} />;
  }

  return (
    <div className={cx("rounded-xl border border-line bg-panel2/60 px-3 py-2", compact && "py-1.5")}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="min-w-[150px] flex-1">
          <div className="text-[12.5px] font-medium text-fg leading-snug">{f.title}</div>
          <button
            className="font-mono text-[10.5px] text-muted hover:text-accent"
            title="Открыть в карте регистров"
            onClick={() => {
              focus(name);
              go("registers");
            }}
          >
            {f.name} · {bitsLabel(f)}
          </button>
          {f.double_buffered && (
            <Badge tone="accent" className="ml-1.5 !h-4 !text-[10px]" title="Значение применяется после записи R0">
              буфер → R0
            </Badge>
          )}
        </div>
        <div className="shrink-0 max-w-full">{control}</div>
      </div>
      {!compact && !hideDesc && <p className="text-[11.5px] text-muted leading-snug mt-1">{f.desc}</p>}
    </div>
  );
}

/** Set effective FRAC/MOD/PHASE honouring 12/16-bit mode. */
export function fracModPhaseFields(frac: number, mod: number, phase: number, hi: boolean): Record<string, number> {
  if (hi)
    return {
      RES_16BIT: 1,
      FRAC: (frac >> 4) & 0xfff,
      EXT_FRAC: frac & 15,
      MOD: (mod >> 4) & 0xfff,
      EXT_MOD: mod & 15,
      PHASE: (phase >> 4) & 0xfff,
      EXT_PHASE: phase & 15,
    };
  return { RES_16BIT: 0, FRAC: frac & 0xfff, MOD: mod & 0xfff, PHASE: phase & 0xfff, EXT_FRAC: 0, EXT_MOD: 0, EXT_PHASE: 0 };
}
