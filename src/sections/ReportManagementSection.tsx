import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CheckCircle, Clock, Download, Filter, Users, XCircle } from "lucide-react";
import type { AttendanceRecord, Event, Student } from "@/types";
import { attendanceService, eventsService, studentsService } from "@/services/db";
import { compareTime24, formatTime12, getOrdinalSuffix } from "@/lib/format";
import { downloadBlob } from "@/lib/receipts";
import Page from "@/components/ui/Page";
import Field from "@/components/ui/Field";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import { LoadingCard } from "@/components/ui/Skeleton";

type Status = "Present" | "Late" | "Absent";

interface ReportRow {
  studentName: string;
  yearLevel: number;
  course: string;
  section: string;
  status: Status;
  eventName: string;
  timeIn: string;
  timeOut: string;
}

// Brand-blue ramp (dark → light) so the three slices stay distinct in both themes.
const STATUS_COLOR: Record<Status, string> = { Present: "#007BFF", Late: "#70B8FF", Absent: "#B0E0E6" };
const STATUS_CHIP: Record<Status, string> = { Present: "chip-success", Late: "chip-warning", Absent: "chip-danger" };
const STATUS_RANK = { present: 2, late: 1, absent: 0 };

const ord = (n: number) => `${n}${getOrdinalSuffix(n)}`;
const uniqueSorted = <T,>(values: T[]) => [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export default function ReportManagementSection({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [eventId, setEventId] = useState("");
  const [year, setYear] = useState("");
  const [course, setCourse] = useState("");
  const [section, setSection] = useState("");

  useEffect(() => {
    Promise.all([eventsService.getAll(), studentsService.getAll(), attendanceService.getAll()])
      .then(([e, s, a]) => {
        setEvents(e);
        setStudents(s);
        setRecords(a);
      })
      .catch((error) => {
        console.error("Error loading report data:", error);
        toast.error("Failed to load data for reports");
      })
      .finally(() => setLoading(false));
  }, []);

  // Cascading options: course depends on year, section on year + course.
  const inYear = students.filter((s) => s.yearLevel === Number(year));
  const yearOptions = uniqueSorted(students.map((s) => s.yearLevel));
  const courseOptions = uniqueSorted(inYear.map((s) => s.program));
  const sectionOptions = uniqueSorted(inYear.filter((s) => s.program === course).map((s) => s.section));

  const event = events.find((e) => e.id === eventId) ?? null;
  const complete = !!event && !!year && !!course && !!section;

  const rows = useMemo<ReportRow[]>(() => {
    if (!complete || !event) return [];
    // Best record per student: present > late > absent, then one that has a time-in.
    const best = new Map<string, AttendanceRecord>();
    for (const r of records) {
      if (r.eventId !== event.id) continue;
      const cur = best.get(r.studentId);
      const diff = cur ? STATUS_RANK[r.status] - STATUS_RANK[cur.status] : 1;
      if (diff > 0 || (diff === 0 && r.timeIn && !cur?.timeIn)) best.set(r.studentId, r);
    }

    return students
      .filter((s) => s.yearLevel === Number(year) && s.program === course && s.section === section)
      .map((s): ReportRow => {
        const r = best.get(s.id);
        const base = { studentName: s.name, yearLevel: s.yearLevel, course: s.program, section: s.section, eventName: event.name };
        if (!r || r.status === "absent") return { ...base, status: "Absent", timeIn: "—", timeOut: "—" };
        // Re-derive lateness from the session's configured start; older events
        // without one fall back to the stored status.
        const start = event.schedules?.find((sch) => sch.period === r.session)?.timeIn;
        const late = r.timeIn && start ? compareTime24(r.timeIn, start) > 0 : r.status === "late";
        return {
          ...base,
          status: late ? "Late" : "Present",
          timeIn: r.timeIn ? formatTime12(r.timeIn) : "—",
          timeOut: r.timeOut ? formatTime12(r.timeOut) : "—",
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [complete, event, records, students, year, course, section]);

  const counts = { Present: 0, Late: 0, Absent: 0 };
  rows.forEach((r) => counts[r.status]++);
  const total = rows.length;
  const percent = total > 0 ? (((counts.Present + counts.Late) / total) * 100).toFixed(1) : "0.0";
  const share = (n: number) => (total ? `${Math.round((n / total) * 100)}% of class` : undefined);

  const download = async () => {
    if (!event) return;
    setGenerating(true);
    try {
      const [lscDataUri, dsscDataUri] = await Promise.all(["/lsc-logo.jpg", "/DSSC-logo.png"].map(imageDataUri));
      const html = buildReportHtml({
        lscDataUri,
        dsscDataUri,
        eventName: esc(event.name),
        yearLabel: `${ord(Number(year))} Year`,
        course: esc(course),
        section: esc(section),
        total,
        counts,
        percent,
        rows,
      });
      const safeName = event.name.replace(/\s+/g, "-").toLowerCase();
      downloadBlob(
        new Blob([html], { type: "text/html;charset=utf-8" }),
        `attendance-report-${safeName}-${year}yr-${course}-${section}.html`,
      );
      toast.success("Report downloaded. Open it in a browser and use Print → Save as PDF to export.");
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  const filters = [
    { label: "Event", value: eventId, set: setEventId, placeholder: "Select event", options: events.map((e) => [e.id, e.name]) },
    {
      label: "Year",
      value: year,
      set: (v: string) => {
        setYear(v);
        setCourse("");
        setSection("");
      },
      placeholder: "Select year",
      options: yearOptions.map((y) => [String(y), `${ord(y)} Year`]),
    },
    {
      label: "Course",
      value: course,
      set: (v: string) => {
        setCourse(v);
        setSection("");
      },
      placeholder: year ? "Select course" : "Select year first",
      options: courseOptions.map((c) => [c, c]),
      disabled: !year,
    },
    {
      label: "Section",
      value: section,
      set: setSection,
      placeholder: course ? "Select section" : "Select course first",
      options: sectionOptions.map((s) => [s, s]),
      disabled: !course,
    },
  ];

  return (
    <Page
      eyebrow="Reports"
      title="Attendance Reports"
      subtitle="Generate official attendance reports per event and class, ready to print."
      onBack={onBack}
      actions={
        complete &&
        total > 0 && (
          <button onClick={download} disabled={generating} className="btn btn-primary">
            <Download className="h-4 w-4" />
            {generating ? "Generating…" : "Download printable report"}
          </button>
        )
      }
    >
      {loading ? (
        <LoadingCard label="Loading report data…" />
      ) : (
        <>
          <div className="card p-5 lg:p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="icon-tile"><Filter className="h-5 w-5" /></span>
              <div>
                <h2 className="font-bold text-ink">Report filters</h2>
                <p className="text-xs text-muted">Pick an event and a class to build the report.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {filters.map((f) => (
                <Field key={f.label} label={f.label}>
                  <select className="input" value={f.value} onChange={(e) => f.set(e.target.value)} disabled={f.disabled}>
                    <option value="">{f.placeholder}</option>
                    {f.options.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>

          {!complete ? (
            <div className="card">
              <EmptyState icon={Filter} title="Choose your filters" description="Select an event, year, course and section above to generate an attendance report." />
            </div>
          ) : total === 0 ? (
            <div className="card">
              <EmptyState icon={Users} title="No students found" description="No students match the selected year, course and section." />
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="card flex items-center gap-5 p-5">
                  <div className="relative h-36 w-36 shrink-0">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={(Object.keys(counts) as Status[]).map((s) => ({ name: s, value: counts[s] }))}
                          dataKey="value"
                          innerRadius="70%"
                          outerRadius="100%"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {(Object.keys(counts) as Status[]).map((s) => <Cell key={s} fill={STATUS_COLOR[s]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                      <div>
                        <p className="text-xl font-extrabold text-ink">{percent}%</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Attended</p>
                      </div>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm">
                    {(Object.keys(counts) as Status[]).map((s) => (
                      <li key={s} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                        <span className="text-muted">{s}</span>
                        <b className="text-ink">{counts[s]}</b>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
                  <StatCard featured label="Total students" value={total} icon={Users} hint={`${event?.name} · ${ord(Number(year))} Year ${course}-${section}`} />
                  <StatCard label="Present" value={counts.Present} icon={CheckCircle} tone="success" hint={share(counts.Present)} />
                  <StatCard label="Late" value={counts.Late} icon={Clock} tone="warning" hint={share(counts.Late)} />
                  <StatCard label="Absent" value={counts.Absent} icon={XCircle} tone="danger" hint={share(counts.Absent)} />
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="px-5 py-4">
                  <h2 className="font-bold text-ink">Attendance records</h2>
                  <p className="text-xs text-muted">
                    {event?.name} — {ord(Number(year))} Year · {course} · Section {section}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Year</th>
                        <th>Course</th>
                        <th>Section</th>
                        <th>Status</th>
                        <th>Time in</th>
                        <th>Time out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="font-semibold">{r.studentName}</td>
                          <td className="text-muted">{ord(r.yearLevel)}</td>
                          <td className="text-muted">{r.course}</td>
                          <td className="text-muted">{r.section}</td>
                          <td><span className={`chip ${STATUS_CHIP[r.status]}`}>{r.status}</span></td>
                          <td className="whitespace-nowrap text-muted">{r.timeIn}</td>
                          <td className="whitespace-nowrap text-muted">{r.timeOut}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Page>
  );
}

const esc = (v: string) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fetches an image and inlines it so the downloaded report is self-contained. */
async function imageDataUri(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

interface PrintableReport {
  lscDataUri: string;
  dsscDataUri: string;
  eventName: string;
  yearLabel: string;
  course: string;
  section: string;
  total: number;
  counts: Record<Status, number>;
  percent: string;
  rows: ReportRow[];
}

/** Self-contained landscape document for browser Print → Save as PDF. */
function buildReportHtml(r: PrintableReport): string {
  const tableRows = r.rows
    .map(
      (row, i) => `<tr class="${i % 2 ? "odd" : "even"}"><td>${esc(row.studentName)}</td><td class="center">${ord(row.yearLevel)}</td><td class="center">${esc(row.course)}</td><td class="center">${esc(row.section)}</td><td class="center"><span class="s-${row.status.toLowerCase()}">${row.status}</span></td><td>${esc(row.eventName)}</td><td class="center">${row.timeIn}</td><td class="center">${row.timeOut}</td></tr>`,
    )
    .join("");
  const card = (value: string | number, caption: string, cls = "") =>
    `<div class="card"><div class="number ${cls}">${value}</div><div class="caption">${caption}</div></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Student Attendance Report</title>
<style>
  @page{size:landscape;margin:12mm 10mm}
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;padding:20px 28px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .header{display:flex;align-items:center;justify-content:center;gap:20px;border-bottom:3px solid #1b2e8c;padding-bottom:12px}
  .header img{width:70px;height:70px;object-fit:contain}.title{text-align:center}.org{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1.8px}.title h1{font-size:22px;color:#1b2e8c;margin:3px 0;font-weight:800}.sub{font-size:11px;color:#6b7280}
  .metadata{display:grid;grid-template-columns:1fr 1fr;gap:7px 30px;margin:16px 0;font-size:13px}.label{font-weight:700;color:#374151;display:inline-block;min-width:105px}
  .summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:14px 0 18px}.card{border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:9px;text-align:center}.number{font-weight:800;font-size:21px}.caption{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.8px;margin-top:2px}.present{color:#047857}.late{color:#b45309}.absent{color:#b91c1c}.percent{color:#1b2e8c}
  table{width:100%;border-collapse:collapse;font-size:12px}thead tr{background:#1b2e8c;color:#fff}th{padding:8px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}td{padding:7px 9px;border-bottom:1px solid #e5e7eb}.center{text-align:center}.odd{background:#f9fafb}.even{background:#fff}
  .s-present,.s-late,.s-absent{padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700}.s-present{background:#d1fae5;color:#047857}.s-late{background:#fef3c7;color:#b45309}.s-absent{background:#fee2e2;color:#b91c1c}
  footer{display:flex;justify-content:space-between;margin-top:18px;padding-top:9px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:10px}@media print{body{padding:0}}
</style></head><body>
  <header class="header"><img src="${r.lscDataUri}" alt="LSC logo"/><div class="title"><div class="org">Local Student Council · DSSC Santa Cruz</div><h1>Student Attendance Report</h1><div class="sub">Official Attendance Record for Verification and Filing</div></div><img src="${r.dsscDataUri}" alt="DSSC logo"/></header>
  <section class="metadata"><div><span class="label">Event:</span>${r.eventName}</div><div><span class="label">Year Level:</span>${r.yearLabel}</div><div><span class="label">Course:</span>${r.course}</div><div><span class="label">Section:</span>${r.section}</div></section>
  <section class="summary">${card(r.total, "Total Students")}${card(r.counts.Present, "Total Present", "present")}${card(r.counts.Late, "Total Late", "late")}${card(r.counts.Absent, "Total Absent", "absent")}${card(`${r.percent}%`, "Attendance", "percent")}</section>
  <table><thead><tr><th>Student</th><th class="center">Year</th><th class="center">Course</th><th class="center">Section</th><th class="center">Status</th><th>Event</th><th class="center">Time In</th><th class="center">Time Out</th></tr></thead><tbody>${tableRows}</tbody></table>
  <footer><span>Generated ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}</span><span>Digital Transparency Board — LSC · DSSC Santa Cruz</span></footer>
</body></html>`;
}
