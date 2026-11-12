import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Lowercased, punctuation-free, word-sorted name, so "Dela Cruz, Juan" == "Juan Dela Cruz". */
function normalizeNameForMatch(value: string): string {
  return splitSearchWords(value.replace(/[.,]/g, "")).sort().join(" ");
}

/** Same person regardless of word order. Use to verify a typed name against a record. */
export function namesMatch(a: string, b: string): boolean {
  return normalizeNameForMatch(a) === normalizeNameForMatch(b);
}

/**
 * Canonical stored name: single-spaced Title Case per letter/digit run (like
 * Postgres initcap(), e.g. "santos-reyes" -> "Santos-Reyes"); word order is
 * never changed. Keep in sync with
 * supabase/migrations/2026-09-16_normalize_student_names.sql.
 */
export function normalizeStudentName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[a-z0-9]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

/** Lowercase words of a search query. */
export function splitSearchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every (partial) query word appears somewhere in `haystack`, in any order — for type-ahead filters. */
export function matchesSearchWords(haystack: string, query: string): boolean {
  const target = haystack.toLowerCase();
  return splitSearchWords(query).every((word) => target.includes(word));
}

/** Escapes ILIKE wildcards (% _ \) so user text matches literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
