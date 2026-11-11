import { useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { toast } from "sonner";
import Field from "@/components/ui/Field";
import AuthLayout from "./AuthLayout";

interface ForgotPasswordSectionProps {
  onRequestReset: (email: string) => Promise<void>;
  onBack: () => void;
}

export default function ForgotPasswordSection({ onRequestReset, onBack }: ForgotPasswordSectionProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return void toast.error("Please enter your email address");
    setLoading(true);
    try {
      await onRequestReset(email);
      // Same confirmation whether or not the address exists, so we don't leak registered emails.
      setSent(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const backButton = (
    <button type="button" onClick={onBack} className={sent ? "btn btn-secondary btn-lg w-full" : "btn btn-ghost w-full"}>
      <ArrowLeft className="h-4 w-4" /> Back to sign in
    </button>
  );

  if (sent) {
    return (
      <AuthLayout
        icon={MailCheck}
        title="Check your email"
        subtitle={
          <>
            If <b className="text-ink">{email}</b> is a registered officer account, a password reset link is on its way. It's
            valid for a limited time.
          </>
        }
      >
        {backButton}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset Password" subtitle="Enter your officer email and we'll send you a reset link">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email">
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="officer@studentboard.ph"
            required
            autoFocus
          />
        </Field>
        <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
          {loading ? "Sending…" : "Send reset link"}
        </button>
        {backButton}
      </form>
    </AuthLayout>
  );
}
