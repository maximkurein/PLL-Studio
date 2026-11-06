import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseFreq, fmtF } from "../lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({
  title,
  icon,
  actions,
  children,
  className,
  bodyClass,
  subtitle,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  subtitle?: ReactNode;
}) {
  return (
    <section className={cx("card flex flex-col min-w-0", className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2 px-4 pt-3 pb-2">
          {icon && <span className="text-muted">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold tracking-tight truncate">{title}</h2>
            {subtitle && <div className="text-[11.5px] text-muted truncate">{subtitle}</div>}
          </div>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx("px-4 pb-4 min-w-0", !title && !actions && "pt-4", bodyClass)}>{children}</div>
    </section>
  );
}

type BtnVariant = "primary" | "subtle" | "ghost" | "danger" | "outline";

export function Button({
  children,
  onClick,
  variant = "subtle",
  icon,
  disabled,
  title,
  className,
  size = "md",
  active,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
  size?: "sm" | "md";
  active?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors select-none whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent";
  const sz = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]";
  const v: Record<BtnVariant, string> = {
    primary: "bg-accent text-accentfg hover:brightness-110 shadow-sm",
    subtle: "bg-panel3 text-fg hover:bg-line border border-line",
    ghost: "text-fg2 hover:bg-panel3 hover:text-fg",
    danger: "bg-err/15 text-err hover:bg-err/25 border border-err/30",
    outline: "border border-line2 text-fg hover:bg-panel3",
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(base, sz, v[variant], active && "ring-1 ring-accent text-accent", !children && "px-0 w-8", !children && size === "sm" && "w-7", className)}
    >
      {icon}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  tone = "accent",
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  tone?: "accent" | "ok" | "warn" | "err";
  title?: string;
}) {
  const on = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", err: "bg-err" }[tone];
  return (
    <label title={title} className={cx("inline-flex items-center gap-2 cursor-pointer select-none", disabled && "opacity-40 pointer-events-none")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-[18px] w-[32px] rounded-full transition-colors shrink-0", checked ? on : "bg-line2")}
      >
        <span
          className={cx(
            "absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[16px]" : "translate-x-[2px]"
          )}
        />
      </button>
      {label && <span className="text-[12.5px] text-fg2">{label}</span>}
    </label>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cx("inline-flex flex-wrap rounded-lg bg-panel3 p-0.5 border border-line gap-0.5", className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-2.5 transition-all num",
            size === "sm" ? "h-6 text-[11.5px]" : "h-7 text-[12px]",
            o.value === value ? "bg-panel text-fg shadow-sm ring-1 ring-line2 font-semibold" : "text-muted hover:text-fg"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
      className={cx(
        "h-8 rounded-lg bg-panel2 border border-line px-2 text-[12.5px] text-fg outline-none focus:border-accent num",
        className
      )}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Number input that commits on Enter / blur, ↑/↓ steps (Shift ×10). */
export function NumField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  unit,
  width = "w-24",
  integer = true,
  disabled,
  hex,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  width?: string;
  integer?: boolean;
  disabled?: boolean;
  hex?: boolean;
}) {
  const show = (v: number) => (hex ? "0x" + (v >>> 0).toString(16).toUpperCase() : String(v));
  const [txt, setTxt] = useState(show(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (raw: string) => {
    let v = raw.trim().toLowerCase().startsWith("0x") ? parseInt(raw, 16) : Number(raw.replace(",", "."));
    if (!isFinite(v)) {
      setBad(true);
      return;
    }
    if (integer) v = Math.round(v);
    if ((min != null && v < min) || (max != null && v > max)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (v !== value) onCommit(v);
    setTxt(show(v));
  };
  return (
    <div className={cx("inline-flex items-center rounded-lg bg-panel2 border h-8 px-2 gap-1", bad ? "border-err" : "border-line focus-within:border-accent", disabled && "opacity-50")}>
      <input
        disabled={disabled}
        className={cx("bg-transparent outline-none text-[12.5px] num text-fg", width)}
        value={txt}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const k = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            let v = value + k;
            if (min != null) v = Math.max(min, v);
            if (max != null) v = Math.min(max, v);
            if (integer) v = Math.round(v);
            onCommit(v);
          }
          if (e.key === "Escape") {
            setTxt(show(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {unit && <span className="text-[11px] text-muted">{unit}</span>}
    </div>
  );
}

export function FreqField({
  hz,
  onCommit,
  width = "w-40",
  big,
  placeholder,
}: {
  hz: number;
  onCommit: (hz: number) => void;
  width?: string;
  big?: boolean;
  placeholder?: string;
}) {
  const [txt, setTxt] = useState(fmtF(hz, 6));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setTxt(fmtF(hz, 6));
      setBad(false);
    }
  }, [hz]);
  const commit = (s: string) => {
    const v = parseFreq(s);
    if (v == null || v <= 0) {
      setBad(true);
      return;
    }
    setBad(false);
    onCommit(v);
    setTxt(fmtF(v, 6));
  };
  return (
    <input
      placeholder={placeholder}
      className={cx(
        "rounded-lg bg-panel2 border outline-none num text-fg px-3",
        big ? "h-11 text-[20px] font-semibold tracking-tight" : "h-8 text-[12.5px]",
        bad ? "border-err" : "border-line focus:border-accent",
        width
      )}
      value={txt}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={(e) => {
        focused.current = false;
        commit(e.target.value);
      }}
      onChange={(e) => setTxt(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
      }}
    />
  );
}

export function Badge({ children, tone = "muted", className, title }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "err" | "ref" | "pfd" | "rf" | "dig" | "accent"; className?: string; title?: string }) {
  const t: Record<string, string> = {
    muted: "bg-panel3 text-muted border-line",
    ok: "bg-ok/12 text-ok border-ok/30",
    warn: "bg-warn/12 text-warn border-warn/30",
    err: "bg-err/12 text-err border-err/30",
    ref: "bg-ref/12 text-ref border-ref/30",
    pfd: "bg-pfd/12 text-pfd border-pfd/30",
    rf: "bg-rf/12 text-rf border-rf/30",
    dig: "bg-dig/12 text-dig border-dig/30",
    accent: "bg-accent/12 text-accent border-accent/30",
  };
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 h-5 text-[11px] font-medium whitespace-nowrap", t[tone], className)}>
      {children}
    </span>
  );
}

export function Led({ tone, pulse, size = 10 }: { tone: "ok" | "warn" | "err" | "off"; pulse?: boolean; size?: number }) {
  const c = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)", off: "var(--line-2)" }[tone];
  return (
    <span
      className={cx("inline-block rounded-full shrink-0", pulse && "led-pulse")}
      style={{ width: size, height: size, background: c, boxShadow: tone !== "off" ? `0 0 0 3px color-mix(in srgb, ${c} 22%, transparent), 0 0 10px ${c}` : undefined }}
    />
  );
}

export function Stat({ label, value, unit, tone, sub, className }: { label: ReactNode; value: ReactNode; unit?: string; tone?: string; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-xl bg-panel2 border border-line px-3 py-2 min-w-0", className)}>
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="text-[16px] font-semibold num truncate" style={tone ? { color: `var(--${tone})` } : undefined}>
          {value}
        </span>
        {unit && <span className="text-[11px] text-muted">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-muted truncate">{sub}</div>}
    </div>
  );
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 min-h-9">
      <div className="w-40 shrink-0 text-[12.5px] text-fg2">
        {label}
        {hint && <div className="text-[11px] text-muted leading-tight">{hint}</div>}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, className }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; className?: string }) {
  return (
    <input
      type="range"
      className={cx("w-full accent-[var(--accent)]", className)}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Hint({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "err" | "ok" }) {
  const t = {
    info: "border-accent/25 bg-accent/8 text-fg2",
    warn: "border-warn/30 bg-warn/8 text-fg2",
    err: "border-err/30 bg-err/8 text-fg2",
    ok: "border-ok/30 bg-ok/8 text-fg2",
  }[tone];
  return <div className={cx("rounded-lg border px-3 py-2 text-[12px] leading-relaxed", t)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="h-40 grid place-items-center text-muted text-[12.5px]">{children}</div>;
}

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      {icon && <div className="h-10 w-10 shrink-0 rounded-xl bg-panel border border-line grid place-items-center text-accent">{icon}</div>}
      <div className="flex-1 min-w-[min(100%,420px)]">
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
    </div>
  );
}
