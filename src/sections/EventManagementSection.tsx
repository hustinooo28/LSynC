import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Calendar, CalendarClock, ClipboardCheck, Clock, CloudSun, Moon, Pencil, Plus, Sun, Trash2, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { eventsService, studentsService, contributionsService, subscribeToTables } from "@/services/db";
import { notificationsService } from "@/services/notificationsService";
import type { Event, EventSchedule, EventSession, UserRole } from "@/types";
import { formatDate, daysUntil, formatTimeRange, formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";
import Page from "@/components/ui/Page";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Field from "@/components/ui/Field";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { Menu, MenuContent, MenuItem, MenuSeparator, RowActionsTrigger } from "@/components/ui/Menu";
import TimeInput12 from "@/components/TimeInput12";

interface EventManagementSectionProps {
  onBack: () => void;
  role: UserRole;
}

const SESSIONS: Record<EventSession, { label: string; icon: LucideIcon }> = {
  morning: { label: "Morning", icon: Sun },
  afternoon: { label: "Afternoon", icon: CloudSun },
  evening: { label: "Evening", icon: Moon },
};

type EventForm = {
  name: string;
  allocationAmount: number;
  date: string;
  tbd: boolean;
  contributionDeadline: string;
  schedules: EventSchedule[];
};

const EMPTY_FORM: EventForm = { name: "", allocationAmount: 0, date: "", tbd: false, contributionDeadline: "", schedules: [] };

const isTbd = (e: Event) => !e.date || e.date === "TBD";

/** "Today" / "In 3d" / "Overdue" style chip for a date relative to now. */
function dueChip(date: string, pastLabel: string) {
  const d = daysUntil(date);
  if (d < 0) return { label: pastLabel, tone: pastLabel === "Overdue" ? "chip-danger" : "chip-neutral" };
  if (d === 0) return { label: "Today", tone: "chip-danger" };
  return { label: `In ${d}d`, tone: d <= 7 ? "chip-warning" : "chip-success" };
}

export default function EventManagementSection({ onBack, role }: EventManagementSectionProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [collected, setCollected] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // `editing`: null = closed, "new" = create, Event = edit.
  const [editing, setEditing] = useState<Event | "new" | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const [sessionToAdd, setSessionToAdd] = useState<EventSession | "">("");
  const [toDelete, setToDelete] = useState<Event | null>(null);
  const [evaluating, setEvaluating] = useState<Event | null>(null);
  const [formUrl, setFormUrl] = useState("");

  const canManage = role === "admin" || role === "board-member";

  const loadData = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const [eventsData, students, totals] = await Promise.all([
        eventsService.getAll(),
        studentsService.getAll(),
        contributionsService.getTotalsByEvent(),
      ]);
      setEvents(eventsData);
      setStudentCount(students.length);
      setCollected(totals);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Failed to load data");
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    return subscribeToTables(["events", "students", "contributions"], () => loadData(false), "event-management");
  }, [loadData]);

  // Dated events soonest first, then TBD events alphabetically.
  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) =>
        isTbd(a) !== isTbd(b) ? (isTbd(a) ? 1 : -1) : isTbd(a) ? a.name.localeCompare(b.name) : a.date!.localeCompare(b.date!),
      ),
    [events],
  );

  const replaceEvent = (id: string, patch: Partial<Event>) => setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const patchForm = (patch: Partial<EventForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const updateSchedule = (period: EventSession, patch: Partial<EventSchedule>) =>
    patchForm({ schedules: form.schedules.map((s) => (s.period === period ? { ...s, ...patch } : s)) });

  const openForm = (event?: Event) => {
    setEditing(event ?? "new");
    setSessionToAdd("");
    setForm(
      event
        ? {
            name: event.name,
            allocationAmount: event.allocationAmount,
            date: isTbd(event) ? "" : event.date!,
            tbd: isTbd(event),
            contributionDeadline: event.contributionDeadline ?? "",
            schedules: event.schedules ?? [],
          }
        : EMPTY_FORM,
    );
  };

  const addSession = () => {
    if (!sessionToAdd) return;
    if (form.schedules.some((s) => s.period === sessionToAdd)) return void toast.error("This schedule has already been added");
    patchForm({ schedules: [...form.schedules, { period: sessionToAdd, timeInEnabled: true, timeOutEnabled: true, timeIn: "", timeOut: "" }] });
    setSessionToAdd("");
  };

  const saveEvent = async () => {
    if (!editing) return;
    const { tbd, ...rest } = form;
    const payload = { ...rest, date: tbd ? "TBD" : form.date };
    setSaving(true);
    try {
      if (editing === "new") {
        const created = await eventsService.create(payload);
        setEvents((prev) => [...prev, created]);
      } else {
        const updated = await eventsService.update(editing.id, payload);
        replaceEvent(editing.id, updated);
      }
      toast.success(`Event ${editing === "new" ? "created" : "updated"} successfully`);
      setEditing(null);
    } catch (error) {
      console.error("Error saving event:", error);
      toast.error(`Failed to ${editing === "new" ? "create" : "update"} event`);
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async () => {
    if (!toDelete) return;
    setSaving(true);
    try {
      await eventsService.delete(toDelete.id);
      setEvents((prev) => prev.filter((e) => e.id !== toDelete.id));
      setToDelete(null);
      toast.success("Event deleted successfully");
    } catch (error) {
      console.error("Error deleting event:", error);
      toast.error("Failed to delete event");
    } finally {
      setSaving(false);
    }
  };

  const rollOutEvaluation = async () => {
    if (!evaluating) return;
    const url = formUrl.trim();
    if (!url) return void toast.error("Paste this event's evaluation Form URL first.");
    setSaving(true);
    try {
      await eventsService.update(evaluating.id, { evaluationActive: true, evaluationFormUrl: url });
      await notificationsService.sendAnnouncement({
        recipientKind: "all_students",
        title: `Evaluation open: ${evaluating.name}`,
        body: "Please complete the evaluation for this event — it's required before you can access your record again.",
      });
      replaceEvent(evaluating.id, { evaluationActive: true, evaluationFormUrl: url });
      setEvaluating(null);
      toast.success("Evaluation rolled out and students notified");
    } catch (error) {
      console.error("Error rolling out evaluation:", error);
      toast.error("Failed to roll out evaluation");
    } finally {
      setSaving(false);
    }
  };

  const stopEvaluation = async (event: Event) => {
    try {
      await eventsService.update(event.id, { evaluationActive: false });
      replaceEvent(event.id, { evaluationActive: false });
      toast.success("Evaluation requirement turned off");
    } catch (error) {
      console.error("Error stopping evaluation rollout:", error);
      toast.error("Failed to update event");
    }
  };

  const upcoming = events.filter((e) => !isTbd(e) && daysUntil(e.date!) >= 0).length;
  const totalCollected = Object.values(collected).reduce((sum, n) => sum + n, 0);

  return (
    <Page
      eyebrow="Events"
      title="Event Management"
      subtitle="Plan events, attendance sessions and per-student allocations."
      onBack={onBack}
      actions={
        canManage && (
          <button onClick={() => openForm()} className="btn btn-primary">
            <Plus className="h-4 w-4" /> Create event
          </button>
        )
      }
      hero={
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard featured label="Total events" value={events.length} icon={Calendar} />
          <StatCard label="Upcoming" value={upcoming} icon={CalendarClock} tone="warning" />
          <StatCard label="Students" value={studentCount} icon={Users} />
          <StatCard label="Collected" value={formatPeso(totalCollected)} icon={Wallet} tone="success" />
        </div>
      }
    >
      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-3xl" />
          ))}
        </div>
      ) : sortedEvents.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Calendar}
            title="No events yet"
            description="Create an event to start tracking attendance and contributions."
            action={canManage && <button onClick={() => openForm()} className="btn btn-primary btn-sm"><Plus className="h-4 w-4" /> Create event</button>}
          />
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {sortedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              expected={(Number(event.allocationAmount) || 0) * studentCount}
              collected={collected[event.id] ?? 0}
              actions={
                canManage && (
                  <Menu>
                    <RowActionsTrigger label={`Actions for ${event.name}`} />
                    <MenuContent>
                      <MenuItem onSelect={() => openForm(event)}><Pencil /> Edit</MenuItem>
                      {event.evaluationActive ? (
                        <MenuItem onSelect={() => stopEvaluation(event)}><ClipboardCheck /> Turn off evaluation</MenuItem>
                      ) : (
                        <MenuItem onSelect={() => { setEvaluating(event); setFormUrl(event.evaluationFormUrl ?? ""); }}>
                          <ClipboardCheck /> Roll out evaluation
                        </MenuItem>
                      )}
                      <MenuSeparator />
                      <MenuItem danger onSelect={() => setToDelete(event)}><Trash2 /> Delete</MenuItem>
                    </MenuContent>
                  </Menu>
                )
              }
            />
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="lg"
        icon={<Calendar className="h-5 w-5 text-brand-500" />}
        title={editing === "new" ? "Create event" : "Edit event"}
        description="Sessions define which attendance scans this event expects."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEvent} disabled={saving || !form.name.trim() || (!form.tbd && !form.date)}>
              {saving ? "Saving…" : editing === "new" ? "Create event" : "Save changes"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Event name">
            <input className="input" value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder="e.g., General Assembly" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <span className="label">Date</span>
                <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted">
                  <input type="checkbox" className="accent-brand-500" checked={form.tbd} onChange={(e) => patchForm({ tbd: e.target.checked, date: "" })} />
                  To be determined
                </label>
              </div>
              <input type="date" className="input" value={form.date} disabled={form.tbd} onChange={(e) => patchForm({ date: e.target.value })} />
            </div>
            <Field label="Contribution deadline" hint="Last on-time day. Blank = no deadline.">
              <input type="date" className="input" value={form.contributionDeadline} onChange={(e) => patchForm({ contributionDeadline: e.target.value })} />
            </Field>
          </div>

          <Field label="Allocation per student (₱)">
            <input
              type="number"
              min={0}
              className="input"
              placeholder="0"
              value={form.allocationAmount || ""}
              onChange={(e) => patchForm({ allocationAmount: parseInt(e.target.value) || 0 })}
            />
          </Field>

          <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
            <div>
              <p className="text-sm font-semibold text-ink">Attendance schedule</p>
              <p className="text-xs text-muted">Add only the sessions required for this event.</p>
            </div>
            <div className="flex gap-2">
              <select className="input flex-1" value={sessionToAdd} onChange={(e) => setSessionToAdd(e.target.value as EventSession | "")}>
                <option value="">Select time of day</option>
                {Object.entries(SESSIONS).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary h-11" onClick={addSession} disabled={!sessionToAdd}>
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            {form.schedules.map((s) => {
              const { label, icon: Icon } = SESSIONS[s.period];
              return (
                <div key={s.period} className="space-y-3 rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-brand-500" /> {label}</p>
                    <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => patchForm({ schedules: form.schedules.filter((x) => x.period !== s.period) })}>
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["In", "Out"] as const).map((dir) => {
                      const enabledKey = `time${dir}Enabled` as const;
                      const timeKey = `time${dir}` as const;
                      return (
                        <div key={dir}>
                          <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
                            <input
                              type="checkbox"
                              className="accent-brand-500"
                              checked={s[enabledKey]}
                              onChange={(e) => updateSchedule(s.period, { [enabledKey]: e.target.checked, [timeKey]: e.target.checked ? s[timeKey] : "" })}
                            />
                            Time {dir.toLowerCase()}
                          </label>
                          {s[enabledKey] && (
                            <TimeInput12 value={s[timeKey] ?? ""} onChange={(v) => updateSchedule(s.period, { [timeKey]: v })} ariaLabel={`${s.period} time ${dir.toLowerCase()}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {form.schedules.length === 0 && (
              <p className="py-2 text-center text-xs text-muted">No sessions added — this event won't require scheduled attendance.</p>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!evaluating}
        onClose={() => setEvaluating(null)}
        icon={<ClipboardCheck className="h-5 w-5 text-brand-500" />}
        title="Roll out evaluation"
        description={
          <>
            Paste the Google Form URL for <b className="text-ink">{evaluating?.name}</b>. Every student not yet in this event's response Sheet must
            fill it out before viewing their record, and all students will be notified.
          </>
        }
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEvaluating(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={rollOutEvaluation} disabled={saving}>{saving ? "Rolling out…" : "Roll out & notify"}</button>
          </>
        }
      >
        <Field label="Evaluation form URL">
          <input type="url" className="input" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="https://docs.google.com/forms/d/e/.../viewform" />
        </Field>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={deleteEvent}
        loading={saving}
        title="Delete event"
        confirmLabel="Delete event"
        description={
          <>
            Delete <b className="text-ink">{toDelete?.name}</b>? This also removes related payments, contributions, attendance records and
            transactions, and cannot be undone.
          </>
        }
      />
    </Page>
  );
}

function EventCard({ event, expected, collected, actions }: { event: Event; expected: number; collected: number; actions: React.ReactNode }) {
  const tbd = isTbd(event);
  const date = tbd ? null : new Date(event.date!);
  const status = tbd ? { label: "Date TBD", tone: "chip-warning" } : dueChip(event.date!, "Done");
  const deadline = event.contributionDeadline ? dueChip(event.contributionDeadline, "Overdue") : null;
  const pct = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;

  return (
    <article className="card card-hover flex flex-col p-5">
      <div className="flex items-start gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-500/10 text-center leading-none text-brand-600">
          {date ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider">{date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</p>
              <p className="mt-0.5 text-xl font-extrabold">{date.getUTCDate()}</p>
            </div>
          ) : (
            <p className="text-xs font-bold">TBD</p>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold text-ink" title={event.name}>{event.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={cn("chip", status.tone)}>{status.label}</span>
            {event.evaluationActive && <span className="chip chip-brand"><ClipboardCheck className="h-3 w-3" /> Evaluation open</span>}
          </div>
        </div>
        {actions}
      </div>

      <dl className="mt-5 space-y-2.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Contribution deadline</dt>
          <dd className="flex items-center gap-1.5 text-right text-ink">
            {deadline ? (
              <>
                {formatDate(event.contributionDeadline!)} <span className={cn("chip", deadline.tone)}>{deadline.label}</span>
              </>
            ) : (
              <span className="text-muted">None</span>
            )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted">Sessions</dt>
          <dd className="space-y-1 text-right">
            {event.schedules?.length ? (
              event.schedules.map((s) => {
                const { label, icon: Icon } = SESSIONS[s.period];
                return (
                  <p key={s.period} className="flex items-center justify-end gap-1.5 whitespace-nowrap text-ink">
                    <Icon className="h-3.5 w-3.5 text-brand-500" aria-label={label} />
                    {s.timeIn || s.timeOut ? formatTimeRange(s.timeIn, s.timeOut) : <span className="text-muted">{label} · time not set</span>}
                  </p>
                );
              })
            ) : (
              <span className="flex items-center gap-1.5 text-muted"><Clock className="h-3.5 w-3.5" /> No sessions</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-auto pt-5">
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">Collected</p>
              <p className="text-lg font-extrabold text-ink">{formatPeso(collected)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">{formatPeso(event.allocationAmount)} / student</p>
              <p className="text-xs font-semibold text-muted">of {formatPeso(expected)}</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-indigo-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </article>
  );
}
