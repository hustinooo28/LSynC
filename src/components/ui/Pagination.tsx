import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPage: (page: number) => void;
}

/** "Showing X–Y of Z" + compact page buttons. Renders nothing for one page. */
export default function Pagination({ page, totalPages, totalItems, pageSize, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => start + i);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted sm:flex-row">
      <span>
        Showing <b className="text-ink">{from}–{to}</b> of <b className="text-ink">{totalItems}</b>
      </span>
      <div className="flex items-center gap-1">
        <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p) => (
          <button key={p} onClick={() => onPage(p)} className={cn("btn btn-sm btn-icon", p === page ? "btn-primary" : "btn-ghost")}>
            {p}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
