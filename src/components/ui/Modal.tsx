import { useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { pressOrigin, radiusFor } from "@/lib/transition";

const SIZES = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl", "2xl": "max-w-3xl" };
const CARD_RADIUS = 24;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Optional icon shown in a tinted circle next to the title. */
  icon?: ReactNode;
  size?: keyof typeof SIZES;
  /** Sticky action row (buttons) rendered under the scrollable body. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const inset = (t: number, r: number, b: number, l: number, round: number) =>
  `inset(${t}px ${r}px ${b}px ${l}px round ${round}px)`;

/**
 * Where the panel "starts" so it looks like the pressed element: a clip window
 * the size and roundness of that element, shifted onto it. Tweening this to the
 * full panel reads as the button flowing open into the dialog — no stretching.
 */
function morphFrom(origin: DOMRect | null, panel: DOMRect) {
  if (!origin) return { x: 0, y: 32, clipPath: inset(0, 0, 0, 0, CARD_RADIUS), opacity: 0 };
  const dx = Math.max(0, (panel.width - origin.width) / 2);
  const dy = Math.max(0, (panel.height - origin.height) / 2);
  return {
    x: origin.left + origin.width / 2 - (panel.left + panel.width / 2),
    y: origin.top + origin.height / 2 - (panel.top + panel.height / 2),
    clipPath: inset(dy, dx, dy, dx, radiusFor(origin)),
    opacity: 1,
  };
}

/** The single dialog primitive. It grows out of whatever opened it and flows back into it on close. */
export default function Modal({ open, onClose, title, description, icon, size = "md", footer, children, className }: ModalProps) {
  // Stay mounted through the closing morph; mount immediately on open.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const overlayRef = useRef<HTMLDivElement>(null);
  // State (not a ref): Radix mounts the portal a render later, so the morph
  // must start when the panel actually attaches.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const origin = useRef<DOMRect | null>(null);

  useGSAP(
    () => {
      const [overlay, inner] = [overlayRef.current, innerRef.current];
      if (!mounted || !overlay || !panel || !inner) return;
      gsap.killTweensOf([overlay, panel, inner]);
      if (prefersReducedMotion()) {
        if (!open) setMounted(false);
        return;
      }
      if (open) origin.current = pressOrigin();
      const from = morphFrom(origin.current, panel.getBoundingClientRect());
      const full = { x: 0, y: 0, opacity: 1, clipPath: inset(0, 0, 0, 0, CARD_RADIUS) };

      if (open) {
        gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" });
        gsap.fromTo(panel, from, { ...full, duration: 0.8, ease: "expo.out", clearProps: "clipPath,transform" });
        gsap.fromTo(inner, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.2, ease: "power2.out" });
      } else {
        gsap.to(inner, { opacity: 0, duration: 0.18, ease: "power1.in" });
        gsap.to(overlay, { opacity: 0, duration: 0.5, delay: 0.1, ease: "power2.inOut" });
        gsap.fromTo(panel, full, { ...from, duration: 0.6, ease: "expo.inOut", onComplete: () => setMounted(false) });
      }
    },
    { dependencies: [open, mounted, panel] },
  );

  return (
    <Dialog.Root open={mounted} onOpenChange={(o) => !o && open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay ref={overlayRef} className="fixed inset-0 z-50 bg-brand-950/50 backdrop-blur-sm" />
        <div className={cn("fixed inset-0 z-50 grid place-items-center p-4", !open && "pointer-events-none")}>
          <Dialog.Content
            ref={setPanel}
            aria-describedby={undefined}
            className={cn("card flex max-h-[calc(100dvh-2rem)] w-full flex-col shadow-lift outline-none will-change-[clip-path,transform]", SIZES[size], className)}
          >
            <div ref={innerRef} className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-start gap-3 p-6 pb-4">
                {icon && <div className="icon-tile border-transparent bg-brand-500/10">{icon}</div>}
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="text-lg font-bold text-ink">{title}</Dialog.Title>
                  {description && <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>}
                </div>
                <Dialog.Close className="btn btn-ghost btn-sm btn-icon -mr-2 -mt-1" aria-label="Close">
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>
              {children && (
                <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
                  {children}
                </div>
              )}
              {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line/60 px-6 py-4">{footer}</div>}
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
