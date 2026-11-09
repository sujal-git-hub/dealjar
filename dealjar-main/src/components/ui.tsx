import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Link } from "react-router";
import { formatMoney } from "@shared/money";
import type { Currency } from "@shared/types";
import { gsap, hasHover, prefersReducedMotion, useCountUp } from "@/lib/motion";

/** Money that counts up to its value, in the person's own currency. */
export function Money({ micro, currency, className = "" }: { micro: number; currency: Currency; className?: string }) {
  const v = useCountUp(micro);
  return <span className={`num ${className}`}>{formatMoney(Math.round(v), currency)}</span>;
}

/** A button that leans toward the pointer. Only on devices with a real mouse, and never with reduced motion. */
export function Magnetic({ children, strength = 0.28 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasHover() || prefersReducedMotion()) return;
    const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
    const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x((e.clientX - (r.left + r.width / 2)) * strength);
      y((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const leave = () => {
      x(0);
      y(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);
  return (
    <span ref={ref} className="inline-block">
      {children}
    </span>
  );
}

/** A looping line of names. Decorative: screen readers skip the copy. */
export function Marquee({ items }: { items: string[] }) {
  const row = (hidden: boolean) => (
    <div className="marquee-track" aria-hidden={hidden || undefined}>
      {items.map((t) => (
        <span key={t} className="display display-sm whitespace-nowrap opacity-80">
          {t}
          <span className="serif mx-5 text-[1.3em] opacity-60">&amp;</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="marquee" role="presentation">
      {row(false)}
      {row(true)}
    </div>
  );
}

/** A native dialog: focus is trapped, Escape closes it, and the page behind is inert. A bottom sheet on phones. */
export function Sheet({ open, onClose, title, children, label }: { open: boolean; onClose: () => void; title: string; children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none bg-transparent p-0 text-[var(--ink)] open:flex open:flex-col md:m-auto md:max-w-[560px]"
    >
      <div className="max-h-[92dvh] overflow-y-auto rounded-t-[32px] border-2 border-[var(--ink)] bg-[var(--paper)] px-6 pb-[calc(28px+env(safe-area-inset-bottom))] pt-6 md:rounded-[32px]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {label && <p className="eyebrow">{label}</p>}
            <h2 className="display display-md mt-1">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-[var(--ink)]">
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 id={id} className="display display-lg">
        {children}
      </h2>
      {action}
    </div>
  );
}

export const TextLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="font-semibold underline decoration-2 underline-offset-4">
    {children}
  </Link>
);

export const Demo = () => <span className="tag tag-demo">Demo data</span>;

/** The top of a tab: a full-width cobalt band with the page's name, so every tab has its own colour. */
export function PageBand({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="page-band">
      <div className="wrap relative pb-9 pt-5 md:pb-14 md:pt-12">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display display-xl mt-3 !text-[clamp(40px,9.5vw,92px)]">{title}</h1>
        {children}
      </div>
    </section>
  );
}
