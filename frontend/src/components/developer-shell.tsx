import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { LayoutDashboard, Building2, Cpu, Palette, Link2, ShieldCheck, Settings, MessageCircle, Users, Activity, ScrollText, Server, Mail, type LucideIcon } from "lucide-react";
import { clearDevToken } from "@/lib/dev-api";
import { useDevIdentity } from "@/hooks/use-developer-auth";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV: { to: string; label: string; icon: LucideIcon; section: string | null }[] = [
  { to: "/developer/overview",        label: "Overview",       icon: LayoutDashboard, section: null },
  { to: "/developer/monitoring",      label: "Monitoring",     icon: Activity,        section: null },
  { to: "/developer/infrastructure",  label: "Infrastructure", icon: Server,          section: null },
  { to: "/developer/email",           label: "Email Health",   icon: Mail,            section: null },
  { to: "/developer/logs",            label: "Logs",           icon: ScrollText,      section: null },
  { to: "/developer/companies",       label: "Companies",      icon: Building2,       section: "companies" },
  { to: "/developer/models",          label: "Models",         icon: Cpu,             section: "models" },
  { to: "/developer/themes",          label: "Themes",         icon: Palette,         section: "themes" },
  { to: "/developer/assistant",       label: "Assistant",      icon: MessageCircle,   section: "assistant" },
  { to: "/developer/platforms",       label: "Platforms",      icon: Link2,           section: "platforms" },
  { to: "/developer/moderation",      label: "Moderation",     icon: ShieldCheck,     section: "guardrails" },
  { to: "/developer/settings",        label: "Settings",       icon: Settings,        section: "settings" },
  { to: "/developer/team",            label: "Team",           icon: Users,           section: "team" },
];

export function DeveloperShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const identity = useDevIdentity();
  const [open, setOpen] = useState(false);

  function logout() {
    clearDevToken();
    navigate({ to: "/developer-login" });
  }

  const visibleNav = NAV.filter(
    (item) => !item.section || !identity || identity.is_owner || identity.permissions[item.section],
  );

  const activeItem = visibleNav.find((item) => item.to === pathname);

  // Shared nav list — rendered in sidebar (desktop) and dropdown (mobile)
  const NavList = (
    <nav className="flex-1 space-y-1 px-3">
      {visibleNav.map((item) => {
        const active = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const SessionCard = (
    <div className="m-3 rounded-xl border border-border bg-card/60 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Session</div>
      <div className="mt-1 text-xs text-foreground">
        {identity?.is_owner === false ? "Developer team member" : "Developer / platform operator"}
      </div>
      <button
        onClick={logout}
        className="mt-3 w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:border-ring hover:text-foreground"
      >
        Log out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">

      {/* ── Desktop sidebar ── */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
          <div className="leading-tight min-w-0">
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-7 object-contain object-left" />
            <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-7 object-contain object-left" />
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Platform Operator</div>
          </div>
        </div>
        {NavList}
        {SessionCard}
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0">

        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <Link to="/developer/overview" className="flex items-center gap-2 shrink-0">
            <img src="/logo-icon.png" alt="NivaSpark icon" className="h-7 w-7 object-contain" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Dev</div>
          </Link>

          {/* Current page label */}
          {activeItem && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground min-w-0">
              <activeItem.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="truncate">{activeItem.label}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {/* Hamburger */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="Toggle menu"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-foreground hover:border-primary/40"
            >
              <span className="relative block h-3 w-4">
                <span className={`absolute left-0 top-0 h-0.5 w-full bg-current transition ${open ? "translate-y-1.5 rotate-45" : ""}`} />
                <span className={`absolute left-0 top-1.5 h-0.5 w-full bg-current transition ${open ? "opacity-0" : ""}`} />
                <span className={`absolute left-0 top-3 h-0.5 w-full bg-current transition ${open ? "-translate-y-1.5 -rotate-45" : ""}`} />
              </span>
            </button>
          </div>
        </div>

        {/* Mobile collapsible nav */}
        <div
          className={`lg:hidden overflow-hidden border-b border-border bg-sidebar/95 backdrop-blur transition-[max-height] duration-300 ease-out ${
            open ? "max-h-[80vh]" : "max-h-0"
          }`}
        >
          <div className="max-h-[75vh] overflow-y-auto py-2">
            {NavList}
            {SessionCard}
          </div>
        </div>

        {/* Page header */}
        <header className="sticky top-[57px] z-20 border-b border-border bg-background/80 px-4 py-4 backdrop-blur lg:top-0 lg:px-10 lg:py-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">Developer</div>
              <h1 className="truncate font-display text-lg font-bold tracking-tight lg:text-2xl">{title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle className="hidden lg:flex" />
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                Platform-wide
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="px-4 py-5 lg:px-10 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
