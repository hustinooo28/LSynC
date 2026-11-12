import type { ComponentProps } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = "end", sideOffset = 6, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("card z-50 min-w-[10rem] p-1.5 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 origin-[var(--radix-dropdown-menu-content-transform-origin)]", className)}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, danger, ...props }: ComponentProps<typeof M.Item> & { danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 transition duration-150 focus:translate-x-0.5 text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:h-4 [&_svg]:w-4",
        danger ? "text-danger focus:bg-danger/10" : "text-ink focus:bg-surface-2 [&_svg]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;

/** Common "⋮" row-actions trigger. */
export function RowActionsTrigger({ label }: { label: string }) {
  return (
    <MenuTrigger asChild>
      <button className="btn btn-ghost btn-sm btn-icon" aria-label={label}>
        <MoreVertical className="h-4 w-4" />
      </button>
    </MenuTrigger>
  );
}
