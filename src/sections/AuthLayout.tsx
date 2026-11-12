import { useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff, History, ShieldCheck, Users, type LucideIcon } from "lucide-react";

const TRUST = [
  { icon: ShieldCheck, label: "Every action is logged" },
  { icon: Users, label: "Role-based access" },
  { icon: History, label: "Full audit trail" },
];

interface AuthLayoutProps {
  title: ReactNode;
  subtitle: ReactNode;
  /** Shown in an icon tile instead of the council seal. */
  icon?: LucideIcon;
  /** Show the headline + trust chips column on large screens. */
  aside?: boolean;
  children: ReactNode;
}

/** Full-screen hero shell shared by the officer sign-in / password pages. */
export default function AuthLayout({ title, subtitle, icon: Icon, aside, children }: AuthLayoutProps) {
  return (
    <section className="hero-bg flex min-h-screen items-center px-4 pb-12 pt-24 sm:px-6">
      <div
        className={`mx-auto grid w-full items-center gap-12 ${aside ? "max-w-6xl lg:grid-cols-[1.1fr_1fr]" : "max-w-md"}`}
      >
        {aside && (
          <div className="hidden animate-fade-up lg:block">
            <span className="eyebrow">Officer portal</span>
            <h1 className="mt-5 text-5xl font-extrabold leading-tight text-white">
              Run the council <span className="text-powder">in the open.</span>
            </h1>
            <p className="mt-4 max-w-md text-white/70">
              Manage students, events, contributions and reports — every change stays transparent to the student body.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {TRUST.map(({ icon: TIcon, label }) => (
                <span key={label} className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm">
                  <TIcon className="h-4 w-4 text-powder" />
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="card mx-auto w-full max-w-md animate-fade-up p-8 shadow-lift">
          <div className="mb-6 text-center">
            {Icon ? (
              <div className="icon-tile mx-auto mb-4 h-14 w-14">
                <Icon className="h-6 w-6" />
              </div>
            ) : (
              <img src="/lsc-logo.jpg" alt="LSC Seal" className="mx-auto mb-4 h-14 w-14 rounded-full object-cover ring-4 ring-brand-500/15" />
            )}
            <h2 className="text-2xl font-extrabold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

/** `.input` with a show/hide toggle; pass `shown`/`onToggle` to share visibility across fields. */
export function PasswordInput({ shown, onToggle, ...props }: ComponentProps<"input"> & { shown?: boolean; onToggle?: () => void }) {
  const [own, setOwn] = useState(false);
  const visible = shown ?? own;
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className="input pr-11" />
      <button
        type="button"
        onClick={onToggle ?? (() => setOwn((v) => !v))}
        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
