import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { LayoutDashboard, Building2, Cpu, Palette, Link2, ShieldCheck, Settings, MessageCircle, Users, type LucideIcon } from "lucide-react";
import { clearDevToken } from "@/lib/dev-api";
import { useDevIdentity } from "@/hooks/use-developer-auth";
import { ThemeToggle } from "@/components/theme-toggle";

// `section` is the permission key that gates each link for a team member
// (see services/developer_team.py PERMISSION_KEYS on the backend) — null
// means always visible (Overview is intentionally ungated for anyone
// logged in at all).
const NAV: { to: string; label: string; icon: LucideIcon; section: string | null }[] = [
  { to: "/developer/overview", label: "Overview", icon: LayoutDashboard, section: null },
  { to: "/developer/companies", label: "Companies", icon: Building2, section: "companies" },
  { to: "/developer/models", label: "Models", icon: Cpu, section: "models" },
  { to: "/developer/themes", label: "Themes", icon: Palette, section: "themes" },
  { to: "/developer/assistant", label: "Assistant", icon: MessageCircle, section: "assistant" },
  { to: "/developer/platforms", label: "Platforms", icon: Link2, section: "platforms" },
  { to: "/developer/moderation", label: "Moderation", icon: ShieldCheck, section: "guardrails" },
  { to: "/developer/settings", label: "Settings", icon: Settings, section: "settings" },
  { to: "/developer/team", label: "Team", icon: Users, section: "team" },
];

export function DeveloperShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const identity = useDevIdentity();

  function logout() {
    clearDevToken();
    navigate({ to: "/developer-login" });
  }

  // Before identity has loaded client-side, show every link (matches SSR,
  // avoids a flash of an empty sidebar) — the actual page content is what's
  // really gated (useRequireDeveloperPermission), this is just nav display.
  const visibleNav = NAV.filter((item) => !item.section || !identity || identity.is_owner || identity.permissions[item.section]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-foreground font-display font-bold text-background">N</div>
          <div className="leading-tight">
            <div className="font-display font-bold tracking-tight text-sidebar-foreground">NivaAd</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Platform Operator</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {visibleNav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="m-3 rounded-xl border border-border bg-card/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Session</div>
          <div className="mt-1 text-xs text-foreground">
            {identity?.is_owner === false ? "Developer team member" : "Developer / platform operator"}
          </div>
          <button onClick={logout} className="mt-3 w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:border-ring hover:text-foreground">
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 px-5 py-5 backdrop-blur lg:px-10 lg:py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">Developer</div>
              <h1 className="font-display text-xl font-bold tracking-tight lg:text-2xl">{title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <span className="rounded-full border border-border bg-muted px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Platform-wide</span>
            </div>
          </div>
        </header>
        <div className="px-5 py-6 lg:px-10 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
