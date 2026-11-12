import { useRef } from "react";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";

/**
 * Counts the numeric part of `value` up from its previous value (or 0), keeping
 * any prefix/suffix — "₱48,250", "92%", "1,204" all work. Non-numeric values
 * render as-is. Updates the DOM directly so ticking never re-renders React.
 */
export default function CountUp({ value }: { value: number | string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const text = String(value);
  const match = /^(\D*?)(-?[\d,]*\.?\d+)(.*)$/.exec(text);

  useGSAP(
    () => {
      if (!match || !ref.current || prefersReducedMotion()) return;
      const [, prefix, num, suffix] = match;
      const target = Number(num.replace(/,/g, ""));
      const decimals = num.includes(".") ? num.split(".")[1].length : 0;
      const grouped = num.includes(",") || target >= 1000;
      const counter = { n: from.current };
      gsap.to(counter, {
        n: target,
        duration: 1.2,
        ease: "power2.out",
        onUpdate: () => {
          const n = grouped
            ? counter.n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
            : counter.n.toFixed(decimals);
          if (ref.current) ref.current.textContent = `${prefix}${n}${suffix}`;
        },
        onComplete: () => void (from.current = target),
      });
    },
    { dependencies: [text] },
  );

  return <span ref={ref}>{text}</span>;
}
