import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import {
  isPushSupported,
  getExistingSubscription,
  subscribeOfficerToPush,
  subscribeStudentToPush,
  subscribeAnonymousToPush,
  upgradeSubscriptionToStudent,
} from "@/lib/push";

const DISMISSED_KEY = "dtb-push-prompt-dismissed";

interface PushPromptModalProps {
  isLoggedIn: boolean;
  studentId?: string;
}

/**
 * Asks once per browser to enable push (skipped if permission was already
 * decided). Stays mounted so an anonymous subscription is silently re-linked
 * to a student the moment they verify.
 */
export default function PushPromptModal({ isLoggedIn, studentId }: PushPromptModalProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported() || typeof Notification === "undefined" || Notification.permission !== "default") return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    getExistingSubscription()
      .then((existing) => {
        if (!existing && !cancelled) timer = setTimeout(() => setOpen(true), 1500);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoggedIn, studentId]);

  useEffect(() => {
    if (studentId) upgradeSubscriptionToStudent(studentId);
  }, [studentId]);

  // Either outcome is final: a denial is permanent in the browser anyway.
  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setOpen(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = isLoggedIn
        ? await subscribeOfficerToPush()
        : studentId
          ? await subscribeStudentToPush(studentId)
          : await subscribeAnonymousToPush();
      if (result.ok) toast.success("Push notifications enabled.");
      else toast.error(result.message || "Couldn't enable push notifications on this device.");
      dismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={dismiss}
      size="sm"
      icon={<BellRing className="h-5 w-5" />}
      title="Stay updated"
      description="Get notified about payment confirmations, new files and contribution deadlines — even when you're not on the site."
      footer={
        <>
          <button onClick={dismiss} className="btn btn-secondary" disabled={busy}>
            Not now
          </button>
          <button onClick={enable} className="btn btn-primary" disabled={busy}>
            {busy ? "Enabling…" : "Enable"}
          </button>
        </>
      }
    />
  );
}
