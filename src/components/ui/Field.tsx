import type { ReactNode } from "react";

interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}

/** Label + control + optional hint/error. Wrap any `.input`. */
export default function Field({ label, children, hint, error, className }: FieldProps) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
