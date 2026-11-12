import { flushSync } from "react-dom";
import { prefersReducedMotion } from "@/lib/gsap";

/** One fluid curve for every grow/shrink (decelerates like a settling liquid). */
export const FLUID_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
export const FLUID_MS = 750;

const PRESSABLE = "button, a, [role=button], [role=menuitem], [role=tab], .card-hover, .card-brand";
let last: { el: Element; rect: DOMRect; at: number } | null = null;

/** Remember what the user last pressed so whatever it opens can grow out of it. */
export function trackPressOrigin(): () => void {
  const onDown = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest(PRESSABLE);
    if (el) last = { el, rect: el.getBoundingClientRect(), at: performance.now() };
  };
  document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
  return () => document.removeEventListener("pointerdown", onDown, { capture: true });
}

/**
 * Where the current action came from: the last pressed element (if recent —
 * async actions like a record lookup can take a few seconds), else the
 * keyboard-focused element, else nothing.
 */
export function pressOrigin(): DOMRect | null {
  if (last && performance.now() - last.at < 6000) return last.el.isConnected ? last.el.getBoundingClientRect() : last.rect;
  const focused = document.activeElement;
  return focused && focused !== document.body ? focused.getBoundingClientRect() : null;
}

/** Corner radius an element of this size most likely has (pills stay pills). */
export const radiusFor = (r: DOMRect) => Math.min(r.height / 2, 28);

/**
 * Swap the page so the new state grows out of the pressed element while the
 * old one sinks back (View Transitions API). Falls back to an instant update.
 * `shape: "circle"` spreads a circle from the origin instead (theme switch).
 */
export function growFrom(update: () => void, { origin = pressOrigin(), shape = "morph" as "morph" | "circle" } = {}) {
  if (!document.startViewTransition || !origin || prefersReducedMotion()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = "";
  const transition = document.startViewTransition(() => flushSync(update));
  transition.ready.then(() => {
    const { innerWidth: w, innerHeight: h } = window;
    const cx = origin.left + origin.width / 2;
    const cy = origin.top + origin.height / 2;
    const clipPath =
      shape === "circle"
        ? [`circle(0px at ${cx}px ${cy}px)`, `circle(${Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))}px at ${cx}px ${cy}px)`]
        : [
            `inset(${origin.top}px ${w - origin.right}px ${h - origin.bottom}px ${origin.left}px round ${radiusFor(origin)}px)`,
            "inset(0px 0px 0px 0px round 0px)",
          ];
    const timing = { duration: FLUID_MS, easing: FLUID_EASE };
    root.animate({ clipPath }, { ...timing, pseudoElement: "::view-transition-new(root)" });
    if (shape === "morph") {
      root.animate(
        { scale: [1, 0.94], opacity: [1, 0.5], filter: ["blur(0px)", "blur(6px)"] },
        { ...timing, pseudoElement: "::view-transition-old(root)" },
      );
    }
  });
  transition.finished.finally(() => delete root.dataset.vt);
}
