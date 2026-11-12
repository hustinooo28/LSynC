/** e.g. `Sep 8, 2026`; "-" for empty input, the raw value when unparseable. */
export function formatDate(value: string | Date): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** e.g. `1500 -> "₱1,500"`. */
export function formatPeso(amount: number): string {
  return `₱${amount.toLocaleString("en-US")}`;
}

/** e.g. `1 -> "st"`, `22 -> "nd"`, `13 -> "th"`. */
export function getOrdinalSuffix(num: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = num % 100;
  return suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0];
}

/** Whole days (rounded up) from now until `date`. */
export function daysUntil(date: string): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

/** Today as a UTC `YYYY-MM-DD` string. */
export function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** 24h "HH:MM" -> "6:30 AM"; "—" when empty, the raw value when not a time. */
export function formatTime12(value?: string): string {
  if (!value) return "—";
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

/** e.g. "6:00 AM – 12:00 PM". */
export function formatTimeRange(timeIn?: string, timeOut?: string): string {
  return `${formatTime12(timeIn)} – ${formatTime12(timeOut)}`;
}

function timeToMinutes(value?: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec((value ?? "").trim());
  if (!match) return null;
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  return hour > 23 || minute > 59 ? null : hour * 60 + minute;
}

/** Sign of (a - b) for 24h "HH:MM" times; 0 when equal or either is unparseable. */
export function compareTime24(a?: string, b?: string): number {
  const [minutesA, minutesB] = [timeToMinutes(a), timeToMinutes(b)];
  return minutesA === null || minutesB === null ? 0 : minutesA - minutesB;
}
