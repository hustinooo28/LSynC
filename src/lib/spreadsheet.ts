// CSV / Excel import helpers shared by the management sections.
import type { Row } from "read-excel-file/browser";

/** "Student ID" -> "studentid". */
const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Turns a cell matrix (first row = headers) into header-keyed records.
 * Repeated headers become "x", "x_2", "x_3"… instead of overwriting each
 * other, so wide sheets with one column group per event survive (see
 * `expandEventGroups`).
 */
function toRecords(cells: unknown[][]): Record<string, string>[] {
  if (cells.length < 2) return [];
  const counts = new Map<string, number>();
  const headers = cells[0].map((cell) => {
    const header = normalizeHeader(String(cell ?? ""));
    const count = (counts.get(header) ?? 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header}_${count}`;
  });
  return cells.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, i) => [header, String(values[i] ?? "").trim()])),
  );
}

/** Splits one CSV line, honouring double quotes and escaped `""`. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch !== '"') cur += ch;
      else if (line[i + 1] === '"') cur += line[i++];
      else inQuotes = false;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export const parseCsv = (text: string) =>
  toRecords(text.split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine));

export const excelRowsToRecords = (cells: Row[]) => toRecords(cells);

/** First non-empty value among the given normalized header aliases, else "". */
export function pickField(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[alias]?.trim();
    if (value) return value;
  }
  return "";
}

/** "₱1,500.00" / "1,500" / "1500" -> 1500; 0 for empty or invalid input. */
export function parseAmount(value: string): number {
  const n = parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** "2026- 00040" -> "2026-00040" (hand-typed sheets often have stray spaces). */
export const normalizeStudentId = (value: string) => value.replace(/\s+/g, "");

export interface EventAmountGroup {
  eventName: string;
  requiredAmount: string;
  amountPaid: string;
}

const EVENT_ALIASES = ["event", "eventname", "activity", "contributionfor"];
const REQUIRED_ALIASES = ["requiredamount", "required", "amount", "fee", "contribution", "contributionamount"];
const PAID_ALIASES = ["amountpaid", "paid", "paidamount", "amountcollected", "collected", "collection", "payment", "paymentamount"];

/**
 * Reads every (Event, Required Amount, Amount Paid) group in a row. Narrow
 * sheets (one row per student per event) yield one group; the wide official
 * "Student Body" sheet repeats the group per event as "event", "event_2"…
 */
export function expandEventGroups(row: Record<string, string>): EventAmountGroup[] {
  const groups: EventAmountGroup[] = [];
  for (let n = 1; n <= 60; n++) {
    const suffixed = (aliases: string[]) => aliases.map((alias) => (n === 1 ? alias : `${alias}_${n}`));
    const eventKeys = suffixed(EVENT_ALIASES);
    if (!eventKeys.some((key) => key in row)) break;
    const eventName = pickField(row, ...eventKeys);
    if (!eventName) continue; // this event slot is blank for this row
    groups.push({
      eventName,
      requiredAmount: pickField(row, ...suffixed(REQUIRED_ALIASES)),
      amountPaid: pickField(row, ...suffixed(PAID_ALIASES)),
    });
  }
  return groups;
}
