import { useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import Field from "@/components/ui/Field";
import { studentsService } from "@/services/db";
import { notificationsService } from "@/services/notificationsService";

interface SendNotificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Recipient = "all_students" | "all_officers" | "student";
const EMPTY = { recipient: "all_students" as Recipient, studentId: "", title: "", body: "" };

/** Staff-only compose modal — the INSERT is also gated server-side by public.is_staff(). */
export default function SendNotificationModal({ open, onOpenChange }: SendNotificationModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSend() {
    const title = form.title.trim();
    const body = form.body.trim();
    const studentId = form.studentId.trim();
    if (!title || !body) return void toast.error("Please fill in both a title and a message.");
    if (form.recipient === "student" && !studentId) return void toast.error("Enter the student's Student ID.");

    setSending(true);
    try {
      let recipientStudentId: string | undefined;
      if (form.recipient === "student") {
        const student = await studentsService.getByStudentId(studentId);
        if (!student) return void toast.error("No student found with that Student ID.");
        recipientStudentId = student.id;
      }
      await notificationsService.sendAnnouncement({ recipientKind: form.recipient, recipientStudentId, title, body });
      toast.success("Notification sent.");
      setForm(EMPTY);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to send notification:", error);
      toast.error("Failed to send notification.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Send Notification"
      icon={<BellRing className="h-5 w-5 text-brand-500" />}
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
            {sending ? "Sending…" : "Send"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Send to">
          <select className="input" value={form.recipient} onChange={(e) => set({ recipient: e.target.value as Recipient })}>
            <option value="all_students">All students</option>
            <option value="all_officers">All officers</option>
            <option value="student">A specific student</option>
          </select>
        </Field>
        {form.recipient === "student" && (
          <Field label="Student ID">
            <input
              className="input"
              value={form.studentId}
              onChange={(e) => set({ studentId: e.target.value })}
              placeholder="e.g., 2023-00123"
            />
          </Field>
        )}
        <Field label="Title">
          <input
            className="input"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g., General Assembly rescheduled"
          />
        </Field>
        <Field label="Message">
          <textarea
            className="input"
            value={form.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Write the notification message..."
          />
        </Field>
      </div>
    </Modal>
  );
}
