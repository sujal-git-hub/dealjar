import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";

type Kind = "ok" | "error";
type T = { id: number; text: string; kind: Kind };
const ToastCtx = createContext<(text: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/** A short message at the bottom of the screen. Announced to screen readers, gone after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<T[]>([]);
  const push = useCallback((text: string, kind: Kind = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[88px] z-[90] mx-auto flex w-full max-w-[520px] flex-col items-center gap-2 px-4 md:bottom-6" role="status" aria-live="polite">
        {list.map((t) => (
          <p key={t.id} className={`pointer-events-auto flex items-center gap-2 rounded-2xl border-2 border-[var(--ink)] px-4 py-3 text-[15px] font-semibold shadow-[0_6px_0_rgb(23_18_14/0.15)] ${t.kind === "error" ? "bg-[var(--danger-bg)] text-[var(--danger)]" : "bg-[var(--card)] text-[var(--ink)]"}`}>
            {t.kind === "error" ? <CircleAlert aria-hidden="true" size={18} /> : <Check aria-hidden="true" size={18} />}
            {t.text}
          </p>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
