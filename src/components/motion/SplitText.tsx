import { useRef, type ElementType, type ReactNode } from "react";
import { gsap, SplitText as GSAPSplitText, useGSAP, prefersReducedMotion } from "@/lib/gsap";

interface SplitTextProps {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  /** Animate by "words" (calmer, for page titles) or "chars" (hero headlines). */
  by?: "words" | "chars";
  delay?: number;
}

/** Masked, staggered text rise (React Bits "SplitText" pattern on GSAP's SplitText). */
export default function SplitText({ as: Tag = "h1", className, children, by = "words", delay = 0 }: SplitTextProps) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion()) return;
      const split = GSAPSplitText.create(ref.current, { type: by === "chars" ? "words,chars" : "words", mask: "words" });
      gsap.from(by === "chars" ? split.chars : split.words, {
        yPercent: 110,
        opacity: 0,
        duration: by === "chars" ? 0.9 : 0.7,
        stagger: by === "chars" ? 0.018 : 0.05,
        delay,
        ease: "expo.out",
      });
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
