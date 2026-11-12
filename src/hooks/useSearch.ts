import { useMemo, useState } from "react";
import { matchesSearchWords } from "@/lib/utils";

type Accessor<T> = (item: T) => string;

/**
 * Search box + exact-match dropdown filters over an in-memory list.
 * `text` builds the searchable string; each `filters` accessor is compared
 * against the selected value ("" = any). Pass stable (module-level or
 * memoized) accessors to avoid recomputing every render.
 */
export function useSearch<T>(items: T[], text: Accessor<T>, filters: Record<string, Accessor<T>> = {}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          matchesSearchWords(text(item), query) &&
          Object.entries(filters).every(([key, get]) => !selected[key] || get(item) === selected[key]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, query, selected],
  );

  return {
    query,
    setQuery,
    filters: selected,
    setFilter: (key: string, value: string) => setSelected((prev) => ({ ...prev, [key]: value })),
    reset: () => {
      setQuery("");
      setSelected({});
    },
    filtered,
  };
}
