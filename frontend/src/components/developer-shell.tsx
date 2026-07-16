import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { clearDevToken } from "@/lib/dev-api";

const NAV = [
  { to: "/developer/overview", label: "Overview", icon: "◆" },
  { to: "/developer/companies", label: "Companies", icon: "▤" },
  { to: "/developer/models", label: "Models", icon: "◐" },
  { to: "/developer/platforms", label: "Platforms", icon: "🔗" },
  { to: "/developer/moderation", label: "Moderation", icon: "⛊" },
  { to: "/developer/settings", label: "Settings", icon: "⚙" },
];

export function DeveloperShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  function logout() {
    clearDevToken();
    navigate({ to: "/developer-login" });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-700/50 bg-sidebar lg:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-700 font-display font-bold text-slate-100">N</div>
          <div className="leading-tight">
            <div className="font-display font-bold tracking-tight text-sidebar-foreground">NivaAd</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Platform Operator</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-slate-700/40 text-foreground" : "text-muted-foreground hover:bg-slate-700/20 hover:text-foreground"}`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="m-3 rounded-xl border border-slate-700/50 bg-card/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Session</div>
          <div className="mt-1 text-xs text-foreground">Developer / platform operator</div>
          <button onClick={logout} className="mt-3 w-full rounded-lg border border-slate-700/50 py-2 text-xs text-muted-foreground hover:border-slate-500 hover:text-foreground">
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-700/50 bg-background/80 px-5 py-5 backdrop-blur lg:px-10 lg:py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">Developer</div>
              <h1 className="font-display text-xl font-bold tracking-tight lg:text-2xl">{title}</h1>
            </div>
            <span className="rounded-full border border-slate-600/60 bg-slate-700/20 px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Platform-wide</span>
          </div>
        </header>
        <div className="px-5 py-6 lg:px-10 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
