import { cn } from "@/lib/utils";

export default function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** Card-shaped loading placeholder for tables/lists. */
export function LoadingCard({ rows = 5, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div className="card space-y-3 p-6" role="status" aria-label={label}>
      <Skeleton className="h-5 w-48" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
