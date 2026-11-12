import { Facebook, Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import { FACEBOOK_PAGE_URL } from "@/components/FacebookFeed";
import type { ViewState } from "@/types";

interface FooterSectionProps {
  onNavigate: (view: ViewState) => void;
}

const LINKS: [string, ViewState][] = [
  ["Search Record", "landing"],
  ["Transparency Board", "transparency"],
  ["Inquiry", "inquiry"],
  ["Complaint", "complaint"],
  ["Suggestion", "suggestion"],
  ["Officer Login", "admin-login"],
];

const CONTACT: { icon: typeof Mail; label: string; href?: string }[] = [
  { icon: Facebook, label: "facebook.com/dsscsclsc", href: FACEBOOK_PAGE_URL },
  { icon: Mail, label: "dsscsclsc@gmail.com", href: "mailto:dsscsclsc@gmail.com" },
  { icon: Phone, label: "No number yet" },
  { icon: MapPin, label: "Student Council Office, Likod Sa SB 101" },
];

const HOURS = [
  ["Monday – Friday", "8:00 AM – 5:00 PM"],
  ["Saturday – Sunday", "Closed"],
];

const DEVELOPERS = ["Mark Louise Eyas — Back-end", "Justine Renz Capapas — UI/UX Front-end", "John Mark Mahidlawon — DevOps"];

const Heading = ({ children }: { children: string }) => <h4 className="mb-4 text-sm font-bold text-white">{children}</h4>;

export default function FooterSection({ onNavigate }: FooterSectionProps) {
  return (
    <footer className="blend-top bg-brand-950 px-4 pb-8 pt-32 text-sm text-white/60 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr_1.2fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/lsc-logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white/20" />
            <span className="text-lg font-extrabold text-white">
              LSyn<span className="text-brand-400">C</span>
            </span>
          </div>
          <p className="mt-4 max-w-xs">Built for transparency. Designed for students.</p>
          <p className="mt-1 italic text-powder/80">“One Step Better Than Yesterday.”</p>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-white/40">Developers</p>
          <ul className="mt-2 space-y-1 text-xs">
            {DEVELOPERS.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>

        <nav>
          <Heading>Quick links</Heading>
          <ul className="space-y-2.5">
            {LINKS.map(([label, view]) => (
              <li key={view}>
                <button onClick={() => onNavigate(view)} className="transition hover:text-white">
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <Heading>Contact us</Heading>
          <ul className="space-y-3">
            {CONTACT.map(({ icon: Icon, label, href }) => (
              <li key={label} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                {href ? (
                  <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="hover:text-white">
                    {label}
                  </a>
                ) : (
                  label
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Heading>Office hours</Heading>
          <dl className="space-y-2">
            {HOURS.map(([days, time]) => (
              <div key={days} className="flex justify-between gap-4">
                <dt>{days}</dt>
                <dd className="font-semibold text-white">{time}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
            <ShieldCheck className="h-4 w-4 shrink-0 text-powder" />
            <span>
              <b className="text-white">Data privacy:</b> all data is handled in compliance with the Data Privacy Act of 2012 (RA 10173).
            </span>
          </p>
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-6xl border-t border-white/10 pt-6 text-center text-xs sm:text-left">
        © {new Date().getFullYear()} Local Student Council · LSynC. All rights reserved.
      </div>
    </footer>
  );
}
