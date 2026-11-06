import { create } from "zustand";
import { rpc } from "./api";
import type { FieldDef, Meta, Settings, Snapshot, Status, Txn, ViewId } from "./types";

export interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  text: string;
}

interface Store {
  meta: Meta | null;
  fieldMap: Record<string, FieldDef>;
  snap: Snapshot | null;
  status: Status | null;
  view: ViewId;
  block: string | null;
  focusField: string | null;
  log: Txn[];
  logHead: number;
  consoleOpen: boolean;
  theme: "dark" | "light";
  connError: string | null;
  toasts: Toast[];
  init: () => Promise<void>;
  call: <T = unknown>(cmd: string, args?: Record<string, unknown>, quiet?: boolean) => Promise<T | null>;
  setField: (name: string, value: number) => Promise<void>;
  setFields: (values: Record<string, number>) => Promise<void>;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  poll: () => Promise<void>;
  fetchLog: () => Promise<void>;
  go: (view: ViewId, block?: string | null) => void;
  selectBlock: (b: string | null) => void;
  focus: (field: string | null) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
  setConsole: (open: boolean) => void;
  setTheme: (t: "dark" | "light") => void;
}

let toastId = 1;

function loadTheme(): "dark" | "light" {
  try {
    const t = localStorage.getItem("pll.theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return "dark";
}

function isSnapshot(x: unknown): x is Snapshot {
  return !!x && typeof x === "object" && "regs" in (x as object) && "derived" in (x as object);
}

export const useStore = create<Store>((set, get) => ({
  meta: null,
  fieldMap: {},
  snap: null,
  status: null,
  view: "arch",
  block: "pfd",
  focusField: null,
  log: [],
  logHead: 0,
  consoleOpen: false,
  theme: loadTheme(),
  connError: null,
  toasts: [],

  init: async () => {
    try {
      const meta = await rpc<Meta>("get_meta");
      const fieldMap: Record<string, FieldDef> = {};
      meta.fields.forEach((f) => (fieldMap[f.name] = f));
      const snap = await rpc<Snapshot>("get_state");
      set({ meta, fieldMap, snap, connError: null });
      await get().fetchLog();
    } catch (e) {
      set({ connError: String(e) });
      setTimeout(() => get().init(), 1500);
    }
  },

  call: async <T,>(cmd: string, args: Record<string, unknown> = {}, quiet = false): Promise<T | null> => {
    try {
      const r = await rpc<T>(cmd, args);
      if (isSnapshot(r)) set({ snap: r });
      else if (r && typeof r === "object" && isSnapshot((r as { state?: unknown }).state)) {
        set({ snap: (r as unknown as { state: Snapshot }).state });
      }
      const head = (r as { log_head?: number } | null)?.log_head;
      if (typeof head === "number" && head > get().logHead) void get().fetchLog();
      else if (isSnapshot(r) && r.log_head > get().logHead) void get().fetchLog();
      return r;
    } catch (e) {
      if (!quiet) get().toast("err", String(e).replace(/^Error:\s*/, ""));
      void get().fetchLog();
      return null;
    }
  },

  setField: async (name, value) => {
    await get().call("set_field", { name, value });
  },
  setFields: async (values) => {
    await get().call("set_fields", { values });
  },
  setSettings: async (patch) => {
    await get().call("set_settings", { patch });
  },

  poll: async () => {
    try {
      const st = await rpc<Status>("status");
      set({ status: st, connError: null });
      if (st.log_head > get().logHead) await get().fetchLog();
    } catch (e) {
      set({ connError: String(e) });
    }
  },

  fetchLog: async () => {
    try {
      const r = await rpc<{ entries: Txn[]; head: number }>("log", { since: get().logHead });
      if (r.entries.length || r.head !== get().logHead) {
        const log = [...get().log, ...r.entries].slice(-2000);
        set({ log, logHead: r.head });
      }
    } catch {
      /* ignore */
    }
  },

  go: (view, block) => set(block !== undefined ? { view, block } : { view }),
  selectBlock: (b) => set({ block: b }),
  focus: (f) => set({ focusField: f }),
  toast: (kind, text) => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, kind, text }].slice(-4) });
    setTimeout(() => get().dismiss(id), kind === "err" ? 6500 : 3200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setConsole: (open) => set({ consoleOpen: open }),
  setTheme: (t) => {
    try {
      localStorage.setItem("pll.theme", t);
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = t;
    set({ theme: t });
  },
}));

export function useSnap() {
  return useStore((s) => s.snap);
}

/** Live simulator status (polled), falling back to the last snapshot. */
export function useSim() {
  const st = useStore((s) => s.status?.sim);
  const snapSim = useStore((s) => s.snap?.sim);
  return st ?? snapSim ?? null;
}

export function useField(name: string): number {
  return useStore((s) => s.snap?.fields[name] ?? 0);
}

export function lockInfo(sim: Snapshot["sim"], ld: boolean | null | undefined) {
  if (sim) {
    const map = {
      locked: { tone: "ok", text: "Захват" },
      settling: { tone: "warn", text: "Установление" },
      calibrating: { tone: "warn", text: "Калибровка ГУН" },
      unlocked: { tone: "err", text: "Нет захвата" },
      power_down: { tone: "off", text: "Выключен" },
    } as const;
    return map[sim.state] ?? { tone: "off", text: sim.state };
  }
  if (ld == null) return { tone: "off", text: "LD неизвестен" } as const;
  return ld ? ({ tone: "ok", text: "Захват (LD)" } as const) : ({ tone: "err", text: "Нет захвата (LD)" } as const);
}
