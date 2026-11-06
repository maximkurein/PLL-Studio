export function fmtFreq(hz: number, digits = 3): string {
  if (!isFinite(hz)) return "—";
  const a = Math.abs(hz);
  if (a >= 1e9) return `${(hz / 1e9).toFixed(digits + 3)} ГГц`;
  if (a >= 1e6) return `${(hz / 1e6).toFixed(digits)} МГц`;
  if (a >= 1e3) return `${(hz / 1e3).toFixed(Math.min(digits, 3))} кГц`;
  return `${hz.toFixed(a < 10 ? 2 : 1)} Гц`;
}

/** Compact frequency: 2.45 ГГц, 433.92 МГц, 125 кГц */
export function fmtF(hz: number, maxDigits = 4): string {
  if (!isFinite(hz)) return "—";
  const a = Math.abs(hz);
  const trim = (v: number) => {
    const s = v.toFixed(maxDigits);
    return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  };
  if (a >= 1e9) return `${trim(hz / 1e9)} ГГц`;
  if (a >= 1e6) return `${trim(hz / 1e6)} МГц`;
  if (a >= 1e3) return `${trim(hz / 1e3)} кГц`;
  return `${trim(hz)} Гц`;
}

/** MHz with grouped decimals: "2 450.000 000" */
export function fmtMHzGrouped(hz: number): string {
  if (!isFinite(hz)) return "—";
  const s = (hz / 1e6).toFixed(6);
  const [i, d] = s.split(".");
  const ig = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${ig}.${d.slice(0, 3)} ${d.slice(3)}`;
}

export function fmtTime(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "—";
  const a = Math.abs(s);
  if (a >= 1) return `${s.toFixed(3)} с`;
  if (a >= 1e-3) return `${(s * 1e3).toFixed(2)} мс`;
  if (a >= 1e-6) return `${(s * 1e6).toFixed(1)} мкс`;
  return `${(s * 1e9).toFixed(1)} нс`;
}

export function fmtUs(us: number | null | undefined): string {
  if (us == null) return "—";
  return fmtTime(us * 1e-6);
}

export function hex32(v: number | null | undefined): string {
  if (v == null) return "—";
  return "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

export function fmtOhm(r: number): string {
  if (r >= 1e6) return `${+(r / 1e6).toPrecision(3)} МОм`;
  if (r >= 1e3) return `${+(r / 1e3).toPrecision(3)} кОм`;
  return `${+r.toPrecision(3)} Ом`;
}

export function fmtFarad(c: number): string {
  if (c >= 1e-6) return `${+(c * 1e6).toPrecision(3)} мкФ`;
  if (c >= 1e-9) return `${+(c * 1e9).toPrecision(3)} нФ`;
  return `${+(c * 1e12).toPrecision(3)} пФ`;
}

/** Parse "2.4G", "2400 M", "433.92 МГц", "125k", "1e9" → Hz. Plain numbers are MHz. */
export function parseFreq(input: string, defaultUnit = 1e6): number | null {
  const s = input.trim().replace(",", ".").replace(/\s+/g, "").toLowerCase();
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([a-zа-я]*)$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2];
  let k = defaultUnit;
  if (/^(g|ghz|г|ггц)$/.test(u)) k = 1e9;
  else if (/^(m|mhz|м|мгц)$/.test(u)) k = 1e6;
  else if (/^(k|khz|к|кгц)$/.test(u)) k = 1e3;
  else if (/^(hz|гц)$/.test(u)) k = 1;
  else if (u !== "") return null;
  return v * k;
}

/** Parse engineering values: "4.7n", "680p", "1.2k", "10u" */
export function parseEng(input: string): number | null {
  const s = input.trim().replace(",", ".").replace(/\s+/g, "");
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([a-zA-Zа-яА-Яµ]*)$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  const map: Record<string, number> = {
    p: 1e-12, pf: 1e-12, "п": 1e-12, "пф": 1e-12,
    n: 1e-9, nf: 1e-9, "н": 1e-9, "нф": 1e-9,
    u: 1e-6, uf: 1e-6, "µ": 1e-6, "мк": 1e-6, "мкф": 1e-6,
    m: 1e-3, k: 1e3, "к": 1e3, "ком": 1e3, kohm: 1e3,
    meg: 1e6, "ом": 1, ohm: 1, "": 1,
  };
  if (!(u in map)) return null;
  return v * map[u];
}

export function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

export function dB(x: number) {
  return 20 * Math.log10(Math.max(x, 1e-30));
}
