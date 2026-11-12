import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import SplitText from "@/components/motion/SplitText";

interface PageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small pill label above the title. */
  eyebrow?: ReactNode;
  onBack?: () => void;
  /** Buttons rendered on the right of the header. */
  actions?: ReactNode;
  /** Optional content inside the hero band under the title (e.g. stat cards). */
  hero?: ReactNode;
  children: ReactNode;
}

/**
 * Standard page shell: a deep-indigo hero band with the title, followed by
 * the page content which slightly overlaps the band.
 */
export default function Page({ title, subtitle, eyebrow, onBack, actions, hero, children }: PageProps) {
  return (
    <div className="min-h-screen pb-16">
      <header className="hero-bg blend-bottom pb-40 pt-24 lg:pt-28">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
          <div className="flex items-start gap-4">
            {onBack && (
              <button onClick={onBack} className="btn btn-icon mt-1 border border-white/20 bg-white/10 text-white hover:bg-white/20" aria-label="Go back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="animate-fade-up">
              {eyebrow && <span className="eyebrow mb-3">{eyebrow}</span>}
              <SplitText className="text-3xl font-extrabold text-white lg:text-4xl">{title}</SplitText>
              {subtitle && <p className="mt-2 max-w-2xl text-sm text-white/70 lg:text-base">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {hero && <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6 lg:px-8">{hero}</div>}
      </header>
      <div className="stagger relative mx-auto -mt-24 max-w-7xl space-y-6 px-4 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}
