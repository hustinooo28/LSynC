import { useEffect, useState } from "react";
import { ChevronDown, LayoutDashboard, LogIn, LogOut, Menu as MenuIcon, Moon, Sun, X } from "lucide-react";
import type { UserRole, ViewState } from "@/types";
import { ROLE_LABEL, VIEW_ROLES } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/Menu";
import NotificationBell from "@/components/NotificationBell";

interface NavigationProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  role: UserRole | null;
  onLogout: () => void;
  /** Set once a visitor has verified name + Student ID via the landing search. */
  studentId?: string;
}

type Link = { label: string; view: ViewState; roles?: UserRole[] };

const PUBLIC_LINKS: Link[] = [
  { label: "Records", view: "landing" },
  { label: "Transparency", view: "transparency" },
  { label: "Feedback", view: "inquiry" },
];

// Staff links are filtered by VIEW_ROLES unless they list their own roles.
const STAFF_LINKS: Link[] = [
  { label: "Students", view: "student-management" },
  { label: "Transparency", view: "transparency", roles: ["board-member"] },
  { label: "Feedback", view: "feedback-management" },
];
const MANAGE_LINKS: Link[] = [
  { label: "Events", view: "event-management" },
  { label: "Attendance", view: "attendance-management" },
  { label: "Contributions", view: "contribution-management" },
  { label: "Finances", view: "transaction-management" },
  { label: "Reports", view: "report-management" },
  { label: "Council Sharing Files", view: "requirement-files-management" },
];

const allowed = (role: UserRole) => (l: Link) => (l.roles ?? VIEW_ROLES[l.view] ?? [role]).includes(role);

export default function Navigation({ currentView, onNavigate, role, onLogout, studentId }: NavigationProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = role ? STAFF_LINKS.filter(allowed(role)) : PUBLIC_LINKS;
  const manage = role ? MANAGE_LINKS.filter(allowed(role)) : [];
  const manageActive = manage.some((l) => l.view === currentView);
  // Every page starts with a dark .hero-bg band, so white text works until the user scrolls.
  const solid = scrolled || mobileOpen;

  const go = (view: ViewState) => {
    setMobileOpen(false);
    onNavigate(view);
  };
  const logout = () => {
    setMobileOpen(false);
    onLogout();
  };

  const iconBtn = cn("btn btn-icon", solid ? "text-muted hover:bg-surface-2 hover:text-ink" : "text-white/85 hover:bg-white/10 hover:text-white");
  const pillLink = (active: boolean) =>
    cn(
      "btn btn-sm h-9 px-4",
      active
        ? solid ? "bg-surface text-brand-600 shadow-soft" : "bg-white text-brand-700"
        : solid ? "text-muted hover:text-ink" : "text-white/75 hover:text-white",
    );
  const sheetLink = (active: boolean) =>
    cn("w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold transition", active ? "bg-brand-500/10 text-brand-600" : "text-ink hover:bg-surface-2");

  return (
    <nav className={cn("fixed inset-x-0 top-0 z-40 border-b transition-colors duration-300", solid ? "border-line bg-surface/80 text-ink backdrop-blur-xl" : "border-transparent text-white")}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-[4.5rem] lg:px-8">
        <button onClick={() => go("landing")} className="flex items-center gap-2.5" aria-label="LSynC home">
          <img src="/lsc-logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white/30" />
          <span className="text-lg font-extrabold tracking-tight">
            LSyn<span className="text-brand-400">C</span>
          </span>
        </button>

        {/* Desktop: centered pill nav */}
        <div className="flex flex-1 justify-center">
          <div className={cn("hidden items-center gap-1 rounded-full border p-1 lg:flex", solid ? "border-line bg-surface-2/70" : "border-white/15 bg-white/10 backdrop-blur")}>
            {links.map((l) => (
              <button key={l.view} onClick={() => go(l.view)} className={pillLink(currentView === l.view)}>
                {l.label}
              </button>
            ))}
            {manage.length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <button className={pillLink(manageActive)}>
                    Manage <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </MenuTrigger>
                <MenuContent align="center" sideOffset={10} className="w-56">
                  {manage.map((l) => (
                    <MenuItem key={l.view} onSelect={() => go(l.view)} className={cn(currentView === l.view && "text-brand-600")}>
                      {l.label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className={iconBtn} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <NotificationBell onNavigate={go} isLoggedIn={!!role} studentId={studentId} triggerClassName={iconBtn} />

          <div className="ml-2 hidden items-center gap-2 lg:flex">
            {role ? (
              <>
                <button onClick={() => go("admin-dashboard")} className="btn btn-primary btn-sm h-9" title={`Signed in as ${ROLE_LABEL[role]}`}>
                  <LayoutDashboard className="h-4 w-4" /> Dashboard
                </button>
                <button onClick={logout} className={iconBtn} aria-label="Log out" title="Log out">
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </>
            ) : (
              <button onClick={() => go("admin-login")} className="btn btn-primary btn-sm h-9">
                <LogIn className="h-4 w-4" /> Log in
              </button>
            )}
          </div>

          <button onClick={() => setMobileOpen((o) => !o)} className={cn(iconBtn, "lg:hidden")} aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen}>
            {mobileOpen ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile: card sheet */}
      {mobileOpen && (
        <div className="card mx-4 mb-4 max-h-[calc(100dvh-6rem)] animate-fade-up overflow-y-auto p-2 shadow-lift lg:hidden">
          {role && <p className="px-4 pb-1 pt-2 text-xs font-semibold text-muted">Signed in as {ROLE_LABEL[role]}</p>}
          {role && (
            <button onClick={() => go("admin-dashboard")} className={sheetLink(currentView === "admin-dashboard")}>
              Dashboard
            </button>
          )}
          {links.map((l) => (
            <button key={l.view} onClick={() => go(l.view)} className={sheetLink(currentView === l.view)}>
              {l.label}
            </button>
          ))}
          {manage.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Manage</p>
              {manage.map((l) => (
                <button key={l.view} onClick={() => go(l.view)} className={sheetLink(currentView === l.view)}>
                  {l.label}
                </button>
              ))}
            </>
          )}
          <div className="mt-2 border-t border-line p-2">
            {role ? (
              <button onClick={logout} className="btn btn-secondary w-full">
                <LogOut className="h-4 w-4" /> Log out
              </button>
            ) : (
              <button onClick={() => go("admin-login")} className="btn btn-primary w-full">
                <LogIn className="h-4 w-4" /> Log in
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
