import { useEffect, useMemo, useState } from "react";

/** Client-side pagination; resets to page 1 whenever the item list changes. */
export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => setPage(1), [items]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  return {
    pageItems,
    /** Spread onto <Pagination />. */
    pagination: { page: Math.min(page, totalPages), totalPages, totalItems: items.length, pageSize, onPage: setPage },
  };
}
