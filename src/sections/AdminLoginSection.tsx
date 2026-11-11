import { useState } from "react";
import { ArrowRight, Shield } from "lucide-react";
import { toast } from "sonner";
import Field from "@/components/ui/Field";
import AuthLayout, { PasswordInput } from "./AuthLayout";

interface AdminLoginSectionProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onForgotPassword: () => void;
}

export default function AdminLoginSection({ onLogin, onForgotPassword }: AdminLoginSectionProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return void toast.error("Please enter your email and password");
    setLoading(true);
    try {
      await onLogin(email, password); // App switches to the dashboard on success
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout aside title="Admin Access" subtitle="Sign in with your officer account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email">
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="officer@studentboard.ph"
            autoComplete="username"
            required
            autoFocus
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />
        </Field>
        <div className="-mt-1 text-right">
          <button type="button" onClick={onForgotPassword} className="text-xs font-semibold text-brand-600 hover:underline">
            Forgot password?
          </button>
        </div>
        <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
          {loading ? "Signing in…" : "Sign in"}
          {!loading && (
            <span className="btn-orb">
              <ArrowRight className="h-4 w-4" />
            </span>
          )}
        </button>
      </form>

      <div className="mt-6 space-y-3 border-t border-line pt-5 text-center text-xs text-muted">
        <p className="flex items-center justify-center gap-1.5">
          <Shield className="h-3.5 w-3.5" /> All actions are logged for security purposes
        </p>
        <p className="rounded-2xl bg-surface-2 p-3">
          Don't have an account? Ask the Student Council Administrator to create one for you.
        </p>
      </div>
    </AuthLayout>
  );
}
