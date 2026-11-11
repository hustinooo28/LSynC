import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Calendar,
  Plus,
  Save,
  UserCheck,
  Pencil,
  Trash2,
  MoreVertical,
  Loader2,
} from "lucide-react";
import {
  eventsService,
  studentsService,
  contributionsService,
  boardMembersService,
  subscribeToTables,
} from "@/services/db";
import { notificationsService } from "@/services/notificationsService";
import type {
  Event,
  EventSchedule,
  EventSession,
  Student,
  UserRole,
  BoardMember,
} from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  formatDate,
  daysUntil,
  today,
  formatTimeRange,
  formatPeso,
} from "@/lib/format";
import { useSectionEntrance } from "@/hooks/useSectionEntrance";
import SectionLoader from "@/components/SectionLoader";
import Skeleton from "@/components/Skeleton";
import SectionEmptyState from "@/components/SectionEmptyState";
import SectionBackButton from "@/components/SectionBackButton";
import TimeInput12 from "@/components/TimeInput12";
import ConfirmDialog from "@/components/common/ConfirmDialog";

interface EventManagementSectionProps {
  onBack: () => void;
  role: UserRole;
  staffName: string;
  userId?: string;
}

export default function EventManagementSection({
  onBack,
  role,
}: EventManagementSectionProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [eventTotals, setEventTotals] = useState<Record<string, number>>({});
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Role-based permissions
  const canManageEvents = role === "admin" || role === "board-member";

  // Three-dot action menu
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);

  // Event form
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  // Delete confirmation dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);

  // Evaluation rollout dialog state
  const [evaluationTarget, setEvaluationTarget] = useState<Event | null>(null);
  const [evaluationFormUrlInput, setEvaluationFormUrlInput] = useState("");
  const [savingEvaluation, setSavingEvaluation] = useState(false);

  const [eventForm, setEventForm] = useState<{
    name: string;
    allocationAmount: number;
    date: string;
    contributionDeadline: string;
    schedules: EventSchedule[];
  }>({
    name: "",
    allocationAmount: 0,
    date: "",
    contributionDeadline: "",
    schedules: [],
  });

  const [scheduleToAdd, setScheduleToAdd] = useState<EventSession | "">("");
  const [eventDateTbd, setEventDateTbd] = useState(false);

  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) {
        setLoading(true);
      }

      const [eventsData, studentsData, totalsData] = await Promise.all([
        eventsService.getAll(),
        studentsService.getAll(),
        contributionsService.getTotalsByEvent(),
      ]);

      setEvents(eventsData);
      setStudents(studentsData);
      setEventTotals(totalsData);

      try {
        setBoardMembers(await boardMembersService.listBoardMembers());
      } catch (membersError) {
        console.warn("Could not load board members:", membersError);
        setBoardMembers([]);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Failed to load data");
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, []);

  // Initial read
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Live updates
  useEffect(() => {
    return subscribeToTables(
      ["events", "students", "contributions", "board_members"],
      () => loadData(false),
      "event-management",
    );
  }, [loadData]);

  useSectionEntrance(sectionRef, [
    {
      ref: contentRef,
      from: { y: "6vh", opacity: 0 },
      to: { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" },
    },
  ]);

  const addSchedule = () => {
    if (!scheduleToAdd) return;

    const alreadyExists = eventForm.schedules.some(
      (schedule) => schedule.period === scheduleToAdd,
    );

    if (alreadyExists) {
      toast.error("This schedule has already been added");
      return;
    }

    setEventForm((prev) => ({
      ...prev,
      schedules: [
        ...prev.schedules,
        {
          period: scheduleToAdd,
          timeInEnabled: true,
          timeOutEnabled: true,
          timeIn: "",
          timeOut: "",
        },
      ],
    }));

    setScheduleToAdd("");
  };

  const removeSchedule = (period: EventSession) => {
    setEventForm((prev) => ({
      ...prev,
      schedules: prev.schedules.filter(
        (schedule) => schedule.period !== period,
      ),
    }));
  };

  const updateSchedule = (
    period: EventSession,
    updates: Partial<EventSchedule>,
  ) => {
    setEventForm((prev) => ({
      ...prev,
      schedules: prev.schedules.map((schedule) =>
        schedule.period === period
          ? {
              ...schedule,
              ...updates,
            }
          : schedule,
      ),
    }));
  };

  const openAddEventModal = () => {
    setEditingEvent(null);

    setEventForm({
      name: "",
      allocationAmount: 0,
      date: "",
      contributionDeadline: "",
      schedules: [],
    });

    setEventDateTbd(false);
    setShowEventModal(true);
  };

  const handleOpenEditEvent = (event: Event) => {
    setEditingEvent(event);

    setEventForm({
      name: event.name,
      allocationAmount: event.allocationAmount,
      date: event.date && event.date !== "TBD" ? event.date : "",
      contributionDeadline: event.contributionDeadline ?? "",
      schedules: event.schedules ?? [],
    });

    setEventDateTbd(!event.date || event.date === "TBD");
    setShowEventModal(true);
  };

  const handleAddEvent = async () => {
    try {
      setSaving(true);

      const newEvent = await eventsService.create({
        name: eventForm.name,
        allocationAmount: eventForm.allocationAmount,
        date: eventDateTbd ? "TBD" : eventForm.date,
        contributionDeadline: eventForm.contributionDeadline,
        schedules: eventForm.schedules,
      });

      setEvents([...events, newEvent]);
      setShowEventModal(false);

      setEventForm({
        name: "",
        allocationAmount: 0,
        date: "",
        contributionDeadline: "",
        schedules: [],
      });

      setEventDateTbd(false);

      toast.success("Event created successfully");
    } catch (error) {
      console.error("Error creating event:", error);
      toast.error("Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateEvent = async () => {
    if (!editingEvent) return;

    try {
      setSaving(true);

      const updated = await eventsService.update(editingEvent.id, {
        name: eventForm.name,
        allocationAmount: eventForm.allocationAmount,
        date: eventDateTbd ? "TBD" : eventForm.date,
        contributionDeadline: eventForm.contributionDeadline,
        schedules: eventForm.schedules,
      });

      setEvents(events.map((e) => (e.id === editingEvent.id ? updated : e)));

      setEditingEvent(null);
      setShowEventModal(false);

      setEventForm({
        name: "",
        allocationAmount: 0,
        date: "",
        contributionDeadline: "",
        schedules: [],
      });

      setEventDateTbd(false);

      toast.success("Event updated successfully");
    } catch (error) {
      console.error("Error updating event:", error);
      toast.error("Failed to update event");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenDeleteConfirm = (event: Event) => {
    setOpenActionMenu(null);
    setEventToDelete(event);
    setShowDeleteConfirm(true);
  };

  const handleOpenEvaluationRollout = (event: Event) => {
    setOpenActionMenu(null);
    setEvaluationTarget(event);
    setEvaluationFormUrlInput(event.evaluationFormUrl ?? "");
  };

  const handleConfirmEvaluationRollout = async () => {
    if (!evaluationTarget) return;
    if (!evaluationFormUrlInput.trim()) {
      toast.error("Paste this event's evaluation Form URL first.");
      return;
    }

    try {
      setSavingEvaluation(true);

      await eventsService.update(evaluationTarget.id, {
        evaluationActive: true,
        evaluationFormUrl: evaluationFormUrlInput.trim(),
      });

      await notificationsService.sendAnnouncement({
        recipientKind: "all_students",
        title: `Evaluation open: ${evaluationTarget.name}`,
        body: "Please complete the evaluation for this event — it's required before you can access your record again.",
      });

      setEvents(
        events.map((e) =>
          e.id === evaluationTarget.id
            ? {
                ...e,
                evaluationActive: true,
                evaluationFormUrl: evaluationFormUrlInput.trim(),
              }
            : e,
        ),
      );

      setEvaluationTarget(null);
      toast.success("Evaluation rolled out and students notified");
    } catch (error) {
      console.error("Error rolling out evaluation:", error);
      toast.error("Failed to roll out evaluation");
    } finally {
      setSavingEvaluation(false);
    }
  };

  const handleStopEvaluationRollout = async (event: Event) => {
    setOpenActionMenu(null);

    try {
      await eventsService.update(event.id, { evaluationActive: false });
      setEvents(
        events.map((e) =>
          e.id === event.id ? { ...e, evaluationActive: false } : e,
        ),
      );
      toast.success("Evaluation requirement turned off");
    } catch (error) {
      console.error("Error stopping evaluation rollout:", error);
      toast.error("Failed to update event");
    }
  };

  const handleDeleteEvent = async () => {
    if (!eventToDelete) return;

    try {
      setSaving(true);

      await eventsService.delete(eventToDelete.id);

      setEvents(events.filter((e) => e.id !== eventToDelete.id));

      setEventToDelete(null);
      setShowDeleteConfirm(false);

      toast.success("Event deleted successfully");
    } catch (error) {
      console.error("Error deleting event:", error);
      toast.error("Failed to delete event");
    } finally {
      setSaving(false);
    }
  };

  // Expected collection:
  // Allocation per student × total number of students
  const expectedCollection = (event: Event) => {
    const allocation = Number(event.allocationAmount) || 0;
    const studentCount = students.length;

    return allocation * studentCount;
  };

  // Actual collection:
  // Sum of amountPaid for all contributions belonging to this event,
  // computed in Postgres via get_event_contribution_totals() rather than
  // downloading every contribution row to sum client-side.
  const collectedAmount = (event: Event) => {
    return eventTotals[event.id] ?? 0;
  };

  /** Schedule label for the events list. */
  const scheduleLabel = (event: Event): React.ReactNode => {
    if (!event.schedules || event.schedules.length === 0) {
      return "-";
    }

    return (
      <div className="flex flex-col gap-1">
        {event.schedules.map((schedule) => {
          const label =
            schedule.period === "morning"
              ? "☀ Morning"
              : schedule.period === "afternoon"
                ? "🌤 Afternoon"
                : "🌙 Evening";

          const time =
            schedule.timeIn || schedule.timeOut
              ? formatTimeRange(schedule.timeIn, schedule.timeOut)
              : "Time not set";

          return (
            <span key={schedule.period} className="whitespace-nowrap">
              {label}: {time}
            </span>
          );
        })}
      </div>
    );
  };

  // Upcoming events listed soonest first.
  const todaysISO = today();

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aTbd = !a.date || a.date === "TBD";
      const bTbd = !b.date || b.date === "TBD";

      if (aTbd && !bTbd) return 1;
      if (!aTbd && bTbd) return -1;

      if (aTbd && bTbd) {
        return a.name.localeCompare(b.name);
      }

      return (a.date ?? "").localeCompare(b.date ?? "");
    });
  }, [events]);

  return (
    <section
      ref={sectionRef}
      className="min-h-screen w-full gradient-bg-orange relative overflow-hidden py-20 lg:py-24"
    >
      {/* Content */}
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
                Event Management
              </h1>

              <p className="text-text-secondary text-sm">
                Manage events and allocations
              </p>
            </div>
          </div>

          {canManageEvents && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={openAddEventModal}
                className="btn-primary px-4 py-2.5 flex items-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Create Event</span>
              </button>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && <SectionLoader message="Loading data..." />}

        {/* Events Table */}
        {!loading && (
          <div className="glass-card p-5 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-red" />
                </div>

                <h3 className="font-display font-semibold text-lg text-dark">
                  Upcoming Events & Allocations
                </h3>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden border border-gray-200">
              <div className="overflow-x-auto">
                <table className="glass-table">
                  <thead>
                    <tr>
                      <th>Event Name</th>
                      <th>Date</th>
                      <th>Deadline</th>
                      <th>Schedule</th>
                      <th>Allocation</th>
                      <th>Expected Collection</th>
                      <th>Collected</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedEvents.map((event) => (
                      <tr key={event.id}>
                        {/* Event Name */}
                        <td className="font-medium text-dark">
                          <div className="flex items-center gap-2 flex-wrap">
                            {event.name}
                          </div>
                        </td>

                        {/* Date */}
                        <td className="text-text-secondary whitespace-nowrap">
                          {event.date && event.date !== "TBD" ? (
                            <div className="flex items-center gap-2">
                              <span>{formatDate(event.date)}</span>

                              {event.date >= todaysISO && (
                                <span
                                  className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                                    daysUntil(event.date) === 0
                                      ? "bg-red-500 text-white"
                                      : "bg-green-100 text-green-600"
                                  }`}
                                >
                                  {daysUntil(event.date) === 0
                                    ? "Today"
                                    : `In ${daysUntil(event.date)}d`}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                              TBD
                            </span>
                          )}
                        </td>

                        {/* Deadline */}
                        <td className="text-text-secondary whitespace-nowrap">
                          {event.contributionDeadline ? (
                            <div className="flex items-center gap-2">
                              <span>
                                {formatDate(event.contributionDeadline)}
                              </span>

                              <span
                                className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                                  daysUntil(event.contributionDeadline) < 0
                                    ? "bg-red-500 text-white"
                                    : daysUntil(event.contributionDeadline) ===
                                        0
                                      ? "bg-red-500 text-white"
                                      : "bg-green-100 text-green-600"
                                }`}
                              >
                                {daysUntil(event.contributionDeadline) < 0
                                  ? "Overdue"
                                  : daysUntil(event.contributionDeadline) === 0
                                    ? "Today"
                                    : `In ${daysUntil(event.contributionDeadline)}d`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-text-secondary/60">
                              No deadline
                            </span>
                          )}
                        </td>

                        {/* Schedule */}
                        <td className="text-text-secondary whitespace-nowrap">
                          {scheduleLabel(event)}
                        </td>

                        {/* Allocation */}
                        <td className="text-text-secondary whitespace-nowrap">
                          {formatPeso(event.allocationAmount)}
                        </td>

                        {/* Expected Collection */}
                        <td className="font-medium text-green-600 whitespace-nowrap">
                          {formatPeso(expectedCollection(event))}
                        </td>

                        {/* Actual Collected */}
                        <td className="font-medium text-blue-600 whitespace-nowrap">
                          {formatPeso(collectedAmount(event))}
                        </td>

                        {/* Actions */}
                        <td>
                          {canManageEvents && (
                            <div className="relative flex justify-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenActionMenu(
                                    openActionMenu === event.id
                                      ? null
                                      : event.id,
                                  )
                                }
                                className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-black/5 transition-colors"
                                title="Event actions"
                                aria-label={`Actions for ${event.name}`}
                              >
                                <MoreVertical className="w-5 h-5 text-text-secondary" />
                              </button>

                              {openActionMenu === event.id && (
                                <div className="absolute right-0 top-10 z-30 w-36 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenu(null);
                                      handleOpenEditEvent(event);
                                    }}
                                    className="w-full px-4 py-2.5 text-left text-sm text-dark hover:bg-gray-50 flex items-center gap-2"
                                  >
                                    <Pencil className="w-4 h-4" />
                                    Edit
                                  </button>

                                  {event.evaluationActive ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleStopEvaluationRollout(event)
                                      }
                                      className="w-full px-4 py-2.5 text-left text-sm text-dark hover:bg-gray-50 flex items-center gap-2"
                                    >
                                      <UserCheck className="w-4 h-4" />
                                      Turn off evaluation
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleOpenEvaluationRollout(event)
                                      }
                                      className="w-full px-4 py-2.5 text-left text-sm text-dark hover:bg-gray-50 flex items-center gap-2"
                                    >
                                      <UserCheck className="w-4 h-4" />
                                      Roll out evaluation
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenDeleteConfirm(event)
                                    }
                                    className="w-full px-4 py-2.5 text-left text-sm text-red hover:bg-red/5 flex items-center gap-2"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {events.length === 0 && (
              <SectionEmptyState message="No events found" icon={Calendar} />
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Event Modal */}
      <Dialog
        open={showEventModal || !!editingEvent}
        onOpenChange={(open) => {
          if (!open) {
            setShowEventModal(false);
            setEditingEvent(null);
            setEventDateTbd(false);
          }
        }}
      >
        <DialogContent className="glass-card-strong w-[calc(100%-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display font-bold text-xl text-dark">
              {editingEvent ? "Edit Event" : "Create New Event"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {/* Event Name */}
            <div>
              <label className="block text-sm font-medium text-dark mb-1">
                Event Name
              </label>

              <input
                type="text"
                value={eventForm.name}
                onChange={(e) =>
                  setEventForm({
                    ...eventForm,
                    name: e.target.value,
                  })
                }
                className="glass-input w-full px-4 py-2"
                placeholder="e.g., General Assembly"
              />
            </div>

            {/* Date */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-dark">
                  Date
                </label>

                <button
                  type="button"
                  onClick={() => {
                    const nextValue = !eventDateTbd;

                    setEventDateTbd(nextValue);

                    if (nextValue) {
                      setEventForm({
                        ...eventForm,
                        date: "",
                      });
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    eventDateTbd ? "bg-red" : "bg-gray-300"
                  }`}
                  aria-label="Toggle date TBD"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      eventDateTbd ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">
                  Mark date as To Be Determined
                </span>

                {eventDateTbd && (
                  <span className="text-xs font-semibold text-red">TBD</span>
                )}
              </div>

              <input
                type="date"
                value={eventForm.date}
                onChange={(e) =>
                  setEventForm({
                    ...eventForm,
                    date: e.target.value,
                  })
                }
                disabled={eventDateTbd}
                className={`glass-input w-full px-4 py-2 ${
                  eventDateTbd ? "opacity-50 cursor-not-allowed" : ""
                }`}
              />
            </div>

            {/* Contribution deadline */}
            <div>
              <label className="block text-sm font-medium text-dark mb-1">
                Contribution deadline
              </label>

              <p className="text-xs text-text-secondary mb-2">
                Last day a student's contribution counts as on-time. Leave blank
                for no deadline.
              </p>

              <input
                type="date"
                value={eventForm.contributionDeadline}
                onChange={(e) =>
                  setEventForm({
                    ...eventForm,
                    contributionDeadline: e.target.value,
                  })
                }
                className="glass-input w-full px-4 py-2"
              />
            </div>

            {/* Attendance Schedule */}
            <div className="rounded-xl border border-white/50 bg-white/30 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-dark">
                  Attendance Schedule
                </p>

                <p className="text-xs text-text-secondary mt-1">
                  Add only the sessions required for this event.
                </p>
              </div>

              <div className="flex gap-2">
                <select
                  value={scheduleToAdd}
                  onChange={(e) =>
                    setScheduleToAdd(e.target.value as EventSession | "")
                  }
                  className="glass-input flex-1 px-3 py-2"
                >
                  <option value="">Select time of day</option>
                  <option value="morning">☀ Morning</option>
                  <option value="afternoon">🌤 Afternoon</option>
                  <option value="evening">🌙 Evening</option>
                </select>

                <button
                  type="button"
                  onClick={addSchedule}
                  disabled={!scheduleToAdd}
                  className="btn-primary px-4 py-2 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>

              {eventForm.schedules.map((schedule) => (
                <div
                  key={schedule.period}
                  className="rounded-lg border border-white/50 bg-white/40 p-3 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-dark capitalize">
                      {schedule.period === "morning" && "☀ Morning"}
                      {schedule.period === "afternoon" && "🌤 Afternoon"}
                      {schedule.period === "evening" && "🌙 Evening"}
                    </p>

                    <button
                      type="button"
                      onClick={() => removeSchedule(schedule.period)}
                      className="text-xs text-red hover:underline"
                    >
                      Remove
                    </button>
                  </div>

                  {/* TIME IN */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-dark mb-2">
                      <input
                        type="checkbox"
                        checked={schedule.timeInEnabled}
                        onChange={(e) =>
                          updateSchedule(schedule.period, {
                            timeInEnabled: e.target.checked,
                            timeIn: e.target.checked ? schedule.timeIn : "",
                          })
                        }
                      />
                      Enable Time In
                    </label>

                    {schedule.timeInEnabled && (
                      <TimeInput12
                        value={schedule.timeIn ?? ""}
                        onChange={(value) =>
                          updateSchedule(schedule.period, {
                            timeIn: value,
                          })
                        }
                        ariaLabel={`${schedule.period} time in`}
                      />
                    )}
                  </div>

                  {/* TIME OUT */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-dark mb-2">
                      <input
                        type="checkbox"
                        checked={schedule.timeOutEnabled}
                        onChange={(e) =>
                          updateSchedule(schedule.period, {
                            timeOutEnabled: e.target.checked,
                            timeOut: e.target.checked ? schedule.timeOut : "",
                          })
                        }
                      />
                      Enable Time Out
                    </label>

                    {schedule.timeOutEnabled && (
                      <TimeInput12
                        value={schedule.timeOut ?? ""}
                        onChange={(value) =>
                          updateSchedule(schedule.period, {
                            timeOut: value,
                          })
                        }
                        ariaLabel={`${schedule.period} time out`}
                      />
                    )}
                  </div>
                </div>
              ))}

              {eventForm.schedules.length === 0 && (
                <div className="text-center py-4 text-sm text-text-secondary">
                  No attendance schedules added. This event will not require
                  scheduled attendance.
                </div>
              )}
            </div>

            {/* Allocation Amount */}
            <div>
              <label className="block text-sm font-medium text-dark mb-1">
                Allocation Amount (₱)
              </label>

              <input
                type="number"
                value={eventForm.allocationAmount || ""}
                onChange={(e) =>
                  setEventForm({
                    ...eventForm,
                    allocationAmount: parseInt(e.target.value) || 0,
                  })
                }
                className="glass-input w-full px-4 py-2"
                placeholder="0.00"
                min="0"
              />
            </div>

            {/* Assigned Board Members */}
            {canManageEvents && boardMembers.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-dark mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-text-secondary" />
                    Assigned Board Members
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-xl border border-white/50 p-3 bg-white/30">
                  {boardMembers.map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-2 cursor-pointer text-sm hover:text-red transition-colors"
                    >
                      <span className="truncate">{member.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  setShowEventModal(false);
                  setEditingEvent(null);
                  setEventDateTbd(false);
                }}
                className="flex-1 glass-button px-4 py-2.5"
                disabled={saving}
              >
                Cancel
              </button>

              <button
                onClick={editingEvent ? handleUpdateEvent : handleAddEvent}
                className="flex-1 btn-primary px-4 py-2.5 flex items-center justify-center gap-2"
                disabled={
                  saving ||
                  !eventForm.name ||
                  (!eventDateTbd && !eventForm.date)
                }
              >
                {saving ? (
                  <>
                    <Skeleton className="h-4 w-4 rounded-full" />
                    Saving...
                  </>
                ) : (
                  <>
                    {editingEvent ? (
                      <Save className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}

                    {editingEvent ? "Update Event" : "Create Event"}
                  </>
                )}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Evaluation Rollout Dialog */}
      <Dialog
        open={!!evaluationTarget}
        onOpenChange={(open) => {
          if (!open) setEvaluationTarget(null);
        }}
      >
        <DialogContent className="glass-card-strong w-[calc(100%-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display font-bold text-xl text-dark">
              Roll out evaluation
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <p className="text-sm text-text-secondary">
              Paste the Google Form URL for{" "}
              <span className="font-medium">{evaluationTarget?.name}</span>.
              Every student not yet recorded in this event's response Sheet will
              be required to fill it out before they can view their record, and
              all students will be notified.
            </p>

            <input
              type="url"
              value={evaluationFormUrlInput}
              onChange={(e) => setEvaluationFormUrlInput(e.target.value)}
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEvaluationTarget(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmEvaluationRollout}
                disabled={savingEvaluation}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-60 flex items-center gap-2"
              >
                {savingEvaluation && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Roll out & notify
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Event Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setEventToDelete(null);
        }}
        onConfirm={handleDeleteEvent}
        title="Delete Event"
        description={`Are you sure you want to delete ${
          eventToDelete?.name ?? "this event"
        }? This action cannot be undone.`}
        warningText="Deleting this event will also remove related payments, contributions, attendance records, and transactions."
        confirmLabel="Delete Event"
        loading={saving}
      />
    </section>
  );
}
