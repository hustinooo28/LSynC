import { useEffect } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { trackPressOrigin } from "@/lib/transition";

const SPOTLIGHT = ".card-hover, .card-brand, .glass";
const MAGNETIC = ".btn-primary, .btn-light";
const RIPPLE = ".btn";

/**
 * App-wide micro-interactions via event delegation, so every page gets them
 * without per-component wiring (React Bits "SpotlightCard", "Magnet" and
 * "ClickSpark" ideas):
 *  - cards light up under the cursor (CSS reads --mx/--my),
 *  - primary buttons drift toward the cursor and spring back,
 *  - buttons emit a soft ripple from the press point.
 */
export function useInteractionMotion() {
  useEffect(() => trackPressOrigin(), []);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const finePointer = matchMedia("(pointer: fine)").matches;
    const magnets = new WeakMap<Element, { x: gsap.QuickToFunc; y: gsap.QuickToFunc }>();
    let activeMagnet: HTMLElement | null = null;

    const release = () => {
      if (!activeMagnet) return;
      gsap.to(activeMagnet, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1, 0.4)" });
      activeMagnet = null;
    };

    const onMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const card = target?.closest<HTMLElement>(SPOTLIGHT);
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
      if (!finePointer) return;
      const btn = target?.closest<HTMLElement>(MAGNETIC);
      if (btn !== activeMagnet) release();
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      let mover = magnets.get(btn);
      if (!mover) {
        mover = { x: gsap.quickTo(btn, "x", { duration: 0.35 }), y: gsap.quickTo(btn, "y", { duration: 0.35 }) };
        magnets.set(btn, mover);
      }
      activeMagnet = btn;
      const r = btn.getBoundingClientRect();
      mover.x((e.clientX - (r.left + r.width / 2)) * 0.2);
      mover.y((e.clientY - (r.top + r.height / 2)) * 0.3);
    };

    const onDown = (e: PointerEvent) => {
      const btn = (e.target as Element | null)?.closest<HTMLElement>(RIPPLE);
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      Object.assign(ripple.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
      btn.appendChild(ripple);
      gsap.fromTo(ripple, { scale: 0, opacity: 0.35 }, { scale: 1, opacity: 0, duration: 0.7, ease: "power2.out", onComplete: () => ripple.remove() });
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerleave", release);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", release);
    };
  }, []);
}
