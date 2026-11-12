import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Calendar, CheckCircle, ChevronDown, Clock, Download, Eye, FileText, FolderOpen, PieChart, QrCode, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { AttendanceRecord, ContributionRecord, PaymentRecord, Student, StudentRequirementFile } from "@/types";
import { attendanceService, contributionsService, eventsService, paymentsService, studentRequirementFilesService } from "@/services/db";
import { createContributionReceiptPreview, downloadContributionReceipt, officialReceiptNumber, type ReceiptFormat } from "@/lib/receipts";
import { formatDate, formatPeso, formatTimeRange, getOrdinalSuffix, today } from "@/lib/format";
import { calculateContributionTotals, contributionStatus } from "@/lib/contributions";
import { usePagination } from "@/hooks/usePagination";
import ReceiptViewer from "@/components/ReceiptViewer";
import StudentQrModal from "@/components/StudentQrModal";
import { DownloadLink, FilePreviewModal, FileSize } from "@/components/FilePreview";
import Page from "@/components/ui/Page";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import Skeleton, { LoadingCard } from "@/components/ui/Skeleton";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/Menu";

interface StudentRecordSectionProps {
  student: Student;
  onBack: () => void;
}

const PAGE_SIZE = 5;
const RECEIPT_FORMATS: ReceiptFormat[] = ["svg", "png", "jpg"];

const ATTENDANCE_STATUS = {
  present: { label: "Present", chip: "chip-success", icon: CheckCircle },
  late: { label: "Late", chip: "chip-warning", icon: Clock },
  absent: { label: "Absent", chip: "chip-danger", icon: XCircle },
} satisfies Record<AttendanceRecord["status"], { label: string; chip: string; icon: LucideIcon }>;

const CONTRIBUTION_CHIP: Record<string, string> = {
  Unpaid: "chip-danger",
  "Partial Payment": "chip-warning",
  "Fully Paid": "chip-success",
};

function Panel({ id, icon: Icon, title, children }: { id?: string; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section id={id} className="card overflow-hidden">
      <div className="flex items-center gap-3 p-5">
        <div className="icon-tile">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function StudentRecordSection({ student, onBack }: StudentRecordSectionProps) {
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [contributions, setContributions] = useState<ContributionRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [files, setFiles] = useState<StudentRequirementFile[]>([]);

  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [previewFile, setPreviewFile] = useState<StudentRequirementFile | null>(null);
  /** `${action}:${recordId}` of the receipt action in progress. */
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [attendanceData, contributionData, events, paymentData, fileData] = await Promise.all([
          attendanceService.getByStudentId(student.id),
          contributionsService.getByStudentId(student.id),
          eventsService.getAll(),
          paymentsService.getByStudentId(student.id),
          studentRequirementFilesService.getVisibleForStudent(student.id),
        ]);
        if (cancelled) return;
        // Show every catalog event (unpaid placeholder when no row exists yet),
        // plus persisted rows whose event was since removed from the catalog.
        const byEvent = new Map(contributionData.map((r) => [r.eventId, r]));
        const eventIds = new Set(events.map((e) => e.id));
        setContributions([
          ...events.map((event): ContributionRecord => {
            const record = byEvent.get(event.id);
            return record
              ? { ...record, eventName: event.name }
              : {
                  id: `unpaid-${student.id}-${event.id}`,
                  studentId: student.id,
                  eventId: event.id,
                  eventName: event.name,
                  requiredAmount: event.allocationAmount,
                  amountPaid: 0,
                  remainingBalance: event.allocationAmount,
                };
          }),
          ...contributionData.filter((r) => !eventIds.has(r.eventId)),
        ]);
        setAttendance(attendanceData);
        setPayments(paymentData);
        setFiles(fileData);
      } catch (error) {
        console.error("Error loading student data:", error);
        toast.error("Failed to load student records");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [student.id]);

  const attendancePage = usePagination(attendance, PAGE_SIZE);
  const contributionPage = usePagination(contributions, PAGE_SIZE);
  const { totalPaid, totalRequired, totalBalance } = calculateContributionTotals(contributions);
  const counts = { present: 0, late: 0, absent: 0 };
  attendance.forEach((r) => counts[r.status]++);
  const attendanceRate = attendance.length ? Math.round(((counts.present + counts.late) / attendance.length) * 100) : 0;

  const receiptDetails = async (record: ContributionRecord) => ({
    tag: "CONTRIBUTION RECORD" as const,
    receiptNumber: await officialReceiptNumber(),
    issuedTo: student.name,
    eventName: record.eventName,
    amount: record.amountPaid,
    type: "income" as const,
    date: today(),
    recordedBy: "Council Officer",
    requiredAmount: record.requiredAmount,
    remainingBalance: record.remainingBalance,
    statusLabel: contributionStatus(record).label,
  });

  const runReceiptAction = async (action: "preview" | "download", record: ContributionRecord, task: () => Promise<void>) => {
    const key = `${action}:${record.id}`;
    setBusy(key);
    try {
      await task();
    } catch (error) {
      console.error(`Error (${action}) contribution receipt:`, error);
      toast.error(`Failed to ${action} receipt. Please try again.`);
    } finally {
      setBusy((current) => (current === key ? null : current));
    }
  };

  // Prefer a receipt stored with an actual payment; otherwise generate one.
  const previewReceipt = (record: ContributionRecord) => {
    const stored = payments.find((p) => p.eventId === record.eventId && p.receiptUrl)?.receiptUrl;
    if (stored) return setReceiptUrl(stored);
    void runReceiptAction("preview", record, async () => setReceiptUrl(await createContributionReceiptPreview(await receiptDetails(record))));
  };

  const downloadReceipt = (record: ContributionRecord, format: ReceiptFormat) =>
    runReceiptAction("download", record, async () => {
      toast.success(await downloadContributionReceipt(await receiptDetails(record), format));
    });

  const details = [student.studentId, student.program, `${student.yearLevel}${getOrdinalSuffix(student.yearLevel)} Year · Section ${student.section}`];

  return (
    <Page
      eyebrow="Student record"
      title="Your council record"
      subtitle="Attendance, contributions, receipts and shared files — all in one place."
      onBack={onBack}
      hero={
        <div className="glass flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white/15 text-2xl font-extrabold">
            {student.name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold sm:text-2xl">{student.name}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {details.map((d) => (
                <span key={d} className="chip bg-white/10 font-medium text-white/85">
                  {d}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowQr(true)}
            className="btn btn-light self-start sm:self-center"
            title="Download your attendance QR code (Student ID, Name, Program, Year, Section)"
          >
            <QrCode className="h-4 w-4" /> My QR code
          </button>
        </div>
      }
    >
      {loading ? (
        <LoadingCard rows={6} label="Loading student records…" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard featured icon={Wallet} label="Total paid" value={formatPeso(totalPaid)} hint={`of ${formatPeso(totalRequired)} required`} />
            <StatCard
              icon={PieChart}
              tone={totalBalance > 0 ? "danger" : "success"}
              label="Remaining balance"
              value={formatPeso(totalBalance)}
              hint={totalBalance > 0 ? "Outstanding contributions" : "All settled"}
            />
            <StatCard
              icon={Calendar}
              tone="success"
              label="Attendance rate"
              value={`${attendanceRate}%`}
              hint={`${counts.present} present · ${counts.late} late · ${counts.absent} absent`}
            />
            <StatCard icon={FolderOpen} label="Shared files" value={files.length} hint="Available to download" />
          </div>

          <Panel icon={Wallet} title="Contributions">
            {contributions.length === 0 ? (
              <EmptyState icon={Wallet} title="No contribution records found" />
            ) : (
              <>
                <div data-lenis-prevent className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Paid</th>
                        <th>Balance</th>
                        <th>Status</th>
                        <th className="text-right">Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contributionPage.pageItems.map((record) => {
                        const status = contributionStatus(record);
                        return (
                          <tr key={record.id}>
                            <td className="font-medium">{record.eventName}</td>
                            <td className="whitespace-nowrap">
                              <span className="font-semibold">{formatPeso(record.amountPaid)}</span>
                              <span className="block text-xs text-muted">of {formatPeso(record.requiredAmount)}</span>
                            </td>
                            <td className="whitespace-nowrap text-muted">{formatPeso(record.remainingBalance)}</td>
                            <td>
                              <span className={`chip ${CONTRIBUTION_CHIP[status.label] ?? "chip-neutral"}`}>{status.label}</span>
                            </td>
                            <td>
                              {/* Receipts exist only once something has actually been paid. */}
                              {record.amountPaid > 0 && (
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => previewReceipt(record)}
                                    disabled={busy === `preview:${record.id}`}
                                    className="btn btn-ghost btn-sm"
                                    title={`Preview contribution receipt – ${record.eventName}`}
                                  >
                                    {busy === `preview:${record.id}` ? <Skeleton className="h-3.5 w-3.5 rounded-full" /> : <Eye className="h-3.5 w-3.5" />}
                                    Preview
                                  </button>
                                  <Menu>
                                    <MenuTrigger asChild disabled={busy === `download:${record.id}`}>
                                      <button className="btn btn-secondary btn-sm" title={`Download contribution receipt – ${record.eventName}`}>
                                        {busy === `download:${record.id}` ? (
                                          <Skeleton className="h-3.5 w-3.5 rounded-full" />
                                        ) : (
                                          <Download className="h-3.5 w-3.5" />
                                        )}
                                        Download <ChevronDown className="h-3 w-3" />
                                      </button>
                                    </MenuTrigger>
                                    <MenuContent>
                                      {RECEIPT_FORMATS.map((format) => (
                                        <MenuItem key={format} onSelect={() => downloadReceipt(record, format)}>
                                          {format.toUpperCase()}
                                        </MenuItem>
                                      ))}
                                    </MenuContent>
                                  </Menu>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination {...contributionPage.pagination} />
              </>
            )}
          </Panel>

          <Panel icon={Calendar} title="Attendance history">
            {attendance.length === 0 ? (
              <EmptyState icon={Calendar} title="No attendance records found" />
            ) : (
              <>
                <div data-lenis-prevent className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendancePage.pageItems.map((record) => {
                        const { label, chip, icon: Icon } = ATTENDANCE_STATUS[record.status];
                        return (
                          <tr key={record.id}>
                            <td className="font-medium">{record.eventName}</td>
                            <td className="whitespace-nowrap text-muted">{formatDate(record.date)}</td>
                            <td>
                              <span className={`chip ${chip}`}>
                                <Icon className="h-3.5 w-3.5" /> {label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap text-muted">
                              {record.status !== "absent" && (record.timeIn || record.timeOut) ? formatTimeRange(record.timeIn, record.timeOut) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination {...attendancePage.pagination} />
              </>
            )}
          </Panel>

          <Panel id="requirement-files" icon={FolderOpen} title="Shared files">
            {files.length === 0 ? (
              <EmptyState icon={FolderOpen} title="No files shared yet" description="Requirement files published by the council will appear here." />
            ) : (
              <div className="grid grid-cols-1 gap-4 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
                {files.map((file) => (
                  <div key={file.id} className="card-hover flex flex-col rounded-2xl border border-line bg-surface-2 p-4">
                    <div className="flex items-start gap-3">
                      <div className="icon-tile h-10 w-10">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug text-ink">{file.title}</p>
                        {file.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{file.description}</p>}
                      </div>
                    </div>
                    <p className="mt-3 flex gap-2 text-xs text-muted">
                      <span className="truncate">{file.fileName}</span>
                      <span className="shrink-0">
                        · <FileSize bytes={file.fileSize} />
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">Published {formatDate(file.updatedAt)}</p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      {file.fileUrl ? (
                        <>
                          <button onClick={() => setPreviewFile(file)} className="btn btn-secondary btn-sm" title={`Preview ${file.title}`}>
                            <Eye className="h-4 w-4" /> Preview
                          </button>
                          <DownloadLink file={file} className="btn btn-primary btn-sm" />
                        </>
                      ) : (
                        <span className="chip chip-neutral">
                          <Clock className="h-3.5 w-3.5" /> Still syncing, check back soon
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      <ReceiptViewer receiptUrl={receiptUrl} onClose={() => setReceiptUrl(null)} title="Contribution Receipt" />
      <StudentQrModal student={showQr ? student : null} onClose={() => setShowQr(false)} />
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </Page>
  );
}
