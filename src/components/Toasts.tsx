import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useStore } from "../lib/store";
import { cx } from "./ui";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[360px] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "pointer-events-auto flex items-start gap-2 rounded-xl border bg-panel/95 backdrop-blur px-3 py-2.5 shadow-xl text-[12.5px]",
            t.kind === "err" ? "border-err/40" : t.kind === "ok" ? "border-ok/40" : "border-line"
          )}
        >
          <span className={cx("mt-0.5", t.kind === "err" ? "text-err" : t.kind === "ok" ? "text-ok" : "text-accent")}>
            {t.kind === "err" ? <TriangleAlert size={15} /> : t.kind === "ok" ? <CircleCheck size={15} /> : <Info size={15} />}
          </span>
          <div className="flex-1 leading-snug text-fg2 selectable">{t.text}</div>
          <button className="text-muted hover:text-fg" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
