import { useEffect, useState, Suspense, lazy, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import { ClipboardCheck } from "lucide-react";
import type { ViewState, Student, UserRole, Event } from "@/types";
import { studentsService, eventEvaluationsService } from "@/services/db";
import { authService, type AuthSession } from "@/services/auth";
import { offlineSyncService } from "@/lib/offlineSync";
import { namesMatch } from "@/lib/utils";
import { ROLE_LABEL, canAccess } from "@/lib/roles";
import { LoadingCard } from "@/components/ui/Skeleton";
import SyncStatusBadge from "@/components/SyncStatusBadge";
import PushPromptModal from "@/components/PushPromptModal";
import SmoothScroll from "@/components/motion/SmoothScroll";
import { scrollToTop } from "@/lib/scroll";
import { growFrom } from "@/lib/transition";
import { useInteractionMotion } from "@/hooks/useInteractionMotion";
import Navigation from "@/sections/Navigation";
import LandingSection from "@/sections/LandingSection";
import FooterSection from "@/sections/FooterSection";

// Public pages other than the landing page, and every staff page, are
// code-split so first-time visitors only download the landing bundle.
const load = {
  record: () => import("@/sections/StudentRecordSection"),
  transparency: () => import("@/sections/TransparencyBoardSection"),
  feedback: () => import("@/sections/FeedbackSection"),
  login: () => import("@/sections/AdminLoginSection"),
  forgot: () => import("@/sections/ForgotPasswordSection"),
  reset: () => import("@/sections/ResetPasswordSection"),
  dashboard: () => import("@/sections/AdminDashboardSection"),
  students: () => import("@/sections/StudentManagementSection"),
  files: () => import("@/sections/RequirementFilesManagementSection"),
  events: () => import("@/sections/EventManagementSection"),
  contributions: () => import("@/sections/ContributionManagementSection"),
  feedbackAdmin: () => import("@/sections/FeedbackManagementSection"),
  reports: () => import("@/sections/ReportManagementSection"),
  attendance: () => import("@/sections/AttendanceManagementSection"),
};
const StudentRecordSection = lazy(load.record);
const TransparencyBoardSection = lazy(load.transparency);
const FeedbackSection = lazy(load.feedback);
const AdminLoginSection = lazy(load.login);
const ForgotPasswordSection = lazy(load.forgot);
const ResetPasswordSection = lazy(load.reset);
const AdminDashboardSection = lazy(load.dashboard);
const StudentManagementSection = lazy(load.students);
const RequirementFilesManagementSection = lazy(load.files);
const EventManagementSection = lazy(load.events);
const ContributionManagementSection = lazy(load.contributions);
const FeedbackManagementSection = lazy(load.feedbackAdmin);
const ReportManagementSection = lazy(load.reports);
const AttendanceManagementSection = lazy(load.attendance);

/** Code each view needs, fetched before a transition so the page grows in fully drawn. */
const VIEW_CODE: Partial<Record<ViewState, () => Promise<unknown>>> = {
  "student-record": load.record,
  "evaluation-required": load.record,
  transparency: load.transparency,
  inquiry: load.feedback,
  complaint: load.feedback,
  suggestion: load.feedback,
  "admin-forgot-password": load.forgot,
  "admin-reset-password": load.reset,
  "admin-dashboard": () => Promise.all([load.dashboard(), load.login()]),
  "admin-login": () => Promise.all([load.dashboard(), load.login()]),
  "student-management": load.students,
  "requirement-files-management": load.files,
  "event-management": load.events,
  "contribution-management": load.contributions,
  "payment-management": load.contributions,
  "transaction-management": load.transparency,
  "feedback-management": load.feedbackAdmin,
  "report-management": load.reports,
  "attendance-management": load.attendance,
};

const Fallback = () => (
  <div className="mx-auto max-w-5xl px-4 pt-28">
    <LoadingCard />
  </div>
);

function App() {
  const [view, setView] = useState<ViewState>("landing");
  const [student, setStudent] = useState<Student | null>(null);
  const [pendingEvaluation, setPendingEvaluation] = useState<Event | null>(null);
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [searching, setSearching] = useState(false);
  const role: UserRole | null = auth?.role ?? null;
  useInteractionMotion();

  useEffect(() => {
    offlineSyncService.start();
    authService
      .restoreSession()
      .then((session) => {
        setAuth(session);
        if (session) setView((v) => (v === "admin-login" ? "admin-dashboard" : v));
      })
      .catch((error) => console.error("Failed to restore session:", error))
      .finally(() => setAuthReady(true));
    // Fired when the user arrives through a password-reset email link.
    const unsubscribe = authService.onPasswordRecovery(() => {
      setAuth(null);
      setView("admin-reset-password");
    });
    return () => {
      offlineSyncService.stop();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    offlineSyncService.configure(auth?.user.id ?? null, auth?.role ?? null);
  }, [auth]);

  const navigate = async (next: ViewState) => {
    await VIEW_CODE[next]?.().catch(() => undefined); // a failed chunk still falls back to Suspense
    growFrom(() => {
      setView(next);
      scrollToTop();
    });
  };

  // Warm the public pages once the landing page is idle so they open instantly.
  useEffect(() => {
    const warm = () => [load.record, load.transparency, load.feedback, load.login].forEach((f) => f().catch(() => undefined));
    const id = "requestIdleCallback" in window ? requestIdleCallback(warm, { timeout: 4000 }) : setTimeout(warm, 2500);
    return () => ("cancelIdleCallback" in window ? cancelIdleCallback(id as number) : clearTimeout(id));
  }, []);

  const handleSearch = async (name: string, studentId: string) => {
    if (!name.trim() || !studentId.trim()) {
      toast.error("Please enter both your Student Name and Student ID.");
      return;
    }
    setSearching(true);
    try {
      const found = await studentsService.getByStudentId(studentId.trim());
      // Word-order-agnostic: "Dela Cruz Juan" verifies against "Juan Dela Cruz".
      if (!found || !namesMatch(found.name, name)) {
        toast.error("Student Name and Student ID do not match.");
        return;
      }
      const pending = await eventEvaluationsService.getPendingGate(found.studentId);
      setStudent(found);
      setPendingEvaluation(pending);
      navigate(pending ? "evaluation-required" : "student-record");
    } catch (error) {
      console.error("Error searching student:", error);
      toast.error("Error searching for student. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const handleLogin = async (email: string, password: string) => {
    const session = await authService.signIn(email, password);
    setAuth(session);
    navigate("admin-dashboard");
    toast.success(`Welcome, ${ROLE_LABEL[session.role]}!`);
  };

  const handleSetNewPassword = async (password: string) => {
    if (!(await authService.hasRecoverySession())) {
      throw new Error("Your password reset session is no longer valid. Please request a new reset link.");
    }
    await authService.updatePassword(password);
    await authService.signOut();
    setAuth(null);
    navigate("admin-login");
    toast.success("Password updated. Please sign in with your new password.");
  };

  const handleLogout = async () => {
    await authService.signOut().catch((error) => console.error("Error signing out:", error));
    setAuth(null);
    navigate("landing");
    toast.info("You have been logged out");
  };

  const renderView = (): ReactNode => {
    if (!authReady) return <Fallback />;

    const toDashboard = () => navigate("admin-dashboard");
    const login = <AdminLoginSection onLogin={handleLogin} onForgotPassword={() => navigate("admin-forgot-password")} />;
    const landing = (
      <LandingSection onSearch={handleSearch} onViewTransparency={() => navigate("transparency")} searching={searching} />
    );

    // Staff-only views: fall back to the login screen when not permitted.
    if (canAccess(role, view) === false) return login;
    const staff = { role: role!, userId: auth?.user.id ?? "", staffName: auth?.displayName ?? "", onBack: toDashboard };

    switch (view) {
      case "student-record":
        return student ? <StudentRecordSection student={student} onBack={() => navigate("landing")} /> : landing;
      case "evaluation-required":
        return student && pendingEvaluation ? (
          <EvaluationGate
            event={pendingEvaluation}
            onRecheck={() => handleSearch(student.name, student.studentId)}
            onBack={() => navigate("landing")}
            checking={searching}
          />
        ) : (
          landing
        );
      case "transparency":
        return <TransparencyBoardSection onNavigate={navigate} />;
      case "inquiry":
      case "complaint":
      case "suggestion":
        return <FeedbackSection key={view} defaultTab={view} />;
      case "admin-login":
      case "admin-dashboard":
        return auth ? (
          <AdminDashboardSection role={staff.role} userEmail={auth.user.email ?? ""} userId={staff.userId} onNavigate={navigate} onLogout={handleLogout} />
        ) : (
          login
        );
      case "admin-forgot-password":
        return <ForgotPasswordSection onRequestReset={authService.requestPasswordReset} onBack={() => navigate("admin-login")} />;
      case "admin-reset-password":
        return <ResetPasswordSection onSetNewPassword={handleSetNewPassword} />;
      case "student-management":
        return <StudentManagementSection onBack={toDashboard} />;
      case "requirement-files-management":
        return <RequirementFilesManagementSection role={staff.role} userId={staff.userId} onBack={toDashboard} />;
      case "event-management":
        return <EventManagementSection {...staff} />;
      case "attendance-management":
        return <AttendanceManagementSection role={staff.role} userId={staff.userId} onBack={toDashboard} />;
      case "contribution-management":
      case "payment-management":
        return <ContributionManagementSection role={staff.role} staffName={staff.staffName} onBack={toDashboard} />;
      case "transaction-management":
        return <TransparencyBoardSection adminMode role={staff.role} staffName={staff.staffName} onBack={toDashboard} />;
      case "feedback-management":
        return <FeedbackManagementSection role={staff.role} onBack={toDashboard} />;
      case "report-management":
        return <ReportManagementSection onBack={toDashboard} />;
      default:
        return landing;
    }
  };

  return (
    <div className="min-h-screen">
      <Toaster position="top-center" richColors />
      <SmoothScroll />
      <SyncStatusBadge />
      <Navigation currentView={view} onNavigate={navigate} role={role} onLogout={handleLogout} studentId={student?.id} />
      <PushPromptModal isLoggedIn={!!role} studentId={student?.id} />
      <main>
        <Suspense fallback={<Fallback />}>
          <div key={view} className="page-enter">{renderView()}</div>
        </Suspense>
      </main>
      {view === "landing" && <FooterSection onNavigate={navigate} />}
    </div>
  );
}

function EvaluationGate({ event, onRecheck, onBack, checking }: { event: Event; onRecheck: () => void; onBack: () => void; checking: boolean }) {
  return (
    <div className="hero-bg flex min-h-screen items-center justify-center px-4 py-24">
      <div className="glass w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-white/15">
          <ClipboardCheck className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-extrabold text-white">One quick thing first</h2>
        <p className="mt-2 text-sm text-white/75">
          Please complete the evaluation for <b className="text-white">{event.name}</b> before accessing your record.
        </p>
        <a href={event.evaluationFormUrl} target="_blank" rel="noopener noreferrer" className="btn btn-light btn-lg mt-6 w-full">
          Fill out the evaluation
        </a>
        <div className="mt-3 flex justify-center gap-2">
          <button onClick={onRecheck} disabled={checking} className="btn btn-sm text-white/80 hover:bg-white/10">
            {checking ? "Checking…" : "I've submitted it — check again"}
          </button>
          <button onClick={onBack} className="btn btn-sm text-white/60 hover:bg-white/10">Back</button>
        </div>
      </div>
    </div>
  );
}

export default App;
