// One RPC for both runtimes:
//  • desktop (Tauri): invoke("rpc") → Rust Engine in-process
//  • web / remote lab: POST /api/rpc → pll-server (same Engine over HTTP)

import { invoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/** Opens an HTTP(S) link in the system browser (desktop) or a separate tab (web). */
export async function openUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Разрешены только ссылки HTTP/HTTPS");
  if (isTauri) {
    await invoke("open_url", { url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function rpc<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    return invoke<T>("rpc", { cmd, args });
  }
  const r = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} — запущен ли pll-server?`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.data as T;
}

/** Save a text file: native dialog in Tauri, download in the browser. */
export async function saveTextFile(defaultName: string, text: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: "Конфигурация 8V97051", extensions: ["txt"] }] });
    if (!path) return null;
    await invoke("save_text", { path, text });
    return path;
  }
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return defaultName;
}

export async function openTextFile(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "Конфигурация", extensions: ["txt", "csv", "h", "json"] }] });
    if (!path || Array.isArray(path)) return null;
    return invoke<string>("load_text", { path });
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".txt,.csv,.h,.json";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      resolve(f ? await f.text() : null);
    };
    inp.click();
  });
}
