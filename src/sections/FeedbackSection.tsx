import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, EyeOff, Lightbulb, MessageCircle, Send, Shield, User } from "lucide-react";
import { toast } from "sonner";
import type { FeedbackItem, ViewState } from "@/types";
import { feedbackService } from "@/services/db";
import Page from "@/components/ui/Page";
import Field from "@/components/ui/Field";

type FeedbackType = FeedbackItem["type"];

const TABS: Record<FeedbackType, { label: string; icon: typeof MessageCircle; title: string; subtitle: string; placeholder: string }> = {
  inquiry: {
    label: "Inquiry",
    icon: MessageCircle,
    title: "Ask a Question",
    subtitle: "Have a question about council transactions or events?",
    placeholder: "What would you like to know?",
  },
  complaint: {
    label: "Complaint",
    icon: AlertTriangle,
    title: "File a Complaint",
    subtitle: "Report an issue or concern about council activities",
    placeholder: "Please describe your concern in detail...",
  },
  suggestion: {
    label: "Suggestion",
    icon: Lightbulb,
    title: "Share a Suggestion",
    subtitle: "Help us improve with your ideas and feedback",
    placeholder: "What would you like to suggest?",
  },
};

const EMPTY = { title: "", message: "", studentName: "", studentId: "", isAnonymous: false };

export default function FeedbackSection({ defaultTab }: { defaultTab: ViewState }) {
  const [tab, setTab] = useState<FeedbackType>(defaultTab in TABS ? (defaultTab as FeedbackType) : "inquiry");
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const config = TABS[tab];
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  // Show the thank-you card for a few seconds, then reset for another submission.
  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => {
      setSubmitted(false);
      setForm(EMPTY);
    }, 3000);
    return () => clearTimeout(t);
  }, [submitted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.message.trim()) return void toast.error("Please enter a message");
    setSubmitting(true);
    try {
      await feedbackService.create({
        type: tab,
        title: form.title,
        message: form.message,
        studentName: form.isAnonymous ? undefined : form.studentName,
        studentId: form.isAnonymous ? undefined : form.studentId,
        isAnonymous: form.isAnonymous,
        status: "pending",
      });
      setSubmitted(true);
      toast.success(`${config.label} submitted successfully!`);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page
      eyebrow="We're listening"
      title="Feedback & Communication"
      subtitle="We value your input. Share your questions, concerns, or suggestions with us."
      hero={
        <div role="tablist" className="glass inline-flex flex-wrap gap-1 rounded-full p-1">
          {(Object.keys(TABS) as FeedbackType[]).map((key) => {
            const { icon: Icon, label } = TABS[key];
            const active = key === tab;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={`btn ${active ? "bg-white text-brand-700 shadow-soft" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            );
          })}
        </div>
      }
    >
      <div className="card mx-auto max-w-2xl p-6 lg:p-8">
        <div className="mb-6 flex items-center gap-4">
          <div className="icon-tile">
            <config.icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl">{config.title}</h2>
            <p className="text-sm text-muted">{config.subtitle}</p>
          </div>
        </div>

        {submitted ? (
          <div className="py-10 text-center">
            <div className="icon-tile mx-auto mb-4 h-16 w-16 border-success/30 bg-success/10 text-success">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-xl">Thank You!</h3>
            <p className="mt-1 text-muted">
              Your {tab} has been submitted successfully. We will review it and get back to you soon.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <Field label="Title (optional)">
              <input
                className="input"
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Brief title for your feedback"
                disabled={submitting}
              />
            </Field>
            <Field label={<>Message <span className="text-danger">*</span></>}>
              <textarea
                className="input min-h-[150px] resize-none"
                value={form.message}
                onChange={(e) => set({ message: e.target.value })}
                placeholder={config.placeholder}
                required
                disabled={submitting}
              />
            </Field>

            <button
              type="button"
              role="switch"
              aria-checked={form.isAnonymous}
              onClick={() => set({ isAnonymous: !form.isAnonymous })}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-left text-sm text-muted"
            >
              <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${form.isAnonymous ? "bg-brand-500" : "bg-line"}`}>
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.isAnonymous ? "translate-x-5" : "translate-x-1"}`}
                />
              </span>
              {form.isAnonymous ? <EyeOff className="h-4 w-4" /> : <User className="h-4 w-4" />}
              {form.isAnonymous ? "Submit anonymously" : "Include my information"}
            </button>

            {!form.isAnonymous && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name">
                  <input
                    className="input"
                    value={form.studentName}
                    onChange={(e) => set({ studentName: e.target.value })}
                    placeholder="Juan Dela Cruz"
                    disabled={submitting}
                  />
                </Field>
                <Field label="Student ID">
                  <input
                    className="input"
                    value={form.studentId}
                    onChange={(e) => set({ studentId: e.target.value })}
                    placeholder="2021-00001"
                    disabled={submitting}
                  />
                </Field>
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={submitting || !form.message.trim()}>
              <Send className="h-4 w-4" />
              {submitting ? "Submitting…" : `Submit ${config.label}`}
            </button>

            <p className="flex items-start gap-2 text-xs text-muted">
              <Shield className="mt-0.5 h-4 w-4 shrink-0" />
              Your feedback is important to us. All submissions are reviewed by the student council and will be handled with
              confidentiality. Anonymous submissions cannot receive direct responses.
            </p>
          </form>
        )}
      </div>
    </Page>
  );
}
