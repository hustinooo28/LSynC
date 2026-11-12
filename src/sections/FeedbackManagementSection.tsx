import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, EyeOff, Inbox, Lightbulb, MessageCircle, Trash2, User, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { FeedbackItem, UserRole } from "@/types";
import { feedbackService } from "@/services/db";
import { formatDate } from "@/lib/format";
import Page from "@/components/ui/Page";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { LoadingCard } from "@/components/ui/Skeleton";
import { Menu, MenuContent, MenuItem, MenuSeparator, RowActionsTrigger } from "@/components/ui/Menu";

type Type = FeedbackItem["type"];
type Status = FeedbackItem["status"];

const TYPE_META: Record<Type, { label: string; plural: string; icon: typeof Inbox; chip: string }> = {
  inquiry: { label: "Inquiry", plural: "Inquiries", icon: MessageCircle, chip: "chip-brand" },
  complaint: { label: "Complaint", plural: "Complaints", icon: AlertTriangle, chip: "chip-danger" },
  suggestion: { label: "Suggestion", plural: "Suggestions", icon: Lightbulb, chip: "chip-warning" },
};

const STATUS_META: Record<Status, { label: string; icon: typeof Inbox; chip: string }> = {
  pending: { label: "Pending", icon: Clock, chip: "chip-warning" },
  "in-progress": { label: "In Progress", icon: Wrench, chip: "chip-brand" },
  resolved: { label: "Resolved", icon: CheckCircle2, chip: "chip-success" },
};

interface FeedbackManagementSectionProps {
  onBack: () => void;
  role: UserRole | null;
}

export default function FeedbackManagementSection({ onBack, role }: FeedbackManagementSectionProps) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<Type | "">("");
  const [status, setStatus] = useState<Status | "">("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<FeedbackItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isAdmin = role === "admin"; // only the admin may triage or delete

  useEffect(() => {
    feedbackService
      .getAll()
      .then(setItems)
      .catch((error) => {
        console.error("Error loading feedback:", error);
        toast.error("Failed to load feedback");
      })
      .finally(() => setLoading(false));
  }, []);

  const changeStatus = async (id: string, next: Status) => {
    setUpdatingId(id);
    try {
      await feedbackService.updateStatus(id, next);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: next } : i)));
      toast.success(`Marked as ${STATUS_META[next].label.toLowerCase()}`);
    } catch (error) {
      console.error("Error updating feedback:", error);
      toast.error("Failed to update status");
    } finally {
      setUpdatingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await feedbackService.delete(toDelete.id);
      setItems((prev) => prev.filter((i) => i.id !== toDelete.id));
      toast.success("Feedback deleted");
    } catch (error) {
      console.error("Error deleting feedback:", error);
      toast.error("Failed to delete feedback");
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  // Type counts respect the status filter and vice versa, so each pill shows what you'd get.
  const byStatus = status ? items.filter((i) => i.status === status) : items;
  const byType = type ? items.filter((i) => i.type === type) : items;
  const filtered = type ? byStatus.filter((i) => i.type === type) : byStatus;

  return (
    <Page
      eyebrow="Student voice"
      title="Feedback Inbox"
      subtitle="All complaints, inquiries, and suggestions from students"
      onBack={onBack}
    >
      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills
          value={type}
          onChange={setType}
          options={[
            { value: "", label: "All", icon: Inbox, count: byStatus.length },
            ...(Object.keys(TYPE_META) as Type[]).map((t) => ({
              value: t,
              label: TYPE_META[t].plural,
              icon: TYPE_META[t].icon,
              count: byStatus.filter((i) => i.type === t).length,
            })),
          ]}
        />
        <FilterPills
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "Any status", count: byType.length },
            ...(Object.keys(STATUS_META) as Status[]).map((s) => ({
              value: s,
              label: STATUS_META[s].label,
              count: byType.filter((i) => i.status === s).length,
            })),
          ]}
        />
      </div>

      {loading ? (
        <LoadingCard label="Loading feedback…" />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={Inbox} title="No feedback found" description="Try a different filter." />
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              updating={updatingId === item.id}
              onStatusChange={(s) => changeStatus(item.id, s)}
              onDelete={() => setToDelete(item)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete Feedback"
        description="Are you sure you want to delete this feedback? This cannot be undone."
        confirmLabel="Delete Feedback"
      />
    </Page>
  );
}

interface PillOption<V> {
  value: V;
  label: string;
  icon?: typeof Inbox;
  count: number;
}

function FilterPills<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: PillOption<V>[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(({ value: v, label, icon: Icon, count }) => {
        const active = v === value;
        return (
          <button
            key={v || "all"}
            onClick={() => onChange(v)}
            aria-pressed={active}
            className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {label}
            <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-surface-2"}`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

interface FeedbackCardProps {
  item: FeedbackItem;
  isAdmin: boolean;
  updating: boolean;
  onStatusChange: (status: Status) => void;
  onDelete: () => void;
}

function FeedbackCard({ item, isAdmin, updating, onStatusChange, onDelete }: FeedbackCardProps) {
  const type = TYPE_META[item.type];
  const status = STATUS_META[item.status];

  return (
    <article className={`card card-hover p-5 lg:p-6 ${updating ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className={`chip ${type.chip}`}>
            <type.icon className="h-3.5 w-3.5" /> {type.label}
          </span>
          <span className={`chip ${status.chip}`}>{status.label}</span>
          <span className="text-xs text-muted">{formatDate(item.submittedAt)}</span>
        </div>
        {isAdmin ? (
          <Menu>
            <RowActionsTrigger label="Feedback actions" />
            <MenuContent>
              {(Object.keys(STATUS_META) as Status[]).map((s) => {
                const Icon = STATUS_META[s].icon;
                return (
                  <MenuItem key={s} disabled={updating || s === item.status} onSelect={() => onStatusChange(s)}>
                    <Icon /> Mark {STATUS_META[s].label.toLowerCase()}
                  </MenuItem>
                );
              })}
              <MenuSeparator />
              <MenuItem danger onSelect={onDelete}>
                <Trash2 /> Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : (
          <span className="max-w-[10rem] text-right text-xs text-muted">Status controlled by the Administrator</span>
        )}
      </div>

      {item.title && <h3 className="mt-3 text-lg">{item.title}</h3>}
      <p className="mt-1 whitespace-pre-line text-sm text-muted">{item.message}</p>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted">
        {item.isAnonymous ? (
          <span className="flex items-center gap-1">
            <EyeOff className="h-3.5 w-3.5" /> Anonymous
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" /> {item.studentName || "Unknown"}
            </span>
            {item.studentId && <span>{item.studentId}</span>}
          </>
        )}
      </div>
    </article>
  );
}
