import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Calendar,
  Users,
  CheckCircle,
  XCircle,
  Search,
  Layers,
  Clock,
  LogIn,
  LogOut,
  QrCode,
  ScanLine,
  Camera,
  CameraOff,
  SwitchCamera,
  Trash2,
} from "lucide-react";
import jsQR from "jsqr";
import {
  eventsService,
  studentsService,
  attendanceService,
  subscribeToTables,
} from "@/services/db";
import type {
  Event,
  EventSession,
  Student,
  AttendanceRecord,
  UserRole,
} from "@/types";
import { parseStudentQrText } from "@/lib/qr";
import { toast } from "sonner";
import { formatDate, formatTime12, compareTime24 } from "@/lib/format";
import { matchesSearchWords } from "@/lib/utils";
import { useSectionEntrance } from "@/hooks/useSectionEntrance";
import SectionLoader from "@/components/SectionLoader";
import SectionEmptyState from "@/components/SectionEmptyState";
import SectionBackButton from "@/components/SectionBackButton";
import TimeInput12 from "@/components/TimeInput12";
import AttendanceAnalysisChart from "@/components/AttendanceAnalysisChart";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import Pagination from "@/components/common/Pagination";

interface AttendanceManagementSectionProps {
  onBack: () => void;
  role: UserRole;
  userId?: string;
}

export default function AttendanceManagementSection({
  onBack,
  role,
}: AttendanceManagementSectionProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<
    AttendanceRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [showAttendanceClearConfirm, setShowAttendanceClearConfirm] =
    useState(false);
  const [attendanceToClear, setAttendanceToClear] = useState<{
    id: string;
    studentName: string;
  } | null>(null);

  // Role-based permissions
  const canRecordAttendance = role === "admin" || role === "secretary";

  // Attendance
  const [selectedEventForAttendance, setSelectedEventForAttendance] =
    useState("");
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [attendanceSession, setAttendanceSession] =
    useState<EventSession>("morning");
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<
    "all" | "present" | "late" | "absent"
  >("all");
  const [attendancePage, setAttendancePage] = useState(1);

  const ATTENDANCE_PAGE_SIZE = 20;

  // Auto-filter state set by QR scan
  const [scannedCourse, setScannedCourse] = useState<string | null>(null);
  const [scannedSection, setScannedSection] = useState<string | null>(null);
  const [lastScannedStudentId, setLastScannedStudentId] = useState<
    string | null
  >(null);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);

  // QR Code Scanner
  const [scanMode, setScanMode] = useState<"timeIn" | "timeOut">("timeIn");
  const [scannerActive, setScannerActive] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastScanRef = useRef({ data: "", at: 0 });

  const selectedAttendanceEvent = events.find(
    (e) => e.id === selectedEventForAttendance,
  );

  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) {
        setLoading(true);
      }

      const [eventsData, studentsData, attendanceData] = await Promise.all([
        eventsService.getAll(),
        studentsService.getAll(),
        attendanceService.getAll(),
      ]);

      setEvents(eventsData);
      setStudents(studentsData);
      setAttendanceRecords(attendanceData);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Failed to load data");
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    return subscribeToTables(
      ["events", "students", "attendance"],
      () => loadData(false),
      "attendance-management",
    );
  }, [loadData]);

  useSectionEntrance(sectionRef, [
    {
      ref: contentRef,
      from: { y: "6vh", opacity: 0 },
      to: { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" },
    },
  ]);

  const selectedAttendanceRecords = useMemo(
    () =>
      selectedEventForAttendance
        ? attendanceRecords.filter(
            (r) =>
              r.eventId === selectedEventForAttendance &&
              r.session === attendanceSession,
          )
        : [],
    [attendanceRecords, selectedEventForAttendance, attendanceSession],
  );

  const attendanceMap = useMemo(
    () => new Map(selectedAttendanceRecords.map((r) => [r.studentId, r])),
    [selectedAttendanceRecords],
  );

  const persistAttendance = useCallback(
    async (
      studentId: string,
      patch: Partial<Pick<AttendanceRecord, "status" | "timeIn" | "timeOut">>,
    ): Promise<AttendanceRecord | null> => {
      const event = selectedAttendanceEvent;
      if (!event) {
        toast.error("Select an event before recording attendance");
        return null;
      }
      const existing =
        attendanceRecords.find(
          (r) =>
            r.studentId === studentId &&
            r.eventId === selectedEventForAttendance &&
            r.session === attendanceSession,
        ) ?? null;
      const payload = {
        studentId,
        eventId: event.id,
        eventName: event.name,
        date: event.date ?? new Date().toISOString().slice(0, 10),
        session: attendanceSession,
        status: patch.status ?? existing?.status ?? "present",
        timeIn: patch.timeIn !== undefined ? patch.timeIn : existing?.timeIn,
        timeOut:
          patch.timeOut !== undefined ? patch.timeOut : existing?.timeOut,
      };
      const saved = existing
        ? await attendanceService.update(existing.id, payload)
        : await attendanceService.create(payload);
      setAttendanceRecords((prev) => {
        const index = prev.findIndex((r) => r.id === saved.id);
        if (index >= 0) {
          const copy = [...prev];
          copy[index] = saved;
          return copy;
        }
        return [...prev, saved];
      });
      return saved;
    },
    [
      selectedAttendanceEvent,
      attendanceRecords,
      selectedEventForAttendance,
      attendanceSession,
    ],
  );

  const handleMarkAttendance = async (
    studentId: string,
    status: "present" | "absent",
  ) => {
    try {
      await persistAttendance(studentId, { status });
      toast.success(
        status === "present" ? "Marked as Present" : "Marked as Absent",
      );
    } catch (error) {
      console.error("Error saving attendance status:", error);
      toast.error(`Failed to save attendance — ${errorMessage(error)}`);
    }
  };

  const confirmClearAttendance = async () => {
    if (!attendanceToClear) return;

    try {
      await attendanceService.delete(attendanceToClear.id);
      setAttendanceRecords((prev) =>
        prev.filter((record) => record.id !== attendanceToClear.id),
      );
      if (
        lastScannedStudentId &&
        attendanceMap.get(lastScannedStudentId)?.id === attendanceToClear.id
      ) {
        setLastScannedStudentId(null);
        setLastScanTime(null);
      }
      toast.success(
        `${attendanceToClear.studentName}'s ${attendanceSession} attendance has been cleared.`,
      );
      setShowAttendanceClearConfirm(false);
      setAttendanceToClear(null);
    } catch (error) {
      console.error("Error clearing attendance:", error);
      toast.error(
        `Failed to clear ${attendanceToClear.studentName}'s attendance.`,
      );
    }
  };

  const handleClearAttendance = (student: Student) => {
    const record = attendanceMap.get(student.id);
    if (!record) {
      toast.error("No attendance record exists for this student.");
      return;
    }
    setAttendanceToClear({
      id: record.id,
      studentName: student.name,
    });
    setShowAttendanceClearConfirm(true);
  };

  const handleSetAttendanceTime = async (
    studentId: string,
    field: "timeIn" | "timeOut",
    value: string,
  ) => {
    try {
      const record = attendanceMap.get(studentId);
      const status =
        field === "timeIn" &&
        value &&
        record?.status !== "absent" &&
        selectedAttendanceEvent
          ? deriveScanStatus(value, selectedAttendanceEvent, attendanceSession)
          : undefined;
      await persistAttendance(studentId, { [field]: value, status });
    } catch (error) {
      console.error("Error saving attendance time:", error);
      toast.error(`Failed to save attendance time — ${errorMessage(error)}`);
    }
  };

  const deriveScanStatus = (
    scanTimeHM: string,
    event?: Event,
    session?: EventSession,
  ): "present" | "late" => {
    if (!event || !session) return "present";
    const schedule = event.schedules?.find((s) => s.period === session);
    const sessionIn = schedule?.timeIn;
    return sessionIn && compareTime24(scanTimeHM, sessionIn) > 0
      ? "late"
      : "present";
  };

  const nowClock = () => new Date().toTimeString().slice(0, 5);

  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const handleManualAttendance = async (
    student: Student,
    action: "timeIn" | "timeOut",
  ) => {
    const event = selectedAttendanceEvent;
    if (!event) {
      toast.error("Select an event before recording attendance");
      return;
    }
    const existing =
      attendanceRecords.find(
        (r) =>
          r.studentId === student.id &&
          r.eventId === selectedEventForAttendance &&
          r.session === attendanceSession,
      ) ?? null;

    if (action === "timeIn") {
      if (existing?.timeIn) {
        toast.info(`${student.name} already has Time In recorded`);
        return;
      }
      const scanTime = nowClock();
      try {
        await persistAttendance(student.id, {
          status: deriveScanStatus(scanTime, event, attendanceSession),
          timeIn: scanTime,
        });
        toast.success(
          `${student.name} Time In recorded at ${formatTime12(scanTime)} for ${attendanceSession} session`,
        );
      } catch (error) {
        console.error("Error recording Time In:", error);
        toast.error(`Failed to record Time In — ${errorMessage(error)}`);
      }
    } else {
      if (!existing?.timeIn) {
        toast.error(
          `${student.name} has no Time In yet for ${attendanceSession} session`,
        );
        return;
      }
      if (existing.timeOut) {
        toast.info(`${student.name} already has Time Out recorded`);
        return;
      }
      const scanTime = nowClock();
      try {
        await persistAttendance(student.id, {
          status: existing.status,
          timeOut: scanTime,
        });
        toast.success(
          `${student.name} Time Out recorded at ${formatTime12(scanTime)} for ${attendanceSession} session`,
        );
      } catch (error) {
        console.error("Error recording Time Out:", error);
        toast.error(`Failed to record Time Out — ${errorMessage(error)}`);
      }
    }
  };

  const handleQrScan = (rawData: string) => {
    const now = Date.now();
    if (
      lastScanRef.current.data === rawData &&
      now - lastScanRef.current.at < 2500
    )
      return;
    lastScanRef.current = { data: rawData, at: now };

    const payload = parseStudentQrText(rawData);
    if (!payload) {
      setScanMessage({
        type: "error",
        text: "Unrecognized QR code — please scan a student attendance QR.",
      });
      return;
    }

    const student = students.find((s) => s.studentId === payload.studentId);
    if (!student) {
      setScanMessage({
        type: "error",
        text: `No student matches ID "${payload.studentId}" — use the manual search below.`,
      });
      return;
    }

    setScanMessage({
      type: "success",
      text: `Scanned ${student.name} (${student.studentId}) — recording ${scanMode === "timeIn" ? "Time In" : "Time Out"}…`,
    });
    setScannedCourse(student.program);
    setScannedSection(student.section);
    setLastScannedStudentId(student.id);
    setLastScanTime(nowClock());
    setAttendancePage(1);
    void handleManualAttendance(student, scanMode);
  };

  const qrScanHandlerRef = useRef<(data: string) => void>(() => undefined);
  qrScanHandlerRef.current = handleQrScan;

  useEffect(() => {
    if (!scannerActive) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId = 0;
    const video = videoRef.current;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      if (
        !video ||
        !canvas ||
        video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA
      )
        return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const code = jsQR(image.data, image.width, image.height, {
        inversionAttempts: "dontInvert",
      });
      if (code?.data) qrScanHandlerRef.current(code.data);
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera API unavailable");
        }

        const constraints: MediaStreamConstraints = selectedCameraId
          ? { video: { deviceId: { exact: selectedCameraId } } }
          : { video: { facingMode: { ideal: "environment" } } };
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (selectedCameraError) {
          if (!selectedCameraId) throw selectedCameraError;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: "environment" } },
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
          if (!cancelled) setSelectedCameraId(null);
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (video) {
          video.muted = true;
          video.srcObject = stream;
          try {
            await video.play();
          } catch {
            /* autoplay restrictions */
          }
        }
        lastScanRef.current = { data: "", at: 0 };

        if (navigator.mediaDevices.enumerateDevices) {
          const devices = (
            await navigator.mediaDevices.enumerateDevices()
          ).filter((device) => device.kind === "videoinput");
          if (!cancelled) {
            setCameraDevices(devices);
            if (!selectedCameraId && devices.length > 1) {
              const rearCamera = devices.find((device) =>
                /back|rear|environment|world|外向|后置/i.test(device.label),
              );
              const currentCameraId = stream
                .getVideoTracks()[0]
                ?.getSettings().deviceId;
              if (rearCamera && rearCamera.deviceId !== currentCameraId) {
                setSelectedCameraId(rearCamera.deviceId);
                return;
              }
              if (currentCameraId) setSelectedCameraId(currentCameraId);
            }
          }
        }
        tick();
      } catch (error) {
        console.error("Error starting QR scanner camera:", error);
        if (!cancelled) {
          setScanMessage({
            type: "error",
            text: "Unable to access the camera. Grant camera permission or use the manual search below.",
          });
          setScannerActive(false);
        }
      }
    };
    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [scannerActive, selectedCameraId]);

  const autoMarkAbsent = useCallback(async () => {
    if (!canRecordAttendance) return;
    const now = new Date();
    if (now.getHours() !== 0) return;

    const completedDate = new Date(now);
    completedDate.setDate(completedDate.getDate() - 1);
    const completedDateISO = [
      completedDate.getFullYear(),
      String(completedDate.getMonth() + 1).padStart(2, "0"),
      String(completedDate.getDate()).padStart(2, "0"),
    ].join("-");
    const completedEvents = events.filter((e) => e.date === completedDateISO);
    if (completedEvents.length === 0) return;

    try {
      for (const event of completedEvents) {
        for (const session of ["morning", "afternoon", "evening"] as const) {
          const schedule = event.schedules?.find((s) => s.period === session);
          if (!schedule) continue;

          const holdsSession =
            schedule.timeInEnabled ||
            schedule.timeOutEnabled ||
            !!schedule.timeIn ||
            !!schedule.timeOut;
          if (!holdsSession) continue;

          const existing = await attendanceService.getByEventIdAndSession(
            event.id,
            session,
          );
          const recordedIds = new Set(existing.map((r) => r.studentId));
          const missing = students.filter((s) => !recordedIds.has(s.id));
          if (missing.length === 0) continue;

          const saved = await Promise.all(
            missing.map((student) =>
              attendanceService.create({
                studentId: student.id,
                eventId: event.id,
                eventName: event.name,
                date: event.date ?? completedDateISO,
                session,
                status: "absent",
              }),
            ),
          );

          setAttendanceRecords((prev) => [
            ...prev.filter(
              (r) => !(r.eventId === event.id && r.session === session),
            ),
            ...existing,
            ...saved,
          ]);
        }
      }
    } catch (error) {
      console.error("Auto-marking absent students failed:", error);
      toast.error(
        `Failed to auto-mark absent students — ${errorMessage(error)}`,
      );
    }
  }, [canRecordAttendance, events, students]);

  useEffect(() => {
    autoMarkAbsent();
    const interval = setInterval(autoMarkAbsent, 60_000);
    return () => clearInterval(interval);
  }, [autoMarkAbsent]);

  const attendanceSearchTerm = attendanceSearch.trim().toLowerCase();
  const filteredStudents = useMemo(() => {
    let result = students;

    if (scannedCourse && scannedSection) {
      result = result.filter(
        (s) => s.program === scannedCourse && s.section === scannedSection,
      );
    }

    if (attendanceSearchTerm) {
      result = result.filter((s) =>
        matchesSearchWords(`${s.name} ${s.studentId}`, attendanceSearchTerm),
      );
    }

    if (attendanceStatusFilter !== "all") {
      result = result.filter((s) => {
        const status = attendanceMap.get(s.id)?.status;
        return status === attendanceStatusFilter;
      });
    }

    if (lastScannedStudentId) {
      const scanned = result.find((s) => s.id === lastScannedStudentId);
      if (scanned) {
        result = [
          scanned,
          ...result.filter((s) => s.id !== lastScannedStudentId),
        ];
      }
    }

    return result;
  }, [
    students,
    attendanceSearchTerm,
    attendanceStatusFilter,
    attendanceMap,
    scannedCourse,
    scannedSection,
    lastScannedStudentId,
  ]);

  useEffect(() => {
    setAttendancePage(1);
  }, [
    selectedEventForAttendance,
    attendanceSession,
    attendanceSearchTerm,
    attendanceStatusFilter,
    scannedCourse,
    scannedSection,
    lastScannedStudentId,
  ]);

  const attendanceTotalPages = Math.max(
    1,
    Math.ceil(filteredStudents.length / ATTENDANCE_PAGE_SIZE),
  );
  const currentAttendancePage = Math.min(attendancePage, attendanceTotalPages);
  const attendancePageStartIndex =
    (currentAttendancePage - 1) * ATTENDANCE_PAGE_SIZE;
  const paginatedStudents = filteredStudents.slice(
    attendancePageStartIndex,
    attendancePageStartIndex + ATTENDANCE_PAGE_SIZE,
  );

  useEffect(() => {
    if (attendancePage > attendanceTotalPages) {
      setAttendancePage(attendanceTotalPages);
    }
  }, [attendancePage, attendanceTotalPages]);

  const lastScannedStudent = lastScannedStudentId
    ? (students.find((s) => s.id === lastScannedStudentId) ?? null)
    : null;

  const attendanceAnalysisData = useMemo(() => {
    const registeredStudentIds = new Set(students.map((student) => student.id));
    const totalPopulation = registeredStudentIds.size;

    return [...events]
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
      .map((event) => {
        const attendeeIds = new Set(
          attendanceRecords
            .filter(
              (record) =>
                record.eventId === event.id &&
                registeredStudentIds.has(record.studentId) &&
                (record.status === "present" || record.status === "late"),
            )
            .map((record) => record.studentId),
        );
        const actualPopulationAttended = attendeeIds.size;

        return {
          eventId: event.id,
          eventName: event.name,
          eventLabel: event.date
            ? `${event.name} — ${formatDate(event.date)}`
            : event.name,
          totalPopulation,
          actualPopulationAttended,
          attendanceGap: Math.max(
            0,
            totalPopulation - actualPopulationAttended,
          ),
        };
      });
  }, [attendanceRecords, events, students]);

  if (!canRecordAttendance) {
    return (
      <section
        ref={sectionRef}
        className="min-h-screen w-full gradient-bg-orange relative overflow-hidden py-20 lg:py-24"
      >
        <div
          ref={contentRef}
          className="relative z-10 w-full px-4 sm:px-6 lg:px-8 xl:px-12"
        >
          <div className="flex items-center gap-4 mb-6">
            <SectionBackButton onClick={onBack} />
            <div>
              <h1 className="font-display font-bold text-2xl lg:text-3xl text-dark">
                Access Denied
              </h1>
              <p className="text-text-secondary text-sm">
                You don't have permission to access attendance management
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className="min-h-screen w-full gradient-bg-orange relative overflow-hidden py-20 lg:py-24"
    >
      <div
        ref={contentRef}
        className="relative z-10 w-full px-4 sm:px-6 lg:px-8 xl:px-12"
      >
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <SectionBackButton onClick={onBack} />
            <div>
              <h1 className="font-display font-bold text-2xl lg:text-3xl text-dark">
                Attendance Management
              </h1>
              <p className="text-text-secondary text-sm">
                Track and manage student attendance
              </p>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && <SectionLoader message="Loading data..." />}

        {/* Attendance Content */}
        {!loading && (
          <div className="glass-card p-5 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-red" />
                </div>
                <h3 className="font-display font-semibold text-lg text-dark">
                  Attendance Tracking
                </h3>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-dark mb-1.5">
                Select Event
              </label>
              <select
                value={selectedEventForAttendance}
                onChange={(e) => setSelectedEventForAttendance(e.target.value)}
                className="glass-input w-full px-4 py-3 text-sm"
              >
                <option value="">Choose an event</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedAttendanceEvent && (
              <div className="mb-5 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-blue-50/60 shadow-sm">
                <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
                  {/* Session Tabs - Full width at top */}
                  <div className="flex gap-2 border-b border-gray-200 pb-3">
                    {(
                      ["morning", "afternoon", "evening"] as EventSession[]
                    ).map((session) => (
                      <button
                        key={session}
                        onClick={() => setAttendanceSession(session)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                          attendanceSession === session
                            ? "bg-red text-white"
                            : "bg-white/50 text-text-secondary hover:bg-white/80"
                        }`}
                      >
                        {session === "morning"
                          ? "☀️ Morning"
                          : session === "afternoon"
                            ? "🌤️ Afternoon"
                            : "🌙 Evening"}
                      </button>
                    ))}
                  </div>

                  {/* Event Info Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-2xl shadow-inner">
                        {attendanceSession === "morning"
                          ? "☀️"
                          : attendanceSession === "afternoon"
                            ? "🌤️"
                            : "🌙"}
                      </div>
                      <div className="min-w-0">
                        <p className="font-display text-lg font-semibold text-blue-700">
                          {attendanceSession.charAt(0).toUpperCase() +
                            attendanceSession.slice(1)}{" "}
                          Session
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-text-secondary">
                          <Calendar className="h-4 w-4 text-slate-500" />
                          Schedule:{" "}
                          {(() => {
                            const schedule =
                              selectedAttendanceEvent.schedules?.find(
                                (s) => s.period === attendanceSession,
                              );

                            if (!schedule) {
                              return (
                                <span className="text-amber-600 font-medium">
                                  No schedule set for this session
                                </span>
                              );
                            }

                            const timeIn = schedule.timeIn
                              ? formatTime12(schedule.timeIn)
                              : null;
                            const timeOut = schedule.timeOut
                              ? formatTime12(schedule.timeOut)
                              : null;

                            if (timeIn && timeOut) {
                              return (
                                <span className="text-green-600 font-medium">
                                  {timeIn} - {timeOut}
                                </span>
                              );
                            }

                            if (timeIn) {
                              return (
                                <span className="text-blue-600 font-medium">
                                  {timeIn} - Time Out not set
                                </span>
                              );
                            }

                            if (timeOut) {
                              return (
                                <span className="text-blue-600 font-medium">
                                  Time In not set - {timeOut}
                                </span>
                              );
                            }

                            return (
                              <span className="text-amber-600 font-medium">
                                Schedule times not configured
                              </span>
                            );
                          })()}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-left text-sm text-text-secondary sm:text-right">
                      <p className="font-medium text-dark">
                        {selectedAttendanceEvent.name}
                      </p>
                      <p className="text-xs">
                        {selectedAttendanceEvent.schedules?.length
                          ? `${selectedAttendanceEvent.schedules.length} session(s) configured`
                          : "No sessions configured for this event"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Scheduled windows + auto-status rules */}
            {selectedAttendanceEvent && (
              <div className="mb-4 rounded-xl border border-white/50 bg-white/30 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-dark">
                    <Clock className="w-4 h-4 text-red" />
                    Attendance rules
                  </span>
                  <span className="text-xs text-text-secondary">
                    Present = recorded on/before scheduled Time In | Late =
                    recorded after scheduled Time In | Absent = never recorded
                    (auto-marked at 12:00 AM)
                  </span>
                </div>
              </div>
            )}

            {/* QR Code Scanner */}
            {selectedAttendanceEvent && (
              <div className="mb-6 border border-white/50 rounded-xl p-4 lg:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red/10 flex items-center justify-center">
                      <QrCode className="w-4 h-4 text-red" />
                    </div>
                    <div>
                      <h4 className="font-display font-semibold text-dark">
                        QR Code Scanner
                      </h4>
                      <p className="text-xs text-text-secondary">
                        Pick a mode, then hold a student's QR code in front of
                        the camera — the scan time is recorded automatically.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setScanMode("timeIn")}
                      className={`px-3 py-1.5 text-xs rounded-lg ${
                        scanMode === "timeIn"
                          ? "bg-green-600 text-white"
                          : "bg-green-100 text-green-700 hover:bg-green-200"
                      }`}
                      title="Scanned students will be recorded as Time In"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      Scan Time In
                    </button>
                    <button
                      type="button"
                      onClick={() => setScanMode("timeOut")}
                      className={`px-3 py-1.5 text-xs rounded-lg ${
                        scanMode === "timeOut"
                          ? "bg-blue-600 text-white"
                          : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                      }`}
                      title="Scanned students will be recorded as Time Out"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Scan Time Out
                    </button>
                  </div>
                </div>

                {/* Camera preview */}
                <div className="relative h-64 max-w-md mx-auto rounded-xl overflow-hidden bg-black/80">
                  <video
                    ref={videoRef}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ transform: "scaleX(1)" }}
                    muted
                    playsInline
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  {!scannerActive ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                      <ScanLine className="w-10 h-10 opacity-60" />
                      <p className="text-xs">Camera is off</p>
                      <button
                        type="button"
                        onClick={() => {
                          setScanMessage(null);
                          setScannerActive(true);
                        }}
                        className="px-4 py-2 text-sm"
                      >
                        <Camera className="w-4 h-4" />
                        Start {scanMode === "timeIn"
                          ? "Time In"
                          : "Time Out"}{" "}
                        Scanner
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-red/70 animate-pulse pointer-events-none"
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        onClick={() => setScannerActive(false)}
                        className="absolute bottom-3 right-3 px-3 py-1.5 text-xs rounded-lg bg-black/60 text-white hover:bg-black/80"
                      >
                        <CameraOff className="w-3.5 h-3.5" />
                        Stop Camera
                      </button>
                      {cameraDevices.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const currentIndex = cameraDevices.findIndex(
                              (device) => device.deviceId === selectedCameraId,
                            );
                            const nextCamera =
                              cameraDevices[
                                (currentIndex + 1) % cameraDevices.length
                              ];
                            if (nextCamera)
                              setSelectedCameraId(nextCamera.deviceId);
                          }}
                          className="absolute bottom-3 left-3 px-3 py-1.5 text-xs rounded-lg bg-black/60 text-white hover:bg-black/80"
                          title="Switch camera"
                        >
                          <SwitchCamera className="w-3.5 h-3.5" />
                          Switch Camera
                        </button>
                      )}
                    </>
                  )}
                </div>

                {scanMessage && (
                  <div
                    className={`mt-3 max-w-md mx-auto text-sm rounded-lg px-3 py-2 ${
                      scanMessage.type === "error"
                        ? "bg-red/10 text-red-500"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {scanMessage.text}
                  </div>
                )}

                <p className="mt-2 text-xs text-text-secondary text-center">
                  Can't scan a student's QR code? Use the manual search below to
                  record their attendance.
                </p>
              </div>
            )}

            {selectedEventForAttendance && (
              <>
                {/* Search and status controls */}
                <div className="mb-4 flex flex-col items-stretch gap-4 rounded-2xl border border-blue-50 bg-white/80 p-4 shadow-sm sm:flex-row sm:items-center sm:gap-6 sm:p-5">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-secondary" />
                    <input
                      type="text"
                      value={attendanceSearch}
                      onChange={(e) => setAttendanceSearch(e.target.value)}
                      placeholder="Search by full name or student ID..."
                      className="glass-input w-full rounded-xl py-3.5 pl-12 pr-16 text-sm sm:text-base"
                    />
                    {attendanceSearch && (
                      <button
                        type="button"
                        onClick={() => setAttendanceSearch("")}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-text-secondary hover:text-dark"
                        title="Clear search"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <label
                      htmlFor="attendance-status-filter"
                      className="text-sm font-medium text-dark whitespace-nowrap"
                    >
                      Show students:
                    </label>
                    <select
                      id="attendance-status-filter"
                      value={attendanceStatusFilter}
                      onChange={(e) =>
                        setAttendanceStatusFilter(
                          e.target.value as
                            | "all"
                            | "present"
                            | "late"
                            | "absent",
                        )
                      }
                      className="glass-input min-w-[180px] rounded-xl px-4 py-3 text-sm sm:text-base"
                    >
                      <option value="all">All Students</option>
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="absent">Absent</option>
                    </select>
                  </div>
                </div>

                {scannedCourse && scannedSection && (
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setScannedCourse(null);
                        setScannedSection(null);
                        setLastScannedStudentId(null);
                        setLastScanTime(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-200 transition-colors"
                      title="Clear auto-filters set by QR scan"
                    >
                      <span>
                        Filtered: {scannedCourse} — Section {scannedSection}
                      </span>
                      <XCircle className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Last Scanned Student Banner */}
                {lastScannedStudent && lastScannedStudentId && (
                  <div className="mb-4 border border-green-200 bg-green-50/60 rounded-xl p-4 lg:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-1">
                          ✓ Last Scanned — Marked Present
                        </p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-semibold text-dark">
                            {lastScannedStudent.name}
                          </span>
                          <span className="text-sm text-text-secondary">
                            Course:{" "}
                            <span className="font-medium text-dark">
                              {lastScannedStudent.program}
                            </span>
                          </span>
                          <span className="text-sm text-text-secondary">
                            Section:{" "}
                            <span className="font-medium text-dark">
                              {lastScannedStudent.section}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-sm">
                            <span className="text-text-secondary">Status:</span>
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                attendanceMap.get(lastScannedStudentId!)
                                  ?.status === "late"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-green-100 text-green-600"
                              }`}
                            >
                              {attendanceMap.get(lastScannedStudentId!)
                                ?.status === "late"
                                ? "Late"
                                : "Present"}
                            </span>
                          </span>
                          <span className="text-sm text-text-secondary">
                            Event:{" "}
                            <span className="font-medium text-dark">
                              {selectedAttendanceEvent?.name ?? "—"}
                            </span>
                          </span>
                          <span className="text-sm text-text-secondary">
                            Scan Time:{" "}
                            <span className="font-medium text-dark">
                              {lastScanTime ? formatTime12(lastScanTime) : "—"}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-xl overflow-hidden border border-gray-200">
                  <div className="overflow-x-auto">
                    <table className="glass-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Student ID</th>
                          <th>Course</th>
                          <th>Section</th>
                          <th className="text-center">Status</th>
                          <th>Event</th>
                          <th>Time In</th>
                          <th>Time Out</th>
                          <th className="text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedStudents.map((student) => {
                          const record = attendanceMap.get(student.id);
                          const isPresent = record?.status === "present";
                          const isLastScanned =
                            student.id === lastScannedStudentId;
                          return (
                            <tr
                              key={student.id}
                              className={
                                isLastScanned
                                  ? "bg-green-50/70 border-l-2 border-l-green-500"
                                  : ""
                              }
                            >
                              <td className="font-medium text-dark">
                                <div className="flex items-center gap-2">
                                  {isLastScanned && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                  )}
                                  {student.name}
                                </div>
                              </td>
                              <td className="text-text-secondary">
                                {student.studentId}
                              </td>
                              <td className="text-text-secondary">
                                {student.program}
                              </td>
                              <td className="text-text-secondary">
                                {student.section}
                              </td>
                              <td className="text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() =>
                                      handleMarkAttendance(
                                        student.id,
                                        "present",
                                      )
                                    }
                                    className={`p-2 rounded-lg ${
                                      isPresent
                                        ? "bg-green-100 text-green-600"
                                        : "text-text-secondary"
                                    }`}
                                    title="Mark as Present (auto-saves)"
                                  >
                                    <CheckCircle className="w-5 h-5" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleMarkAttendance(student.id, "absent")
                                    }
                                    className={`p-2 rounded-lg ${
                                      record?.status === "absent"
                                        ? "bg-red/10 text-red-500"
                                        : "text-text-secondary"
                                    }`}
                                    title="Mark as Absent (auto-saves)"
                                  >
                                    <XCircle className="w-5 h-5" />
                                  </button>
                                  {record && (
                                    <span
                                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                        record.status === "late"
                                          ? "bg-amber-100 text-amber-700"
                                          : record.status === "present"
                                            ? "bg-green-100 text-green-600"
                                            : "bg-red/10 text-red-500"
                                      }`}
                                    >
                                      {record.status === "late"
                                        ? "Late"
                                        : record.status === "present"
                                          ? "Present"
                                          : "Absent"}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="text-text-secondary text-sm">
                                {selectedAttendanceEvent?.name ?? "—"}
                              </td>
                              <td>
                                <TimeInput12
                                  value={record?.timeIn ?? ""}
                                  onChange={(v) =>
                                    handleSetAttendanceTime(
                                      student.id,
                                      "timeIn",
                                      v,
                                    )
                                  }
                                  disabled={record?.status === "absent"}
                                  ariaLabel="Time in"
                                />
                              </td>
                              <td>
                                <TimeInput12
                                  value={record?.timeOut ?? ""}
                                  onChange={(v) =>
                                    handleSetAttendanceTime(
                                      student.id,
                                      "timeOut",
                                      v,
                                    )
                                  }
                                  disabled={record?.status === "absent"}
                                  ariaLabel="Time out"
                                />
                              </td>
                              <td className="text-center">
                                <button
                                  type="button"
                                  onClick={() => handleClearAttendance(student)}
                                  disabled={!record}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                    record
                                      ? "text-red-500 hover:bg-red/10 hover:text-red-600"
                                      : "text-text-secondary/40 cursor-not-allowed"
                                  }`}
                                  title={
                                    record
                                      ? "Clear attendance record"
                                      : "No attendance record to clear"
                                  }
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Clear
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {filteredStudents.length === 0 && (
                          <tr>
                            <td
                              colSpan={9}
                              className="text-center text-text-secondary py-6"
                            >
                              {scannedCourse && scannedSection
                                ? `No students found in ${scannedCourse} \u2014 Section ${scannedSection}${attendanceSearch ? ` matching "${attendanceSearch}"` : ""}`
                                : `No students match "${attendanceSearch}"`}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <Pagination
                  page={currentAttendancePage}
                  totalPages={attendanceTotalPages}
                  totalItems={filteredStudents.length}
                  startIndex={attendancePageStartIndex}
                  endIndex={attendancePageStartIndex + paginatedStudents.length}
                  onPrev={() =>
                    setAttendancePage((page) => Math.max(1, page - 1))
                  }
                  onNext={() =>
                    setAttendancePage((page) =>
                      Math.min(attendanceTotalPages, page + 1),
                    )
                  }
                  onJump={setAttendancePage}
                />
              </>
            )}

            {!selectedEventForAttendance && (
              <SectionEmptyState
                message="Select an event to track attendance"
                icon={Calendar}
              />
            )}

            {/* Event Attendance Analysis */}
            <div className="mt-6 border-t border-white/50 pt-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-red/10 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-red" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-lg text-dark">
                    Event Attendance Analysis
                  </h3>
                  <p className="text-xs text-text-secondary">
                    K-Means attendance comparison using live registered-student
                    and attendance records for every event.
                  </p>
                </div>
              </div>

              <AttendanceAnalysisChart data={attendanceAnalysisData} />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showAttendanceClearConfirm && attendanceToClear != null}
        onClose={() => {
          setShowAttendanceClearConfirm(false);
          setAttendanceToClear(null);
        }}
        onConfirm={confirmClearAttendance}
        title="Clear Attendance?"
        confirmLabel="Clear Attendance"
        warningText="This will permanently remove the attendance record. The student will become unrecorded and can be marked again afterward."
      >
        <p className="text-sm text-text-secondary leading-relaxed">
          Are you sure you want to clear{" "}
          <span className="font-semibold text-dark">
            {attendanceToClear?.studentName ?? ""}
          </span>
          's{" "}
          <span className="font-semibold text-dark capitalize">
            {attendanceSession}
          </span>{" "}
          attendance?
        </p>
      </ConfirmDialog>
    </section>
  );
}
