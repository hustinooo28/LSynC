import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import SectionEmptyState from "@/components/SectionEmptyState";
import { Calendar } from "lucide-react";

export interface AttendanceAnalysisRow {
  eventId: string;
  eventName: string;
  eventLabel: string;
  totalPopulation: number;
  actualPopulationAttended: number;
  attendanceGap: number;
}

interface AttendanceAnalysisChartProps {
  data: AttendanceAnalysisRow[];
}

/**
 * K-Means attendance comparison line chart + data table.
 * Extracted from the ~120-line JSX block at the bottom of the Attendance tab
 * in EventManagementSection.
 */
export default function AttendanceAnalysisChart({
  data,
}: AttendanceAnalysisChartProps) {
  if (data.length === 0) {
    return (
      <SectionEmptyState
        message="Create an event to view attendance analysis"
        icon={Calendar}
        compact
      />
    );
  }

  return (
    <div className="glass-card-strong p-4 lg:p-5">
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium">
        <span className="inline-flex items-center gap-2 text-dark">
          <span className="h-2.5 w-2.5 rounded-full bg-royal-blue" />
          Total Population
        </span>
        <span className="inline-flex items-center gap-2 text-dark">
          <span className="h-2.5 w-2.5 rounded-full bg-status-success" />
          Actual Population Attended
        </span>
        <span className="text-text-secondary">
          Attendance Gap = Total Population − Actual Population Attended
        </span>
      </div>

      <div
        className="h-80 w-full"
        role="img"
        aria-label="Line chart comparing total population and actual population attended for each event"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 12, right: 24, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#B8C1D9" />
            <XAxis
              dataKey="eventName"
              tick={{ fill: "#4A5580", fontSize: 12 }}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={60}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "#4A5580", fontSize: 12 }}
            />
            <Tooltip
              labelFormatter={(_, payload) =>
                payload[0]?.payload.eventLabel ?? "Event"
              }
              formatter={(value: number, name: string) => [value, name]}
              contentStyle={{
                borderRadius: "0.75rem",
                borderColor: "#B8C1D9",
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="totalPopulation"
              name="Total Population"
              stroke="#1B2E8C"
              strokeWidth={3}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="actualPopulationAttended"
              name="Actual Population Attended"
              stroke="#2E9E5B"
              strokeWidth={3}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div className="rounded-xl overflow-hidden border border-gray-200">
          <table className="glass-table min-w-[680px]">
            <thead>
              <tr>
                <th>Event</th>
                <th className="text-right">Total Population</th>
                <th className="text-right">Actual Population Attended</th>
                <th className="text-right">Attendance Gap</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.eventId}>
                  <td className="font-medium text-dark">{row.eventLabel}</td>
                  <td className="text-right text-royal-blue font-medium">
                    {row.totalPopulation}
                  </td>
                  <td className="text-right text-status-success font-medium">
                    {row.actualPopulationAttended}
                  </td>
                  <td className="text-right text-status-danger font-medium">
                    {row.attendanceGap}
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
