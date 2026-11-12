import { useEffect } from "react";
import Lenis from "lenis";
import { gsap, ScrollTrigger, prefersReducedMotion } from "@/lib/gsap";
import { smooth } from "@/lib/scroll";

/** Lenis smooth scrolling driven by GSAP's ticker so ScrollTrigger stays in sync. */
export default function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const lenis = new Lenis({ autoRaf: false, allowNestedScroll: true, lerp: 0.1 });
    smooth.lenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // Pause while a Radix dialog/menu locks body scroll.
    const lockObserver = new MutationObserver(() =>
      document.body.hasAttribute("data-scroll-locked") ? lenis.stop() : lenis.start(),
    );
    lockObserver.observe(document.body, { attributes: true, attributeFilter: ["data-scroll-locked"] });

    return () => {
      lockObserver.disconnect();
      gsap.ticker.remove(tick);
      lenis.destroy();
      smooth.lenis = null;
    };
  }, []);
  return null;
}
