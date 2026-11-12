import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import Field from "@/components/ui/Field";
import AuthLayout, { PasswordInput } from "./AuthLayout";

interface ResetPasswordSectionProps {
  onSetNewPassword: (newPassword: string) => Promise<void>;
}

export default function ResetPasswordSection({ onSetNewPassword }: ResetPasswordSectionProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return void toast.error("Password should be at least 6 characters");
    if (password !== confirm) return void toast.error("Passwords do not match");
    setLoading(true);
    try {
      await onSetNewPassword(password);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => setShown((v) => !v);

  return (
    <AuthLayout icon={KeyRound} title="Set New Password" subtitle="Choose a new password for your officer account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New password">
          <PasswordInput
            shown={shown}
            onToggle={toggle}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            minLength={6}
            required
            autoFocus
          />
        </Field>
        <Field label="Confirm password">
          <PasswordInput
            shown={shown}
            onToggle={toggle}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter your new password"
            autoComplete="new-password"
            minLength={6}
            required
          />
        </Field>
        <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthLayout>
  );
}
