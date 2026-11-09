import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { gsap } from "gsap";

/** True when the person asked for less motion. Everything animated checks this, and the page still works without it. */
const query = () => (typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)"));
export const prefersReducedMotion = (): boolean => query()?.matches ?? false;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = query();
      q?.addEventListener("change", cb);
      return () => q?.removeEventListener("change", cb);
    },
    prefersReducedMotion,
    () => false,
  );
}

/** A mouse or trackpad with real hover, not a touch screen. Used for effects that only make sense with a pointer. */
export const hasHover = (): boolean => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Fades children marked [data-reveal] in as they scroll into view. Without motion they are simply visible. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
  return ref;
}

/** A number that counts up to its value (and re-counts when it changes). */
export function useCountUp(target: number, duration = 1.4): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) return; // without motion the value is simply the target (see the return below)
    const o = { v: from.current };
    const tween = gsap.to(o, {
      v: target,
      duration,
      ease: "power3.out",
      onUpdate: () => {
        from.current = o.v;
        setShown(o.v);
      },
    });
    return () => {
      tween.kill();
    };
  }, [target, duration, reduced]);
  return reduced ? target : shown;
}

export { gsap };
