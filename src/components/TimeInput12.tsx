type Period = "AM" | "PM";

const clamp = (raw: string, min: number, max: number, fallback: number) => {
  const n = parseInt(raw, 10);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
};

/**
 * 12-hour time input (hour, minutes, AM/PM) that stores 24h "HH:MM"
 * (e.g. "06:00", "17:00") so the database column stays sortable.
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
  const hour24 = match ? Number(match[1]) : null;
  const hour12 = hour24 === null || hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = match?.[2] ?? "00";
  const period: Period = hour24 !== null && hour24 >= 12 ? "PM" : "AM";

  const emit = (h: number, m: string, p: Period) =>
    onChange(`${String((h % 12) + (p === "PM" ? 12 : 0)).padStart(2, "0")}:${m}`);

  const box = "input h-9 px-1 text-center";

  return (
    <div className="flex items-center gap-1" role="group" aria-label={ariaLabel}>
      <input
        type="number"
        min={1}
        max={12}
        inputMode="numeric"
        placeholder="6"
        title="Hour (1-12)"
        value={match ? hour12 : ""}
        onChange={(e) => emit(clamp(e.target.value, 1, 12, 12), minute, period)}
        disabled={disabled}
        className={`${box} w-12`}
      />
      <span className="text-xs text-muted">:</span>
      <input
        type="number"
        min={0}
        max={59}
        inputMode="numeric"
        placeholder="00"
        title="Minutes (00-59)"
        value={match ? minute : ""}
        onChange={(e) => emit(hour12, String(clamp(e.target.value, 0, 59, 0)).padStart(2, "0"), period)}
        disabled={disabled}
        className={`${box} w-12`}
      />
      <select
        value={period}
        title="AM or PM"
        onChange={(e) => emit(hour12, minute, e.target.value as Period)}
        disabled={disabled}
        className={`${box} w-16`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
