import type Lenis from "lenis";

/** The active Lenis instance (set by <SmoothScroll />), if smooth scrolling is on. */
export const smooth: { lenis: Lenis | null } = { lenis: null };

/** Jump to the top on view changes (Lenis-aware). */
export function scrollToTop() {
  if (smooth.lenis) smooth.lenis.scrollTo(0, { immediate: true });
  else window.scrollTo(0, 0);
}
