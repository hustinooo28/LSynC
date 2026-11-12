import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, BadgeCheck, CalendarCheck, Eye, FileCheck2, Loader2, ReceiptText, ShieldCheck, UserRound, Wallet } from "lucide-react";
import type { Student } from "@/types";
import { studentsService } from "@/services/db";
import { cn } from "@/lib/utils";
import LSCOfficerCarousel from "@/components/LSCOfficerCarousel";
import FacebookFeed from "@/components/FacebookFeed";
import SplitText from "@/components/motion/SplitText";
import Reveal from "@/components/motion/Reveal";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";

interface LandingSectionProps {
  onSearch: (name: string, studentId: string) => void;
  onViewTransparency: () => void;
  searching?: boolean;
}

export default function LandingSection({ onSearch, onViewTransparency, searching = false }: LandingSectionProps) {
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [matches, setMatches] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const picked = useRef(""); // name chosen from the list — don't search it again
  const nameRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLElement>(null);

  // Hero choreography: intro elements rise after the headline, preview cards
  // fly in, then drift upward (parallax) as the hero scrolls away.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(".hero-intro", { y: 28, opacity: 0, filter: "blur(6px)", stagger: 0.1, delay: 0.45, clearProps: "filter,transform" });
      gsap.from(".hero-card", { y: 140, opacity: 0, rotate: 0, stagger: 0.12, delay: 0.7, duration: 1.3, ease: "expo.out" });
      gsap.to(".hero-cards", { yPercent: -30, ease: "none", scrollTrigger: { trigger: heroRef.current, start: "top top", end: "bottom top", scrub: true } });
    },
    { scope: heroRef },
  );

  // Debounced name autocomplete; `stale` drops responses for older keystrokes.
  useEffect(() => {
    const q = name.trim();
    if (!q || q === picked.current) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const found = await studentsService.search(q);
        if (!stale) setMatches(found.slice(0, 8));
      } catch (error) {
        console.error("Student search failed:", error);
        if (!stale) setMatches([]);
      } finally {
        if (!stale) setLoading(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [name]);

  const changeName = (value: string) => {
    picked.current = "";
    setName(value);
    setOpen(!!value.trim());
    setLoading(!!value.trim());
    if (!value.trim()) setMatches([]);
  };

  const pick = (s: Student) => {
    picked.current = s.name;
    setName(s.name);
    setOpen(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!searching) onSearch(name, studentId);
  };

  const focusLookup = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    nameRef.current?.focus({ preventScroll: true });
  };

  const features = [
    { icon: UserRound, title: "Your personal record", text: "Contributions, payments and requirements — verified with just your name and ID.", action: focusLookup },
    { icon: Wallet, title: "Open council finances", text: "Every peso collected and spent, published for all students to see.", action: onViewTransparency },
    { icon: ReceiptText, title: "Verified receipts", text: "Official receipts and reports attached to each transaction.", action: onViewTransparency },
    { icon: CalendarCheck, title: "Attendance history", text: "QR check-ins for every council event, recorded as they happen.", action: focusLookup },
  ];

  return (
    <>
      <section ref={heroRef} className="hero-bg blend-bottom flex min-h-[100svh] flex-col items-center px-4 pt-32 sm:px-6 lg:pt-40">
        <div className="mx-auto w-full max-w-4xl text-center">
          <span className="hero-intro eyebrow">
            <ShieldCheck className="h-3.5 w-3.5 text-powder" />
            LSC Student Digital Board · Transparency you can check
          </span>
          <SplitText by="chars" delay={0.1} className="mt-6 text-[2.5rem] font-extrabold leading-[1.05] text-white sm:text-6xl lg:text-7xl">
            Your Council Records,
            <br />
            Clear &amp; <span className="text-brand-400">Transparent</span>
          </SplitText>
          <p className="hero-intro mx-auto mt-5 max-w-xl text-base text-white/65 sm:text-lg">
            Check your contributions and attendance, and see exactly how student funds are used — all in one place.
          </p>

          {/* Student lookup */}
          <form onSubmit={submit} className="hero-intro card mx-auto mt-10 grid max-w-3xl gap-1 p-2 text-left shadow-lift sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:rounded-full">
            <div className="relative">
              <Segment id="lookup-name" label="Student name">
                <input
                  ref={nameRef}
                  id="lookup-name"
                  value={name}
                  onChange={(e) => changeName(e.target.value)}
                  onFocus={() => setOpen(!!name.trim() && name !== picked.current)}
                  onBlur={() => setOpen(false)}
                  placeholder="e.g. Juan Dela Cruz"
                  disabled={searching}
                  autoComplete="off"
                  className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted/70"
                />
              </Segment>
              {open && (
                <div className="card absolute inset-x-0 top-full z-20 mt-2 overflow-hidden p-1.5 shadow-lift">
                  {loading ? (
                    <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted">
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching students…
                    </p>
                  ) : matches.length ? (
                    matches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault(); // keep focus so blur doesn't close before the pick
                          pick(s);
                        }}
                        className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-ink hover:bg-surface-2"
                      >
                        {s.name}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2.5 text-sm text-muted">No students found.</p>
                  )}
                </div>
              )}
            </div>
            <Segment id="lookup-id" label="Student ID" divided>
              <input
                id="lookup-id"
                type="password"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="For verification"
                disabled={searching}
                autoComplete="off"
                className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted/70"
              />
            </Segment>
            <button type="submit" disabled={searching} className="btn btn-primary btn-lg mt-1 sm:mt-0">
              {searching ? "Checking…" : "View My Record"}
              <span className="btn-orb">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}</span>
            </button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <button onClick={onViewTransparency} className="inline-flex items-center gap-2 font-semibold text-white/85 underline-offset-4 hover:text-white hover:underline">
              <Eye className="h-4 w-4" /> View Transparency Board
            </button>
            <span className="text-white/45">Your Student ID is only used to verify it&apos;s you.</span>
          </div>
        </div>

        {/* Decorative preview cards */}
        <div aria-hidden className="hero-cards pointer-events-none -mb-10 mt-auto hidden w-full max-w-5xl grid-cols-3 items-end gap-6 pt-16 md:grid">
          <Floating tilt="-rotate-6" delay="">
            <div className="glass p-5">
              <p className="text-xs font-semibold text-white/60">Funds Collected</p>
              <p className="mt-1 text-2xl font-extrabold">₱48,250</p>
              <div className="mt-4 flex h-14 items-end gap-1.5">
                {[40, 65, 50, 85, 60, 95, 75].map((h, i) => (
                  <span key={i} className="flex-1 rounded-full bg-gradient-to-t from-brand-500 to-powder" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </Floating>
          <Floating tilt="rotate-0" delay="[animation-delay:-2s]">
            <div className="card p-5 pb-16">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted">Attendance</p>
                <span className="chip chip-success">+4%</span>
              </div>
              <p className="mt-1 text-3xl font-extrabold text-ink">92%</p>
              <div className="mt-4 h-2 rounded-full bg-surface-2">
                <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-brand-500 to-indigo-500" />
              </div>
              <p className="mt-3 text-xs text-muted">Across 12 council events</p>
            </div>
          </Floating>
          <Floating tilt="rotate-6" delay="[animation-delay:-4s]">
            <div className="glass space-y-3 p-5">
              <p className="text-xs font-semibold text-white/60">Receipts verified</p>
              {["Sports fest supplies", "Org fair booth", "Seminar snacks"].map((r) => (
                <p key={r} className="flex items-center gap-2 text-sm font-medium">
                  <BadgeCheck className="h-4 w-4 shrink-0 text-powder" /> {r}
                </p>
              ))}
            </div>
          </Floating>
        </div>
      </section>

      {/* Features */}
      <section className="bg-page px-4 py-20 sm:px-6 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">
              <FileCheck2 className="h-3.5 w-3.5" /> Why LSynC
            </span>
            <h2 className="mt-4 text-3xl font-extrabold sm:text-5xl">Everything about your council, in one honest place</h2>
            <p className="mt-4 text-muted">Built so every student can check the numbers — no requests, no waiting.</p>
          </Reveal>
          <Reveal stagger className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, text, action }, i) => (
              <button
                key={title}
                onClick={action}
                className={cn("group flex flex-col p-6 text-left", i === 0 ? "card-brand card-hover" : "card card-hover")}
              >
                <span className={cn("icon-tile", i === 0 && "border-white/25 bg-white/10 text-white")}>
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className={cn("mt-8 text-lg font-bold", i === 0 && "text-white")}>{title}</h3>
                <p className={cn("mt-2 flex-1 text-sm", i === 0 ? "text-white/75" : "text-muted")}>{text}</p>
                <span className={cn("mt-6 inline-flex items-center gap-1.5 text-sm font-semibold", i === 0 ? "text-white" : "text-brand-600")}>
                  Learn more <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            ))}
          </Reveal>
        </div>
      </section>

      <FacebookFeed />

      {/* Council officers */}
      <section className="bg-page px-4 pb-20 sm:px-6 lg:pb-28">
        <Reveal className="hero-bg mx-auto max-w-6xl rounded-4xl px-4 py-14 sm:px-8">
          <div className="mb-10 text-center">
            <span className="eyebrow">Leadership · Service · Commitment</span>
            <h2 className="mt-4 text-3xl font-extrabold text-white sm:text-4xl">Meet your council</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/65">The officers serving the Local Student Council community.</p>
          </div>
          <LSCOfficerCarousel />
        </Reveal>
      </section>
    </>
  );
}

function Segment({ id, label, divided, children }: { id: string; label: string; divided?: boolean; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl px-5 py-2.5 transition focus-within:bg-surface-2 sm:rounded-full", divided && "sm:rounded-none sm:border-l sm:border-line sm:focus-within:rounded-full")}>
      <label htmlFor={id} className="block text-[11px] font-bold uppercase tracking-wider text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Rotation lives on the wrapper because `animate-float` owns the transform. */
function Floating({ tilt, delay, children }: { tilt: string; delay: string; children: ReactNode }) {
  return (
    <div className={cn("hero-card", tilt)}>
      <div className={cn("animate-float", delay)}>{children}</div>
    </div>
  );
}
