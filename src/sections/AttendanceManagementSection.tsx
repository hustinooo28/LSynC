import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Camera,
  CameraOff,
  CircleAlert,
  CircleCheck,
  Clock,
  LogIn,
  LogOut,
  Moon,
  QrCode,
  ScanLine,
  Sun,
  Sunrise,
  SwitchCamera,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { attendanceService, eventsService, studentsService, subscribeToTables } from "@/services/db";
import type { AttendanceRecord, Event, EventSession, Student, UserRole } from "@/types";
import { parseStudentQrText } from "@/lib/qr";
import { compareTime24, formatTime12 } from "@/lib/format";
import { cn, matchesSearchWords } from "@/lib/utils";
import { usePagination } from "@/hooks/usePagination";
import Page from "@/components/ui/Page";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import SearchInput from "@/components/ui/SearchInput";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Skeleton, { LoadingCard } from "@/components/ui/Skeleton";
import { Menu, MenuContent, MenuItem, MenuSeparator, RowActionsTrigger } from "@/components/ui/Menu";
import TimeInput12 from "@/components/TimeInput12";

// Recharts is only needed for the analysis card — keep it out of this chunk.
const AttendanceAnalysisChart = lazy(() => import("@/components/AttendanceAnalysisChart"));

interface AttendanceManagementSectionProps {
  onBack: () => void;
  role: UserRole;
  userId?: string;
}

type Status = AttendanceRecord["status"];
type ScanMode = "timeIn" | "timeOut";
type TimePatch = Partial<Pick<AttendanceRecord, "status" | "timeIn" | "timeOut">>;

const SESSIONS: { value: EventSession; label: string; icon: LucideIcon }[] = [
  { value: "morning", label: "Morning", icon: Sunrise },
  { value: "afternoon", label: "Afternoon", icon: Sun },
  { value: "evening", label: "Evening", icon: Moon },
];
const STATUS: Record<Status, { label: string; chip: string }> = {
  present: { label: "Present", chip: "chip-success" },
  late: { label: "Late", chip: "chip-warning" },
  absent: { label: "Absent", chip: "chip-danger" },
};
const MODE_LABEL: Record<ScanMode, string> = { timeIn: "Time In", timeOut: "Time Out" };
const REAR_CAMERA = /back|rear|environment|world|外向|后置/i;
const PAGE_SIZE = 20;

const nowClock = () => new Date().toTimeString().slice(0, 5);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const localDate = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
const scheduleFor = (event: Event, session: EventSession) => event.schedules?.find((s) => s.period === session);

/** Late when recorded after the session's scheduled Time In. */
function deriveStatus(time: string, event: Event, session: EventSession): "present" | "late" {
  const timeIn = scheduleFor(event, session)?.timeIn;
  return timeIn && compareTime24(time, timeIn) > 0 ? "late" : "present";
}

function scheduleSummary(event: Event, session: EventSession): { text: string; chip: string } {
  const schedule = scheduleFor(event, session);
  if (!schedule) return { text: "No schedule set for this session", chip: "chip-warning" };
  const { timeIn, timeOut } = schedule;
  if (!timeIn && !timeOut) return { text: "Schedule times not configured", chip: "chip-warning" };
  return {
    text: `${timeIn ? formatTime12(timeIn) : "Time In not set"} – ${timeOut ? formatTime12(timeOut) : "Time Out not set"}`,
    chip: timeIn && timeOut ? "chip-success" : "chip-brand",
  };
}

/** Keeps the previous array when a realtime refresh returns identical data, so pagination isn't reset. */
const keepIfEqual = <T,>(prev: T, next: T) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next);

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; icon?: LucideIcon }[];
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-full overflow-x-auto", className)}>
      <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-full border border-line bg-surface-2 p-1">
        {options.map(({ value: v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={v === value}
            onClick={() => onChange(v)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition",
              v === value ? "bg-brand-500 text-white shadow-glow" : "text-muted hover:bg-surface hover:text-ink",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const StatusChip = ({ status }: { status?: Status }) =>
  status ? <span className={cn("chip", STATUS[status].chip)}>{STATUS[status].label}</span> : <span className="chip chip-neutral">Not recorded</span>;

export default function AttendanceManagementSection({ onBack }: AttendanceManagementSectionProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [eventId, setEventId] = useState("");
  const [session, setSession] = useState<EventSession>("morning");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [scanFilter, setScanFilter] = useState<{ program: string; section: string } | null>(null);
  const [lastScan, setLastScan] = useState<{ studentId: string; time: string } | null>(null);
  const [clearTarget, setClearTarget] = useState<{ id: string; name: string } | null>(null);
  const [clearing, setClearing] = useState(false);

  // QR scanner
  const [scanMode, setScanMode] = useState<ScanMode>("timeIn");
  const [scannerActive, setScannerActive] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{ ok: boolean; text: string; id: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastScanRef = useRef({ data: "", at: 0 });
  const autoPickedRef = useRef(false);
  const autoMarkingRef = useRef(false);

  const event = events.find((e) => e.id === eventId);
  const scanning = scannerActive && !!event;

  const loadData = useCallback(async () => {
    try {
      const [e, s, a] = await Promise.all([eventsService.getAll(), studentsService.getAll(), attendanceService.getAll()]);
      setEvents((prev) => keepIfEqual(prev, e));
      setStudents((prev) => keepIfEqual(prev, s));
      setRecords(a);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    return subscribeToTables(["events", "students", "attendance"], loadData, "attendance-management");
  }, [loadData]);

  const recordByStudent = useMemo(
    () => new Map(records.filter((r) => r.eventId === eventId && r.session === session).map((r) => [r.studentId, r])),
    [records, eventId, session],
  );

  const counts = useMemo(() => {
    const c: Record<Status, number> = { present: 0, late: 0, absent: 0 };
    recordByStudent.forEach((r) => c[r.status]++);
    return c;
  }, [recordByStudent]);

  // ── Persistence ───────────────────────────────────────────
  const attempt = async (failure: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      console.error(failure, error);
      toast.error(`${failure} — ${errorMessage(error)}`);
    }
  };

  /** Creates or updates this student's record for the selected event + session. */
  const persist = async (studentId: string, patch: TimePatch) => {
    if (!event) {
      toast.error("Select an event before recording attendance");
      return null;
    }
    const existing = recordByStudent.get(studentId);
    const payload = {
      studentId,
      eventId: event.id,
      eventName: event.name,
      date: event.date ?? new Date().toISOString().slice(0, 10),
      session,
      status: patch.status ?? existing?.status ?? "present",
      timeIn: patch.timeIn ?? existing?.timeIn,
      timeOut: patch.timeOut ?? existing?.timeOut,
    };
    const saved = existing ? await attendanceService.update(existing.id, payload) : await attendanceService.create(payload);
    setRecords((prev) => (prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved]));
    return saved;
  };

  const markStatus = (studentId: string, status: "present" | "absent") =>
    attempt("Failed to save attendance", async () => {
      if (await persist(studentId, { status })) toast.success(`Marked as ${STATUS[status].label}`);
    });

  const setTime = (studentId: string, field: ScanMode, value: string) => {
    const deriveLate = field === "timeIn" && value && event && recordByStudent.get(studentId)?.status !== "absent";
    return attempt("Failed to save attendance time", () =>
      persist(studentId, { [field]: value, status: deriveLate ? deriveStatus(value, event, session) : undefined }),
    );
  };

  /** Stamps the current time as Time In / Time Out (QR scan or row menu). */
  const recordNow = (student: Student, mode: ScanMode) => {
    if (!event) {
      toast.error("Select an event before recording attendance");
      return;
    }
    const existing = recordByStudent.get(student.id);
    if (mode === "timeOut" && !existing?.timeIn) {
      toast.error(`${student.name} has no Time In yet for ${session} session`);
      return;
    }
    if (existing?.[mode]) {
      toast.info(`${student.name} already has ${MODE_LABEL[mode]} recorded`);
      return;
    }
    const time = nowClock();
    void attempt(`Failed to record ${MODE_LABEL[mode]}`, async () => {
      await persist(student.id, mode === "timeIn" ? { status: deriveStatus(time, event, session), timeIn: time } : { timeOut: time });
      toast.success(`${student.name} ${MODE_LABEL[mode]} recorded at ${formatTime12(time)} for ${session} session`);
    });
  };

  const confirmClear = async () => {
    if (!clearTarget) return;
    setClearing(true);
    try {
      await attendanceService.delete(clearTarget.id);
      setRecords((prev) => prev.filter((r) => r.id !== clearTarget.id));
      if (lastScan && recordByStudent.get(lastScan.studentId)?.id === clearTarget.id) setLastScan(null);
      toast.success(`${clearTarget.name}'s ${session} attendance has been cleared.`);
      setClearTarget(null);
    } catch (error) {
      console.error("Error clearing attendance:", error);
      toast.error(`Failed to clear ${clearTarget.name}'s attendance.`);
    } finally {
      setClearing(false);
    }
  };

  // ── QR scanning ───────────────────────────────────────────
  const onScan = useEffectEvent((raw: string) => {
    const now = Date.now();
    if (lastScanRef.current.data === raw && now - lastScanRef.current.at < 2500) return;
    lastScanRef.current = { data: raw, at: now };

    const payload = parseStudentQrText(raw);
    const student = payload && students.find((s) => s.studentId === payload.studentId);
    if (!student) {
      setScanMessage({
        ok: false,
        id: now,
        text: payload
          ? `No student matches ID "${payload.studentId}" — use the manual search below.`
          : "Unrecognized QR code — please scan a student attendance QR.",
      });
      return;
    }
    setScanMessage({ ok: true, id: now, text: `Scanned ${student.name} (${student.studentId}) — recording ${MODE_LABEL[scanMode]}…` });
    setScanFilter({ program: student.program, section: student.section });
    setLastScan({ studentId: student.id, time: nowClock() });
    recordNow(student, scanMode);
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!scanning || !video) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    const start = async () => {
      try {
        const media = navigator.mediaDevices;
        if (!media?.getUserMedia) throw new Error("Camera API unavailable");
        const decoder = import("jsqr"); // ~130 kB — only fetched once the camera starts
        try {
          stream = await media.getUserMedia({ video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: "environment" } } });
        } catch (error) {
          if (!cameraId) throw error;
          if (!cancelled) setCameraId(null); // chosen camera vanished — fall back to the default one
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => undefined); // autoplay restrictions
        lastScanRef.current = { data: "", at: 0 };

        const current = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
        const devices = ((await media.enumerateDevices?.()) ?? []).filter((d) => d.kind === "videoinput");
        if (cancelled) return;
        setCameras(devices);
        setActiveCameraId(current);
        if (!cameraId && !autoPickedRef.current && devices.length > 1) {
          // Browsers often open the front camera first; prefer the rear one once.
          autoPickedRef.current = true;
          const rear = devices.find((d) => REAR_CAMERA.test(d.label));
          if (rear && rear.deviceId !== current) {
            setCameraId(rear.deviceId);
            return;
          }
        }

        const { default: jsQR } = await decoder;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        let lastDecode = 0;
        const tick = (t: number) => {
          raf = requestAnimationFrame(tick);
          // Decoding every frame pegs the CPU; ~10 scans/s is plenty.
          if (!ctx || t - lastDecode < 100 || video.readyState < video.HAVE_ENOUGH_DATA || !video.videoWidth) return;
          lastDecode = t;
          if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
          if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
          if (code?.data) onScan(code.data);
        };
        if (!cancelled) raf = requestAnimationFrame(tick);
      } catch (error) {
        console.error("Error starting QR scanner camera:", error);
        if (!cancelled) {
          setScanMessage({ ok: false, id: Date.now(), text: "Unable to access the camera. Grant camera permission or use the manual search below." });
          setScannerActive(false);
        }
      }
    };
    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [scanning, cameraId]);

  const switchCamera = () => {
    const next = cameras[(cameras.findIndex((d) => d.deviceId === activeCameraId) + 1) % cameras.length];
    if (next) setCameraId(next.deviceId);
  };

  // ── Auto-mark absentees for yesterday's events (runs during the 12 AM hour) ──
  useEffect(() => {
    const run = async () => {
      const now = new Date();
      if (now.getHours() !== 0 || autoMarkingRef.current) return;
      now.setDate(now.getDate() - 1);
      const date = localDate(now);
      const due = events.filter((e) => e.date === date);
      if (!due.length) return;

      autoMarkingRef.current = true;
      try {
        for (const ev of due) {
          for (const { value: s } of SESSIONS) {
            const sch = scheduleFor(ev, s);
            if (!sch || !(sch.timeInEnabled || sch.timeOutEnabled || sch.timeIn || sch.timeOut)) continue;
            const existing = await attendanceService.getByEventIdAndSession(ev.id, s);
            const recorded = new Set(existing.map((r) => r.studentId));
            const missing = students.filter((st) => !recorded.has(st.id));
            if (!missing.length) continue;
            const saved = await Promise.all(
              missing.map((st) =>
                attendanceService.create({ studentId: st.id, eventId: ev.id, eventName: ev.name, date, session: s, status: "absent" }),
              ),
            );
            setRecords((prev) => [...prev.filter((r) => !(r.eventId === ev.id && r.session === s)), ...existing, ...saved]);
          }
        }
      } catch (error) {
        console.error("Auto-marking absent students failed:", error);
        toast.error(`Failed to auto-mark absent students — ${errorMessage(error)}`);
      } finally {
        autoMarkingRef.current = false;
      }
    };
    void run();
    const interval = setInterval(run, 60_000);
    return () => clearInterval(interval);
  }, [events, students]);

  // ── Table rows ────────────────────────────────────────────
  // Only depend on records when filtering by status, so saving a row doesn't jump back to page 1.
  const statusSource = statusFilter === "all" ? null : recordByStudent;
  const visibleStudents = useMemo(() => {
    const list = students.filter(
      (s) =>
        (!scanFilter || (s.program === scanFilter.program && s.section === scanFilter.section)) &&
        matchesSearchWords(`${s.name} ${s.studentId}`, query) &&
        (!statusSource || statusSource.get(s.id)?.status === statusFilter),
    );
    const pinned = lastScan && list.find((s) => s.id === lastScan.studentId);
    return pinned ? [pinned, ...list.filter((s) => s !== pinned)] : list;
  }, [students, scanFilter, query, statusSource, statusFilter, lastScan]);

  const lastScanned = lastScan && students.find((s) => s.id === lastScan.studentId);
  const schedule = event && scheduleSummary(event, session);
  const sessionLabel = SESSIONS.find((s) => s.value === session)!.label;

  return (
    <Page
      eyebrow="Events"
      title="Attendance"
      subtitle="Scan student QR passes or record Time In / Time Out manually for each event session."
      onBack={onBack}
      hero={
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard featured label="Registered students" value={students.length} icon={Users} hint={`${events.length} events`} />
          {(["present", "late", "absent"] as const).map((s) => (
            <StatCard
              key={s}
              label={STATUS[s].label}
              value={event ? counts[s] : "—"}
              icon={s === "present" ? UserCheck : s === "late" ? Clock : UserX}
              tone={s === "present" ? "success" : s === "late" ? "warning" : "danger"}
              hint={event ? `${sessionLabel} session` : "Select an event"}
            />
          ))}
        </div>
      }
    >
      {loading ? (
        <LoadingCard label="Loading attendance…" />
      ) : (
        <>
          {/* Event + session pickers */}
          <section className="card space-y-5 p-5 sm:p-6">
            {events.length === 0 ? (
              <EmptyState icon={QrCode} title="No events yet" description="Create an event first to start tracking attendance." />
            ) : (
              <>
                <div>
                  <p className="label">Event</p>
                  <Segmented label="Event" value={eventId || null} onChange={setEventId} options={events.map((e) => ({ value: e.id, label: e.name }))} />
                </div>
                {event && schedule && (
                  <div className="flex flex-col gap-4 border-t border-line pt-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="label">Session</p>
                      <Segmented label="Session" value={session} onChange={setSession} options={SESSIONS} />
                    </div>
                    <div className="space-y-2 lg:text-right">
                      <span className={cn("chip", schedule.chip)}>
                        <Clock className="h-3.5 w-3.5" />
                        {schedule.text}
                      </span>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted lg:justify-end">
                        <span className="chip chip-success">Present</span> on/before Time In
                        <span className="chip chip-warning">Late</span> after Time In
                        <span className="chip chip-danger">Absent</span> unrecorded (auto at 12 AM)
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {!event ? (
            events.length > 0 && (
              <div className="card">
                <EmptyState icon={UserCheck} title="Select an event to track attendance" description="Pick an event above to open the scanner and the student list." />
              </div>
            )
          ) : (
            <>
              {/* QR scanner */}
              <section className="card grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
                <div
                  className={cn(
                    "relative aspect-[4/3] overflow-hidden rounded-2xl bg-brand-950 ring-4 transition-shadow",
                    scanMessage ? (scanMessage.ok ? "ring-success/50" : "ring-danger/40") : "ring-transparent",
                  )}
                >
                  <video ref={videoRef} className={cn("absolute inset-0 h-full w-full object-cover", !scanning && "invisible")} muted playsInline />
                  {scanning ? (
                    <>
                      <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square h-3/5 -translate-x-1/2 -translate-y-1/2">
                        {["left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl"].map((c) => (
                          <span key={c} className={cn("absolute h-8 w-8 border-white/90", c)} />
                        ))}
                        <span className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse rounded-full bg-powder" />
                      </div>
                      <span className="chip absolute left-3 top-3 bg-brand-950/60 text-white backdrop-blur">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
                        Live · {MODE_LABEL[scanMode]}
                      </span>
                      <div className="absolute inset-x-3 bottom-3 flex justify-between gap-2">
                        {cameras.length > 1 ? (
                          <button type="button" onClick={switchCamera} className="btn btn-sm bg-brand-950/60 text-white backdrop-blur hover:bg-brand-950/80">
                            <SwitchCamera className="h-3.5 w-3.5" /> Switch
                          </button>
                        ) : (
                          <span />
                        )}
                        <button type="button" onClick={() => setScannerActive(false)} className="btn btn-sm bg-brand-950/60 text-white backdrop-blur hover:bg-brand-950/80">
                          <CameraOff className="h-3.5 w-3.5" /> Stop camera
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/70">
                      <div className="grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-white/5">
                        <ScanLine className="h-7 w-7" />
                      </div>
                      <p className="text-sm">Camera is off</p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setScanMessage(null);
                          autoPickedRef.current = false;
                          setScannerActive(true);
                        }}
                      >
                        <Camera className="h-4 w-4" /> Start {MODE_LABEL[scanMode]} scanner
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="icon-tile">
                      <QrCode className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg">QR scanner</h2>
                      <p className="text-sm text-muted">Pick a mode, then hold a student's QR pass up to the camera — the scan time is recorded automatically.</p>
                    </div>
                  </div>
                  <Segmented
                    label="Scan mode"
                    value={scanMode}
                    onChange={setScanMode}
                    options={[
                      { value: "timeIn", label: "Scan Time In", icon: LogIn },
                      { value: "timeOut", label: "Scan Time Out", icon: LogOut },
                    ]}
                  />

                  <div aria-live="polite">
                    {scanMessage && (
                      <div
                        key={scanMessage.id}
                        className={cn(
                          "flex animate-fade-up items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium",
                          scanMessage.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger",
                        )}
                      >
                        {scanMessage.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                        {scanMessage.text}
                      </div>
                    )}
                  </div>

                  {lastScan && lastScanned && (
                    <div className="rounded-2xl border border-line bg-surface-2 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Last scanned</p>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-500/10 text-sm font-bold text-brand-600">
                          {lastScanned.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{lastScanned.name}</p>
                          <p className="truncate text-xs text-muted">
                            {lastScanned.program} · Section {lastScanned.section}
                          </p>
                        </div>
                        <StatusChip status={recordByStudent.get(lastScanned.id)?.status} />
                      </div>
                      <p className="mt-3 text-xs text-muted">
                        Scanned at <b className="text-ink">{formatTime12(lastScan.time)}</b> · {event.name}
                      </p>
                    </div>
                  )}

                  <p className="mt-auto text-xs text-muted">Can't scan a QR pass? Find the student in the list below and record attendance manually.</p>
                </div>
              </section>

              <AttendanceTable
                key={`${eventId}-${session}`}
                students={visibleStudents}
                recordByStudent={recordByStudent}
                lastScanId={lastScan?.studentId}
                toolbar={
                  <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 lg:flex-row lg:items-center">
                    <SearchInput value={query} onChange={setQuery} placeholder="Search by name or student ID…" className="flex-1" />
                    <Segmented
                      label="Filter by status"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={[
                        { value: "all" as const, label: "All" },
                        ...(["present", "late", "absent"] as const).map((s) => ({ value: s, label: `${STATUS[s].label} · ${counts[s]}` })),
                      ]}
                    />
                    {scanFilter && (
                      <button
                        type="button"
                        className="chip chip-brand self-start hover:bg-brand-500/20 lg:self-auto"
                        onClick={() => {
                          setScanFilter(null);
                          setLastScan(null);
                        }}
                        title="Clear the filter set by the last QR scan"
                      >
                        {scanFilter.program} · Section {scanFilter.section}
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                }
                emptyText={
                  scanFilter
                    ? `No students found in ${scanFilter.program} — Section ${scanFilter.section}${query ? ` matching "${query}"` : ""}.`
                    : query
                      ? `No students match "${query}".`
                      : "No students match the current filter."
                }
                onMark={markStatus}
                onTime={setTime}
                onRecordNow={recordNow}
                onClear={(student, record) => setClearTarget({ id: record.id, name: student.name })}
              />
            </>
          )}

          {/* Analysis */}
          <section className="card p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="icon-tile">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg">Event attendance analysis</h2>
                <p className="text-sm text-muted">Registered students vs. students who attended (present or late), per event.</p>
              </div>
            </div>
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <AttendanceAnalysisChart events={events} students={students} records={records} />
            </Suspense>
          </section>
        </>
      )}

      <ConfirmDialog
        open={!!clearTarget}
        onClose={() => setClearTarget(null)}
        onConfirm={confirmClear}
        loading={clearing}
        title="Clear attendance?"
        confirmLabel="Clear attendance"
        description={
          <>
            Clear <b className="text-ink">{clearTarget?.name}</b>'s <b className="capitalize text-ink">{session}</b> attendance? The record is permanently
            removed and the student can be marked again afterward.
          </>
        }
      />
    </Page>
  );
}

interface AttendanceTableProps {
  students: Student[];
  recordByStudent: Map<string, AttendanceRecord>;
  lastScanId?: string;
  toolbar: ReactNode;
  emptyText: string;
  onMark: (studentId: string, status: "present" | "absent") => void;
  onTime: (studentId: string, field: ScanMode, value: string) => void;
  onRecordNow: (student: Student, mode: ScanMode) => void;
  onClear: (student: Student, record: AttendanceRecord) => void;
}

function AttendanceTable({ students, recordByStudent, lastScanId, toolbar, emptyText, onMark, onTime, onRecordNow, onClear }: AttendanceTableProps) {
  const { pageItems, pagination } = usePagination(students, PAGE_SIZE);

  return (
    <section className="card overflow-hidden">
      {toolbar}
      {students.length === 0 ? (
        <EmptyState icon={Users} title="No students found" description={emptyText} />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[860px]">
            <thead>
              <tr>
                <th>Student</th>
                <th>Program</th>
                <th>Status</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {pageItems.map((student) => {
                const record = recordByStudent.get(student.id);
                const scanned = student.id === lastScanId;
                return (
                  <tr key={student.id} className={cn(scanned && "bg-success/[.06]")}>
                    <td>
                      <div className="flex items-center gap-2 font-semibold">
                        {scanned && <span className="h-2 w-2 shrink-0 rounded-full bg-success" title="Last scanned" />}
                        {student.name}
                      </div>
                      <div className="text-xs text-muted">{student.studentId}</div>
                    </td>
                    <td>
                      <div>{student.program}</div>
                      <div className="text-xs text-muted">Section {student.section}</div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <StatusChip status={record?.status} />
                        {(["present", "absent"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onMark(student.id, s)}
                            className={cn(
                              "btn btn-ghost btn-sm btn-icon",
                              record?.status === s && (s === "present" ? "text-success" : "text-danger"),
                            )}
                            title={`Mark as ${STATUS[s].label}`}
                            aria-label={`Mark ${student.name} as ${STATUS[s].label}`}
                          >
                            {s === "present" ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                          </button>
                        ))}
                      </div>
                    </td>
                    {(["timeIn", "timeOut"] as const).map((field) => (
                      <td key={field}>
                        <TimeInput12
                          value={record?.[field] ?? ""}
                          onChange={(v) => onTime(student.id, field, v)}
                          disabled={record?.status === "absent"}
                          ariaLabel={MODE_LABEL[field]}
                        />
                      </td>
                    ))}
                    <td>
                      <Menu>
                        <RowActionsTrigger label={`Actions for ${student.name}`} />
                        <MenuContent>
                          <MenuItem onSelect={() => onRecordNow(student, "timeIn")}>
                            <LogIn /> Time In now
                          </MenuItem>
                          <MenuItem onSelect={() => onRecordNow(student, "timeOut")}>
                            <LogOut /> Time Out now
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem danger disabled={!record} onSelect={() => record && onClear(student, record)}>
                            <Trash2 /> Clear record
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination {...pagination} />
    </section>
  );
}
