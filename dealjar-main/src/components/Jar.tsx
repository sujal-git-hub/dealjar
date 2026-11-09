import { useEffect, useRef } from "react";
import { Bodies, Body, Composite, Constraint, Engine, type IChamferableBodyDefinition } from "matter-js";
import { usd } from "@shared/money";
import type { AssetId } from "@shared/types";
import { prefersReducedMotion } from "@/lib/motion";

/*
  The jar is a toy. Every coin is a real body in a small physics world: it falls, bounces, stacks and can be stirred
  with the pointer, grabbed and dragged around, tapped to shake, or (on a phone) shaken for real. One coin stands for a
  few dollars, so the pile grows as the person saves. The cap is one complete lid, so nothing can fly out. Without motion the coins are already
  settled and still.
*/

const ORDER: AssetId[] = ["USDT", "EURE", "XAUT0"];
const GLYPH: Record<AssetId, string> = { USDT: "$", EURE: "€", XAUT0: "G" };
const COLOR: Record<AssetId, [string, string, string]> = {
  USDT: ["#8ef2c6", "#3ddc97", "#27b97c"],
  EURE: ["#aab4ff", "#7d8bff", "#5666e8"],
  XAUT0: ["#ffe888", "#ffd23f", "#f0b400"],
};
const MAX_COINS = 56;
const VIEW = { x: 0, y: 18, w: 260, h: 332 };
const BODY = "M70 40 H190 C214 40 232 58 232 84 V290 C232 318 212 334 186 334 H74 C48 334 28 318 28 290 V84 C28 58 46 40 70 40 Z";

/** Points along a cubic curve. */
const curve = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], n = 7): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
  });

/** The glass outline (the same curves as BODY, mouth to mouth). The physics walls are built along it so coins stay inside the glass. */
const OUTLINE: [number, number][] = [
  ...curve([70, 40], [46, 40], [28, 58], [28, 84]),
  [28, 290],
  ...curve([28, 290], [28, 318], [48, 334], [74, 334]),
  [186, 334],
  ...curve([186, 334], [212, 334], [232, 318], [232, 290]),
  [232, 84],
  ...curve([232, 84], [232, 58], [214, 40], [190, 40]),
];

/** Static wall pieces along the outline, set 2 units inside the stroke so coins rest against the inner edge. */
function glassWalls(opts: IChamferableBodyDefinition): Body[] {
  const out: Body[] = [];
  for (let i = 0; i < OUTLINE.length - 1; i++) {
    const [x0, y0] = OUTLINE[i];
    const [x1, y1] = OUTLINE[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.5) continue;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    let nx = -(y1 - y0) / len;
    let ny = (x1 - x0) / len;
    if (nx * (mx - 130) + ny * (my - 190) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const thick = 26;
    const off = thick / 2 - 2;
    out.push(Bodies.rectangle(mx + nx * off, my + ny * off, len + 4, thick, { ...opts, angle: Math.atan2(y1 - y0, x1 - x0) }));
  }
  return out;
}

export type JarProps = {
  holdings: Record<AssetId, number>;
  target: number;
  /** Change this number to thump the jar (a reward just landed). */
  burst?: number;
  label: string;
  className?: string;
};

type Coin = Body & { asset?: AssetId; born?: number };

/** How many coins each asset gets: one coin per dollar, or per few dollars once the pile would be too big. */
export function coinCounts(holdings: Record<AssetId, number>): Record<AssetId, number> {
  const total = ORDER.reduce((s, id) => s + Math.max(0, holdings[id]), 0);
  const unit = Math.max(usd(1), total / MAX_COINS);
  const out = { USDT: 0, EURE: 0, XAUT0: 0 } as Record<AssetId, number>;
  for (const id of ORDER) {
    const m = Math.max(0, holdings[id]);
    out[id] = m > 0 ? Math.max(1, Math.round(m / unit)) : 0;
  }
  return out;
}

export function Jar({ holdings, target, burst = 0, label, className = "" }: JarProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<{ sync: (c: Record<AssetId, number>) => void; thump: () => void } | null>(null);
  const counts = coinCounts(holdings);
  const countsKey = ORDER.map((id) => counts[id]).join("-");
  const lastBurst = useRef(burst);
  const total = ORDER.reduce((s, id) => s + Math.max(0, holdings[id]), 0);
  const pct = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = prefersReducedMotion();
    const engine = Engine.create({ gravity: { x: 0, y: 1, scale: 0.0011 } });
    const wall = { isStatic: true, friction: 0.3, restitution: 0.2 };
    Composite.add(engine.world, [...glassWalls(wall), Bodies.rectangle(130, 41, 150, 26, wall) /* the cap: one complete lid */]);

    let coins: Coin[] = [];
    let raf = 0;
    let awakeUntil = 0;
    let visible = true;
    const timers: number[] = [];

    const radius = () => (coins.length <= 24 ? 15 : coins.length <= 40 ? 13.5 : 12);
    const spawn = (asset: AssetId, y = 66 + Math.random() * 6) => {
      // new coins pop out under the cap; coins placed straight into a settled pile start lower down
      const x = y < 100 ? 130 + (Math.random() - 0.5) * 24 : 62 + Math.random() * 136;
      const b = Bodies.circle(x, y, radius(), { restitution: 0.42, friction: 0.08, frictionAir: 0.004, density: 0.0012 }) as Coin;
      b.asset = asset;
      if (!reduced) b.born = performance.now();
      Body.setAngle(b, Math.random() * 6.28);
      Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.4);
      coins.push(b);
      Composite.add(engine.world, b);
    };

    const glass = new Path2D(BODY);
    const paintCoin = (b: Coin) => {
      const r = b.circleRadius ?? 13;
      const asset = b.asset ?? "USDT";
      const [hi, mid, lo] = COLOR[asset];
      const age = b.born ? Math.min(1, (performance.now() - b.born) / 220) : 1;
      const pop = 0.2 + 0.8 * age * (2 - age);
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.globalAlpha = Math.min(1, age * 2.5);
      ctx.scale(pop, pop);
      ctx.beginPath();
      ctx.arc(1.5, 2.6, r, 0, 6.2832); // hard shadow, which does not spin
      ctx.fillStyle = "#17120e";
      ctx.fill();
      ctx.rotate(b.angle);
      const g = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.1, 0, 0, r * 1.05);
      g.addColorStop(0, hi);
      g.addColorStop(0.55, mid);
      g.addColorStop(1, lo);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 6.2832);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#17120e";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.66, 0, 6.2832);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = "rgba(23,18,14,.45)";
      ctx.stroke();
      ctx.fillStyle = "#17120e";
      ctx.font = `800 ${Math.round(r * 0.95)}px "Bricolage Grotesque", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(GLYPH[asset], 0, 0.5);
      ctx.restore();
    };

    const draw = () => {
      const w = el.clientWidth;
      if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(((w * VIEW.h) / VIEW.w) * dpr);
      }
      const k = el.width / VIEW.w;
      ctx.setTransform(k, 0, 0, k, -VIEW.x * k, -VIEW.y * k);
      ctx.clearRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
      ctx.save();
      ctx.clip(glass);
      for (const b of coins) paintCoin(b);
      ctx.restore();
    };

    const frame = () => {
      raf = 0;
      Engine.update(engine, 1000 / 60);
      draw();
      if (visible && performance.now() < awakeUntil) raf = requestAnimationFrame(frame);
    };
    const wake = (ms = 2600) => {
      awakeUntil = performance.now() + ms;
      for (const b of coins) Body.set(b, "isSleeping", false);
      if (!raf && visible) raf = requestAnimationFrame(frame);
    };

    const settleNow = () => {
      for (let i = 0; i < 700; i++) Engine.update(engine, 1000 / 60);
      draw();
    };

    // coins already queued to drop in, so a second sync before they land doesn't order them twice
    const queued = { USDT: 0, EURE: 0, XAUT0: 0 } as Record<AssetId, number>;
    const sync = (want: Record<AssetId, number>) => {
      let added = 0;
      for (const id of ORDER) {
        const have = coins.filter((c) => c.asset === id);
        for (let i = have.length; i > want[id]; i--) {
          const gone = have[i - 1];
          Composite.remove(engine.world, gone);
          coins = coins.filter((c) => c !== gone);
        }
        for (let i = have.length + queued[id]; i < want[id]; i++) {
          if (reduced) spawn(id, 70 + Math.random() * 90);
          else {
            added += 1;
            queued[id] += 1;
            timers.push(
              window.setTimeout(() => {
                queued[id] -= 1;
                spawn(id);
                wake();
              }, Math.min(1800, added * 40)),
            );
          }
        }
      }
      if (reduced) settleNow();
      else wake(3200);
    };

    const thump = () => {
      if (reduced) return;
      for (const b of coins) Body.setVelocity(b, { x: (Math.random() - 0.5) * 3, y: -(2 + Math.random() * 4) });
      wake(3000);
    };

    // stir with the pointer
    let last = { x: 0, y: 0, t: 0 };
    const move = (e: PointerEvent) => {
      const p = toWorld(e);
      if (grab) {
        // keep the held coin inside the glass, below the cap
        grab.pointA = { x: Math.min(222, Math.max(38, p.x)), y: Math.min(322, Math.max(66, p.y)) };
        wake(1500);
        return;
      }
      if (reduced) return; // stirring by hovering is decoration; grabbing a coin is not
      const dt = Math.max(8, performance.now() - last.t);
      const vx = (p.x - last.x) / dt;
      const vy = (p.y - last.y) / dt;
      last = { ...p, t: performance.now() };
      for (const b of coins) {
        const dx = b.position.x - p.x;
        const dy = b.position.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 60) {
          const f = (1 - d / 60) * 0.004;
          Body.applyForce(b, b.position, { x: vx * f * 9 + (dx / (d || 1)) * f * 0.5, y: vy * f * 9 + (dy / (d || 1)) * f * 0.5 });
        }
      }
      wake(1200);
    };
    const motion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a && Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) > 24) thump();
    };

    const io = new IntersectionObserver((es) => {
      visible = es[0]?.isIntersecting ?? true;
      if (visible && !reduced) wake(800);
    });
    io.observe(el);
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    // grab a coin and drag it anywhere inside the glass
    let grab: Constraint | null = null;
    const toWorld = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: VIEW.x + ((e.clientX - r.left) / r.width) * VIEW.w, y: VIEW.y + ((e.clientY - r.top) / r.height) * VIEW.h };
    };
    const pick = (p: { x: number; y: number }) => {
      let best: Coin | null = null;
      let bestD = Infinity;
      for (const b of coins) {
        const d = Math.hypot(b.position.x - p.x, b.position.y - p.y);
        if (d < (b.circleRadius ?? 13) + 6 && d < bestD) {
          best = b;
          bestD = d;
        }
      }
      return best;
    };
    const release = () => {
      if (!grab) return;
      Composite.remove(engine.world, grab);
      grab = null;
      el.style.cursor = "";
      wake(2000);
    };
    const down = (e: PointerEvent) => {
      const p = toWorld(e);
      const c = pick(p);
      if (!c) return thump();
      el.setPointerCapture(e.pointerId);
      grab = Constraint.create({ pointA: p, bodyB: c, pointB: { x: p.x - c.position.x, y: p.y - c.position.y }, stiffness: 0.22, damping: 0.14, length: 0 });
      Composite.add(engine.world, grab);
      el.style.cursor = "grabbing";
      wake(4000);
    };
    // on a touch screen a finger that lands on a coin drags it instead of scrolling the page
    const touch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && pick(toWorld(t))) e.preventDefault();
    };
    const hover = (e: PointerEvent) => {
      if (!grab && e.pointerType === "mouse") el.style.cursor = pick(toWorld(e)) ? "grab" : "";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointermove", hover);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("touchstart", touch, { passive: false });
    window.addEventListener("devicemotion", motion);

    world.current = { sync, thump };
    sync(counts);
    return () => {
      world.current = null;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      io.disconnect();
      ro.disconnect();
      release();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointermove", hover);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("touchstart", touch);
      window.removeEventListener("devicemotion", motion);
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    };
    // the world is built once; later changes arrive through `sync` and `thump`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    world.current?.sync(counts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey]);

  useEffect(() => {
    if (burst !== lastBurst.current) {
      lastBurst.current = burst;
      world.current?.thump();
    }
  }, [burst]);

  const vb = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;
  return (
    <div className={`relative select-none ${className}`} style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}` }} role="img" aria-label={`${label}. ${pct}% of the way to the goal.`}>
      <svg className="absolute inset-0 h-full w-full" viewBox={vb} aria-hidden="true">
        <ellipse cx="130" cy="342" rx="100" ry="7" fill="#17120e" opacity=".16" />
        <path d={BODY} fill="#fffaf0" opacity=".85" />
      </svg>
      <canvas ref={canvas} aria-hidden="true" className="jar-canvas absolute inset-0 h-full w-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={vb} aria-hidden="true">
        <path d="M44 86 C39 130 39 220 44 282" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".65" />
        <path d={BODY} fill="none" stroke="#17120e" strokeWidth="3.5" strokeLinejoin="round" />
        {/* the cap: one complete lid */}
        <rect x="36" y="24" width="188" height="32" rx="11" fill="#ffb100" stroke="#17120e" strokeWidth="3.5" />
        <path d="M54 35h152M54 45h152" stroke="#17120e" strokeWidth="2" opacity=".3" />
      </svg>
    </div>
  );
}
