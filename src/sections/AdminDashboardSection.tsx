import { useEffect, useRef, useState, useCallback } from "react";
import {
  Users,
  Wallet,
  TrendingUp,
  TrendingDown,
  PieChart,
  UserCog,
  Calendar,
  CreditCard,
  FileText,
  ArrowRight,
  MessageSquare,
  Coins,
} from "lucide-react";
import { today, daysUntil, formatPeso } from "@/lib/format";
import { useSectionEntrance } from "@/hooks/useSectionEntrance";
import SectionLoader from "@/components/SectionLoader";
import type {
  ViewState,
  FinancialSummary,
  FinancialReport,
  Transaction,
  Event,
  UserRole,
} from "@/types";
import {
  financialReportingService,
  studentsService,
  eventsService,
  feedbackService,
  transactionsService,
  subscribeToTables,
} from "@/services/db";
import { toast } from "sonner";

interface AdminDashboardSectionProps {
  onNavigate: (view: ViewState) => void;
  onLogout: () => void;
  role: UserRole;
  userEmail: string;
  userId?: string;
}

export default function AdminDashboardSection({
  onNavigate,
  role,
  userEmail,
}: AdminDashboardSectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [financialSummary, setFinancialSummary] =
    useState<FinancialSummary | null>(null);

  const [eventPerformance, setEventPerformance] = useState<
    FinancialReport["eventAllocations"]
  >([]);

  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>(
    [],
  );

  const [studentCount, setStudentCount] = useState(0);
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      const [
        financialReport,
        studentsData,
        eventsData,
        pendingFeedbackData,
        transactionsData,
      ] = await Promise.all([
        financialReportingService.getReport(),
        studentsService.getAll(),
        eventsService.getAll(),
        feedbackService.getByStatus("pending"),
        transactionsService.getAll(),
      ]);

      // Financial report
      setFinancialSummary(financialReport.summary);
      setEventPerformance(financialReport.eventAllocations ?? []);

      // Transactions
      setRecentTransactions(transactionsData.slice(0, 5));

      // Students
      setStudentCount(studentsData.length);

      // Feedback
      setPendingFeedbackCount(pendingFeedbackData.length);

      // Upcoming events
      const todays = today();

      const upcoming = eventsData
        .filter((e) => e.date && e.date >= todays)
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

      setUpcomingEvents(upcoming);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data from database
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Re-query every source table on change
  useEffect(() => {
    return subscribeToTables(
      [
        "students",
        "events",
        "contributions",
        "payments",
        "transactions",
        "feedback",
        "board_members",
      ],
      loadDashboardData,
      "dashboard",
    );
  }, [loadDashboardData]);

  useSectionEntrance(sectionRef, [
    // Headline entrance
    {
      ref: headlineRef,
      from: { x: "-30vw", opacity: 0 },
      to: { x: 0, opacity: 1, duration: 0.7 },
    },

    // Summary cards entrance
    {
      ref: summaryRef,
      selector: ".summary-card",
      from: { y: "-20vh", opacity: 0 },
      to: { y: 0, opacity: 1, duration: 0.6, stagger: 0.05 },
      position: "-=0.4",
    },

    // Quick actions entrance
    {
      ref: actionsRef,
      selector: ".action-card",
      from: { y: "30vh", opacity: 0 },
      to: { y: 0, opacity: 1, duration: 0.6, stagger: 0.06 },
      position: "-=0.3",
    },
  ]);

  const summaryCards = [
    {
      label: "Total Students",
      value: studentCount.toString(),
      icon: Users,
      color: "blue",
      suffix: "",
    },
    {
      label: "Expected Contributions",
      value: formatPeso(financialSummary?.totalExpectedContributions ?? 0),
      icon: Wallet,
      color: "purple",
      suffix: "",
    },
    {
      label: "Funds Collected",
      value: formatPeso(financialSummary?.totalFundsCollected ?? 0),
      icon: TrendingUp,
      color: "green",
      suffix: "",
    },
    {
      label: "Funds Spent",
      value: formatPeso(financialSummary?.totalFundsSpent ?? 0),
      icon: TrendingDown,
      color: "red",
      suffix: "",
    },
    {
      label: "Remaining Budget",
      value: formatPeso(financialSummary?.remainingBudget ?? 0),
      icon: PieChart,
      color: "yellow",
      suffix: "",
    },
  ];

  const quickActions = [
    ...(role === "admin"
      ? [
          {
            title: "Student Management",
            description: "Add, edit, or remove student records",
            icon: UserCog,
            view: "student-management" as ViewState,
            color: "blue",
          },
        ]
      : []),

    ...(role === "admin"
      ? [
          {
            title: "Council Sharing Files",
            description: "Upload and manage student requirement documents",
            icon: FileText,
            view: "requirement-files-management" as ViewState,
            color: "green",
          },
        ]
      : []),

    ...(role === "admin" || role === "secretary"
      ? [
          {
            title: "Reports",
            description: "View and download attendance reports",
            icon: FileText,
            view: "report-management" as ViewState,
            color: "yellow",
          },
        ]
      : []),

    ...(role === "admin" || role === "treasurer"
      ? [
          {
            title: "Event Management",
            description: "Create events and manage allocations",
            icon: Calendar,
            view: "event-management" as ViewState,
            color: "green",
          },
        ]
      : []),

    ...(role === "board-member"
      ? [
          {
            title: "Events",
            description: "View upcoming events",
            icon: Calendar,
            view: "event-management" as ViewState,
            color: "green",
          },
        ]
      : []),

    ...(role === "admin" || role === "secretary"
      ? [
          {
            title: "Attendance Tracking",
            description: "Record attendance for every event",
            icon: Users,
            view: "attendance-management" as ViewState,
            color: "green",
          },
        ]
      : []),

    ...(role === "admin" || role === "treasurer" || role === "auditor"
      ? [
          {
            title: "Payment Records",
            description: "Record and track student payments",
            icon: CreditCard,
            view: "payment-management" as ViewState,
            color: "purple",
          },
          {
            title: "Transaction Ledger",
            description: "Manage income and expenses with auto receipts",
            icon: FileText,
            view: "transaction-management" as ViewState,
            color: "yellow",
          },
          {
            title: "Contribution Records",
            description: "Add, edit, or remove student contributions",
            icon: Coins,
            view: "contribution-management" as ViewState,
            color: "blue",
          },
        ]
      : []),

    ...(role === "board-member"
      ? [
          {
            title: "Transparency Board",
            description: "View the council financial report",
            icon: FileText,
            view: "transparency" as ViewState,
            color: "blue",
          },
        ]
      : []),

    {
      title: "Feedback Inbox",
      description: "View all complaints, inquiries, and suggestions",
      icon: MessageSquare,
      view: "feedback-management" as ViewState,
      color: "purple",
    },
  ];

  return (
    <section
      ref={sectionRef}
      className="min-h-screen w-full gradient-bg-orange relative overflow-hidden py-20 lg:py-24"
    >
      {/* Content */}
      <div className="relative z-10 w-full px-4 sm:px-6 lg:px-8 xl:px-12">
        {/* Header */}
        <div
          ref={headlineRef}
          className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6"
        >
          <div>
            <h1 className="font-display font-bold text-3xl lg:text-4xl text-dark mb-2">
              Admin Dashboard
            </h1>

            <div className="mt-3 flex items-center gap-3">
              <img
                src="/DSSC-logo.png"
                alt="DSSC logo"
                className="h-12 w-12 rounded-full border-2 border-lsc-gold/60 bg-white object-contain p-1"
              />

              <p className="text-text-secondary">
                {userEmail} — your council{" "}
                {
                  {
                    admin: "operations",
                    secretary: "attendance",
                    treasurer: "finance",
                    auditor: "finance & audit",
                    "board-member": "events",
                  }[role]
                }{" "}
                overview.
              </p>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <SectionLoader message="Loading dashboard data..." variant="dashboard" />
        )}

        {!loading && (
          <>
            {/* Council Overview */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 mb-10">
              {/* Council Overview Card */}
              <div
                ref={summaryRef}
                className="summary-card glass-card p-5 lg:p-5"
              >
                <div className="mb-4">
                  <h2 className="font-display font-semibold text-lg text-dark">
                    Council Overview
                  </h2>

                  <p className="text-xs text-text-secondary mt-1">
                    Current financial and membership summary
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                  {summaryCards.map((card, index) => (
                    <div key={index} className="min-w-0">
                      <p className="font-display font-bold text-2xl sm:text-2xl lg:text-3xl text-dark leading-none tracking-tight truncate">
                        {card.value}
                        {card.suffix}
                      </p>

                      <p className="text-[10px] sm:text-[11px] text-text-secondary uppercase tracking-wider mt-2 truncate">
                        {card.label}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-6 border-t border-dark/5">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Upcoming Events Count */}
                    <div>
                      <p className="font-display font-bold text-2xl lg:text-3xl text-dark leading-none">
                        {upcomingEvents.length}
                      </p>

                      <p className="text-[10px] sm:text-[11px] text-text-secondary uppercase tracking-wider mt-2">
                        Upcoming Events
                      </p>
                    </div>

                    {/* Pending Feedback Count */}
                    <div>
                      <p className="font-display font-bold text-2xl lg:text-3xl text-dark leading-none">
                        {pendingFeedbackCount}
                      </p>

                      <p className="text-[10px] sm:text-[11px] text-text-secondary uppercase tracking-wider mt-2">
                        Pending Feedback
                      </p>
                    </div>
                  </div>
                </div>

                {/* Upcoming Events */}
                <div className="mt-6 pt-5 border-t border-dark/5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-display font-semibold text-sm text-dark">
                        Upcoming Events
                      </h3>

                      <p className="text-[10px] text-text-secondary mt-0.5">
                        Scheduled council activities
                      </p>
                    </div>

                    {(role === "admin" || role === "treasurer") && (
                      <button
                        onClick={() => onNavigate("event-management")}
                        className="inline-flex items-center gap-1 text-xs text-royal-blue hover:gap-2 transition-all flex-shrink-0"
                      >
                        Manage
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {upcomingEvents.length === 0 ? (
                    <div className="rounded-lg bg-white/30 p-5 text-center text-text-secondary">
                      <p className="text-xs">
                        {role === "board-member"
                          ? "No events assigned to you yet"
                          : "No upcoming events scheduled"}
                      </p>
                    </div>
                  ) : (
                    <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2">
                      {upcomingEvents.map((event) => {
                        const days = daysUntil(event.date || "");

                        return (
                          <div
                            key={event.id}
                            className="rounded-lg bg-white/35 px-3 py-3 flex items-center justify-between gap-3 hover:bg-white/50 transition-colors"
                          >
                            <div className="min-w-0">
                              <h4 className="font-display font-semibold text-sm text-dark truncate">
                                {event.name}
                              </h4>

                              <p className="text-[11px] text-text-secondary mt-1">
                                {event.date
                                  ? new Date(event.date).toLocaleDateString(
                                      "en-US",
                                      {
                                        weekday: "short",
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                      },
                                    )
                                  : "Date not set"}
                              </p>

                              <p className="text-[10px] text-text-secondary mt-1">
                                Allocation:{" "}
                                <span className="font-medium text-dark">
                                  ₱{event.allocationAmount.toLocaleString()}
                                </span>
                              </p>
                            </div>

                            <span
                              className={`text-[10px] px-2 py-1 rounded-full font-medium flex-shrink-0 ${
                                days === 0
                                  ? "bg-red-500 text-white"
                                  : days > 0
                                    ? "bg-green-100 text-green-600"
                                    : "bg-red/10 text-red-500"
                              }`}
                            >
                              {days === 0
                                ? "Today"
                                : days > 0
                                  ? `${days}d`
                                  : "Over"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="glass-card p-4 lg:p-5">
                <div className="mb-3">
                  <h2 className="font-display font-semibold text-lg text-dark">
                    Quick Actions
                  </h2>

                  <p className="text-xs text-text-secondary mt-1">
                    Access council management tools
                  </p>
                </div>

                <div ref={actionsRef} className="flex flex-col">
                  {quickActions.map((action, index) => {
                    const Icon = action.icon;

                    return (
                      <button
                        key={index}
                        onClick={() => onNavigate(action.view)}
                        className="action-card group w-full flex items-center gap-3 py-3 px-2 text-left border-b border-dark/5 last:border-b-0 hover:bg-white/40 transition-all duration-200"
                      >
                        {/* Icon */}
                        <div
                          className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${
                            action.color === "blue"
                              ? "bg-blue-100 text-blue-600"
                              : action.color === "green"
                                ? "bg-green-100 text-green-600"
                                : action.color === "purple"
                                  ? "bg-purple-100 text-purple-600"
                                  : "bg-yellow-100 text-yellow-600"
                          }`}
                        >
                          <Icon className="w-5 h-5" />
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display font-semibold text-sm text-dark truncate">
                            {action.title}
                          </h3>

                          <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">
                            {action.description}
                          </p>
                        </div>

                        {/* Arrow */}
                        <ArrowRight className="w-4 h-4 flex-shrink-0 text-text-secondary/40 group-hover:text-royal-blue group-hover:translate-x-1 transition-all" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Event Collection Performance + Recent Transactions */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Event Collection Performance */}
              <div className="glass-card p-4 lg:p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h2 className="font-display font-semibold text-lg text-dark">
                      Event Collection Performance
                    </h2>

                    <p className="text-xs text-text-secondary mt-1">
                      Collection progress based on event allocation targets
                    </p>
                  </div>

                  {(role === "admin" ||
                    role === "treasurer" ||
                    role === "board-member") && (
                    <button
                      onClick={() => onNavigate("event-management")}
                      className="inline-flex items-center gap-1 text-xs text-royal-blue hover:gap-2 transition-all flex-shrink-0"
                    >
                      View All
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {eventPerformance.length === 0 ? (
                  <div className="rounded-lg bg-white/30 p-5 text-center text-text-secondary">
                    <p className="text-xs">
                      No event collection data available.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {eventPerformance.slice(0, 5).map((event) => {
                      const expected =
                        Number(event.allocationAmount ?? 0) * studentCount;

                      const collected = Number(event.totalCollected ?? 0);

                      const progress =
                        expected > 0
                          ? Math.min((collected / expected) * 100, 100)
                          : 0;

                      return (
                        <div
                          key={event.eventId ?? event.eventId}
                          className="rounded-lg bg-white/35 px-3 py-2.5 hover:bg-white/50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <h4 className="font-display font-semibold text-sm text-dark truncate">
                                {event.eventName}
                              </h4>

                              <p className="text-[10px] text-text-secondary mt-0.5">
                                {formatPeso(collected)} / {formatPeso(expected)}
                              </p>
                            </div>

                            <span className="text-[11px] font-display font-bold text-dark flex-shrink-0">
                              {Math.round(progress)}%
                            </span>
                          </div>

                          <div className="mt-2 h-1.5 w-full rounded-full bg-dark/5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-500 transition-all duration-500"
                              style={{
                                width: `${progress}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Transactions */}
              {(role === "admin" ||
                role === "treasurer" ||
                role === "auditor") && (
                <div className="glass-card p-4 lg:p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h2 className="font-display font-semibold text-lg text-dark">
                        Recent Transactions
                      </h2>

                      <p className="text-xs text-text-secondary mt-1">
                        Latest income and expense records
                      </p>
                    </div>

                    <button
                      onClick={() => onNavigate("transaction-management")}
                      className="inline-flex items-center gap-1 text-xs text-royal-blue hover:gap-2 transition-all flex-shrink-0"
                    >
                      View All
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {recentTransactions.length === 0 ? (
                    <div className="rounded-lg bg-white/30 p-5 text-center text-text-secondary">
                      <p className="text-xs">No transactions recorded yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recentTransactions.map((transaction) => {
                        const isIncome =
                          String(transaction.type).toLowerCase() === "income";

                        const Icon = isIncome ? TrendingUp : TrendingDown;

                        const amount = Math.abs(
                          Number(transaction.amount) || 0,
                        );

                        const transactionType = isIncome ? "Income" : "Expense";

                        const description =
                          transaction.description ||
                          transaction.type ||
                          "Transaction";

                        return (
                          <div
                            key={transaction.id}
                            className="rounded-lg bg-white/35 px-3 py-2.5 flex items-center gap-3 hover:bg-white/50 transition-colors"
                          >
                            <div
                              className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center ${
                                isIncome
                                  ? "bg-green-100 text-green-600"
                                  : "bg-red-100 text-red-600"
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="font-display font-semibold text-sm text-dark truncate">
                                {description}
                              </p>

                              <p className="text-[10px] text-text-secondary mt-0.5 truncate">
                                {transactionType}{" "}
                                <span className="mx-1">•</span>
                                {transaction.date
                                  ? new Date(
                                      transaction.date,
                                    ).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })
                                  : "No date"}
                              </p>
                            </div>

                            <span
                              className={`text-sm font-display font-semibold flex-shrink-0 ${
                                isIncome ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              {isIncome ? "+" : "-"}
                              {formatPeso(amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
