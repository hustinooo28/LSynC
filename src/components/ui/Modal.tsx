import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl", "2xl": "max-w-3xl" };

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

/** The single dialog primitive used by every modal in the app. */
export default function Modal({ open, onClose, title, description, icon, size = "md", footer, children, className }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-950/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:duration-300 data-[state=closed]:duration-200" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "card fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col shadow-lift outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-200",
            SIZES[size],
            className,
          )}
        >
          <div className="flex items-start gap-3 p-6 pb-4">
            {icon && <div className="icon-tile bg-brand-500/10 border-transparent">{icon}</div>}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold text-ink">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="btn btn-ghost btn-sm btn-icon -mr-2 -mt-1" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children && <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
