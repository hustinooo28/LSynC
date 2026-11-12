import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import type { AttendanceRecord, Event, Student } from "@/types";
import { formatDate } from "@/lib/format";
import EmptyState from "@/components/ui/EmptyState";

// Brand-scale pair validated for CVD separation (ΔE ≈ 22) on light and dark surfaces.
const ATTENDED = "#4B5BFF";
const GAP = "#70B8FF";

interface Row {
  id: string;
  name: string;
  label: string;
  total: number;
  attended: number;
  gap: number;
  rate: number;
}

interface AttendanceAnalysisChartProps {
  events: Event[];
  students: Student[];
  records: AttendanceRecord[];
}

const Swatch = ({ color }: { color: string }) => <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;

/** Per-event comparison of registered students vs. unique students who attended (present or late). */
export default function AttendanceAnalysisChart({ events, students, records }: AttendanceAnalysisChartProps) {
  const rows = useMemo<Row[]>(() => {
    const registered = new Set(students.map((s) => s.id));
    const total = registered.size;
    return [...events]
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
      .map((event) => {
        const attended = new Set(
          records
            .filter((r) => r.eventId === event.id && r.status !== "absent" && registered.has(r.studentId))
            .map((r) => r.studentId),
        ).size;
        return {
          id: event.id,
          name: event.name,
          label: event.date ? `${event.name} — ${formatDate(event.date)}` : event.name,
          total,
          attended,
          gap: Math.max(0, total - attended),
          rate: total ? Math.round((attended / total) * 100) : 0,
        };
      });
  }, [events, students, records]);

  if (rows.length === 0) {
    return <EmptyState icon={BarChart3} title="No events yet" description="Create an event to see its attendance analysis." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted">
        <span className="inline-flex items-center gap-2 text-ink">
          <Swatch color={ATTENDED} /> Attended
        </span>
        <span className="inline-flex items-center gap-2 text-ink">
          <Swatch color={GAP} /> Attendance gap
        </span>
        <span>Bar height = total registered students</span>
      </div>

      <div className="h-72 w-full" role="img" aria-label="Stacked bar chart of attended students and attendance gap for each event">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 8 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
            <XAxis
              dataKey="name"
              tick={{ fill: "rgb(var(--muted))", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--line))" }}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={60}
            />
            <YAxis allowDecimals={false} tick={{ fill: "rgb(var(--muted))", fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgb(var(--muted) / 0.08)" }} content={<ChartTooltip />} />
            <Bar dataKey="attended" name="Attended" stackId="a" fill={ATTENDED} maxBarSize={48} />
            <Bar dataKey="gap" name="Attendance gap" stackId="a" fill={GAP} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line">
        <div data-lenis-prevent className="table-scroll">
          <table className="data-table min-w-[620px]">
            <thead>
              <tr>
                <th>Event</th>
                <th className="text-right">Registered</th>
                <th className="text-right">Attended</th>
                <th className="text-right">Gap</th>
                <th className="text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.label}</td>
                  <td className="text-right tabular-nums">{row.total}</td>
                  <td className="text-right font-semibold tabular-nums">{row.attended}</td>
                  <td className="text-right tabular-nums text-muted">{row.gap}</td>
                  <td className="text-right">
                    <span className={`chip ${row.rate >= 75 ? "chip-success" : row.rate >= 50 ? "chip-warning" : "chip-danger"}`}>{row.rate}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="card space-y-1.5 px-4 py-3 text-xs shadow-lift">
      <p className="font-semibold text-ink">{row.label}</p>
      {[
        [ATTENDED, "Attended", row.attended],
        [GAP, "Gap", row.gap],
      ].map(([color, label, value]) => (
        <p key={label} className="flex items-center gap-2 text-muted">
          <Swatch color={color as string} />
          {label} <b className="ml-auto pl-4 text-ink">{value}</b>
        </p>
      ))}
      <p className="text-muted">
        {row.rate}% of {row.total} registered
      </p>
    </div>
  );
}
