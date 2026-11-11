/**
 * A 12-hour time input (hour + minutes + AM/PM) that stores the value as
 * 24h "HH:MM" (e.g. "06:00" for 6:00 AM, "17:00" for 5:00 PM) so the
 * database column stays sortable and consistent with the rest of the app.
 */
export default function TimeInput12({
  value = "",
  onChange,
  disabled,
  ariaLabel,
}: {
  value?: string;
  onChange: (value24: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  const hour24 = match ? Number(match[1]) : NaN;
  const hour12 = Number.isNaN(hour24)
    ? 1
    : hour24 % 12 === 0
      ? 12
      : hour24 % 12;
  const minute = match ? match[2] : "00";
  const period: "AM" | "PM" = Number.isNaN(hour24) ? "AM" : hour24 >= 12 ? "PM" : "AM";

  const to24 = (h: number, m: string, p: "AM" | "PM") => {
    const hour = Math.min(12, Math.max(1, Math.round(h)));
    let h24: number;
    if (hour === 12) {
      h24 = p === "AM" ? 0 : 12;
    } else {
      h24 = p === "PM" ? hour + 12 : hour;
    }
    return `${String(h24).padStart(2, "0")}:${m}`;
  };

  const setHour = (raw: string) => {
    const h = parseInt(raw, 10);
    const clamped = Math.min(
      12,
      Math.max(1, Number.isFinite(h) ? Math.round(h) : 12),
    );
    onChange(to24(clamped, minute, period));
  };

  const setMinute = (raw: string) => {
    const m = parseInt(raw, 10);
    const mm = String(
      Math.min(59, Math.max(0, Number.isFinite(m) ? Math.round(m) : 0)),
    ).padStart(2, "0");
    onChange(to24(hour12, mm, period));
  };

  const setPeriod = (p: "AM" | "PM") => {
    onChange(to24(hour12, minute, p));
  };

  return (
    <div className="flex items-center gap-1" aria-label={ariaLabel}>
      <input
        type="number"
        min={1}
        max={12}
        inputMode="numeric"
        placeholder="6"
        value={Number.isFinite(hour24) ? hour12 : ""}
        onChange={(e) => setHour(e.target.value)}
        disabled={disabled}
        className="glass-input w-11 px-1 py-1.5 text-sm text-center"
        title="Hour (1-12)"
      />
      <span className="text-text-secondary text-xs">:</span>
      <input
        type="number"
        min={0}
        max={59}
        inputMode="numeric"
        placeholder="00"
        value={Number.isFinite(hour24) ? minute : ""}
        onChange={(e) => setMinute(e.target.value)}
        disabled={disabled}
        className="glass-input w-11 px-1 py-1.5 text-sm text-center"
        title="Minutes (00-59)"
      />
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value as "AM" | "PM")}
        disabled={disabled}
        className="glass-input px-1 py-1.5 text-sm w-14"
        title="AM or PM"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
