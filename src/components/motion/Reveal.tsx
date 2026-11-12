import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger direct children instead of revealing the wrapper as one block. */
  stagger?: boolean;
}

/** Scroll-triggered fade/rise (React Bits "AnimatedContent" pattern on ScrollTrigger). */
export default function Reveal({ children, className, stagger }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion()) return;
      gsap.from(stagger ? ref.current.children : ref.current, {
        y: 48,
        opacity: 0,
        filter: "blur(8px)",
        duration: 0.9,
        stagger: 0.09,
        clearProps: "filter,transform",
        scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
