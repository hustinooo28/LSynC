import { useMemo, useState } from "react";

/** Client-side pagination; falls back to page 1 whenever the item list changes. */
export function usePagination<T>(items: T[], pageSize = 10) {
  // Remember which list the chosen page belongs to, so a new list starts at 1
  // without a reset effect.
  const [state, setState] = useState({ page: 1, items });
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = state.items === items ? Math.min(state.page, totalPages) : 1;

  const pageItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);

  return {
    pageItems,
    /** Spread onto <Pagination />. */
    pagination: { page, totalPages, totalItems: items.length, pageSize, onPage: (p: number) => setState({ page: p, items }) },
  };
}
