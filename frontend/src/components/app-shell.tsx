import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3, Bell, Bot, CalendarDays, Crown, GalleryHorizontal, Images, Link2, Megaphone, Package, Palette,
  Settings as SettingsIcon, ShieldCheck, Sparkles, type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { BuyCreditsModal } from "@/components/buy-credits-modal";
import { ProfileModal } from "@/components/profile-modal";
import { useAuth } from "@/hooks/use-auth";
import { LiveClock } from "@/components/timezone-picker";
import { detectedTimeZone } from "@/lib/timezone";


// capability: undefined = always visible to any active user (Create Ad
// and Products stay ungated even in the nav, matching the backend —
// Create Ad's own product picker depends on product-read regardless,
// so hiding Products from the sidebar without also gating that read
// would be inconsistent). "admin-only" is a special marker: shown only
// when role === "admin", never a configurable capability, matching the
// backend's hardcoded (non-configurable) Admin access.
export const NAV: { section: string; items: { to: string; label: string; icon: LucideIcon; capability?: string; hintKey?: string }[] }[] = [
  {
    section: "Create",
    items: [
      { to: "/app", label: "Create Ad", icon: Sparkles, hintKey: "nav:create-ad" },
      { to: "/app/campaigns", label: "Campaigns", icon: Megaphone, capability: "view_campaigns", hintKey: "nav:campaigns" },
    ],
  },
  {
    section: "Library",
    items: [
      { to: "/app/my-ads", label: "My Ads", icon: Images, capability: "view_my_ads", hintKey: "nav:my-ads" },
      { to: "/app/products", label: "Products", icon: Package, hintKey: "nav:products" },
      { to: "/app/themes-gallery", label: "Themes Gallery", icon: GalleryHorizontal, hintKey: "nav:themes-gallery" },
      { to: "/app/calendar", label: "Calendar", icon: CalendarDays, capability: "view_my_ads", hintKey: "nav:calendar" },
      { to: "/app/agent-niva", label: "Agent Niva", icon: Bot, hintKey: "nav:agent-niva" },
    ],
  },
  {
    section: "Setup",
    items: [
      { to: "/app/brand-kit", label: "Brand Kit", icon: Palette, capability: "view_brand_kit", hintKey: "nav:brand-kit" },
      { to: "/app/connections", label: "Connections", icon: Link2, capability: "admin-only", hintKey: "nav:connections" },
      { to: "/app/moderation", label: "Moderation", icon: ShieldCheck, capability: "admin-only", hintKey: "nav:moderation" },
      { to: "/app/settings", label: "Settings", icon: SettingsIcon, capability: "view_settings", hintKey: "nav:settings" },
    ],
  },
  {
    section: "Insights",
    items: [
      { to: "/app/analytics", label: "Analytics", icon: BarChart3, capability: "view_analytics", hintKey: "nav:analytics" },
      { to: "/app/admin", label: "Admin", icon: Crown, capability: "admin-only", hintKey: "nav:admin" },
    ],
  },
];

function visibleNav(role: string | undefined, capabilities: Record<string, boolean> | undefined) {
  return NAV
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.capability === "admin-only") return role === "admin";
        if (!item.capability) return true;
        return role === "admin" || !!capabilities?.[item.capability];
      }),
    }))
    .filter((section) => section.items.length > 0);
}

// Must match the backend's monthly credit grant per tier (see backend/app/services/billing.py TIER_CREDITS).
const TIER_MONTHLY: Record<string, number> = { free: 3, starter: 10, growth: 30, pro: 120 };

export function AppShell({ title, eyebrow, children }: { title: ReactNode; eyebrow?: ReactNode; children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { loading, isAuthed, me, logout, loggingOutRef, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const timeZone = detectedTimeZone();
  const [showProfile, setShowProfile] = useState(false);
  const [billingBanner, setBillingBanner] = useState("");
  const [notifications, setNotifications] = useState<{ id: string; type: string; title: string; body: string; action_url: string | null; created_at: string }[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [pathname]);

  // Checkout can redirect back to whatever page the customer started
  // from (not just Settings/home) - this fires on every /app/* page
  // since they all render through AppShell, so the banner + credit
  // refresh happens regardless of where Stripe sends them back to.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (billing === "success") setBillingBanner("Payment successful - your plan is updating...");
    else if (billing === "topup-success") setBillingBanner("Credits added - updating your balance...");
    else if (billing === "canceled") setBillingBanner("Checkout canceled - no charge was made.");
    if (billing === "success" || billing === "topup-success") {
      let tries = 0;
      const poll = setInterval(async () => {
        await refresh();
        tries += 1;
        if (tries >= 6) clearInterval(poll);
      }, 1500);
      setTimeout(() => setBillingBanner(""), 6000);
      return () => clearInterval(poll);
    }
  }, []);

  // Poll for notifications every 60s
  useEffect(() => {
    if (!isAuthed) return;
    async function fetchNotifs() {
      try {
        const data = await fetch("/api/agent/notifications", { headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` } });
        if (data.ok) setNotifications(await data.json());
      } catch { /* ignore */ }
    }
    fetchNotifs();
    const t = setInterval(fetchNotifs, 60_000);
    return () => clearInterval(t);
  }, [isAuthed]);

  // Click outside notifications panel to close
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Auth guard: every /app/* page renders through AppShell, so gating here
  // protects the whole authenticated app in one place. Skipped during an
  // intentional logout (loggingOutRef) so that flow goes to "/" instead of
  // racing this guard's own "/login" redirect.
  useEffect(() => {
    if (!loading && !isAuthed) {
      if (loggingOutRef.current) {
        loggingOutRef.current = false; // consumed — only suppress the redirect once, right after logout
      } else {
        navigate({ to: "/login" });
      }
    }
  }, [loading, isAuthed, navigate, loggingOutRef]);

  if (loading || !isAuthed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  const activeItem = NAV.flatMap((g) => g.items).find((i) => i.to === pathname);
  const personInitial = (me?.user.full_name || me?.user.email || "?").charAt(0).toUpperCase();
  const roleLabel: Record<string, string> = { admin: "Admin", editor: "Editor", poster: "Poster" };
  const planCredits = TIER_MONTHLY[me?.tier ?? "free"] ?? 3;
  const credits = me?.credits ?? 0;
  const pct = Math.min(100, Math.round((credits / Math.max(planCredits, 1)) * 100));

  function handleLogout() {
    logout();
    navigate({ to: "/" });
  }

  const nav = visibleNav(me?.user.role, me?.capabilities);
  const NavList = (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pt-10 pb-6">
      {nav.map((group) => (
        <div key={group.section}>
          <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{group.section}</div>
          <ul className="space-y-0.5">
            {group.items.map((it) => {
              const active = pathname === it.to;
              return (
                <li key={it.to}>
                  <Link
                    to={it.to}
                    data-robot-hint-key={it.hintKey || undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition ${
                      active
                        ? "bg-primary/10 text-primary neon-ring"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    {active && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-gold-gradient" />}
                    <it.icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} strokeWidth={2} />
                    <span>{it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const CreditsCard = (
    <div className="relative mx-3 mb-3 overflow-hidden rounded-xl border border-white/[0.09] px-3 py-2.5 bg-card/70 backdrop-blur-xl
      shadow-[0_0_0_1px_oklch(1_0_0_/_0.06),0_4px_24px_-4px_oklch(0_0_0_/_0.4),inset_0_1px_0_oklch(1_0_0_/_0.12),inset_0_-1px_0_oklch(0_0_0_/_0.15)]
      neon-bg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Credits</div>
        <div className="font-display text-xl font-bold text-foreground text-glow">{credits}</div>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-neon-gradient" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {me?.tier ? me.tier.charAt(0).toUpperCase() + me.tier.slice(1) : "Free"} · {planCredits}/mo
        {credits > planCredits ? " · topped up" : ""}
      </div>
      <div className="mt-2 flex gap-1.5">
        <button onClick={() => setShowBuyCredits(true)} className="flex-1 rounded-lg bg-gold-gradient py-1.5 text-center text-[11px] font-semibold text-background shadow-[var(--shadow-gold)]">
          + Buy
        </button>
        <button onClick={handleLogout} className="flex-1 rounded-lg border border-border py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen text-foreground" style={{ background: "transparent" }}>
      {billingBanner && (
        <div className="fixed top-0 left-0 right-0 z-[110] bg-gold-gradient py-2 text-center text-xs font-medium text-background">
          {billingBanner} <button onClick={() => setBillingBanner("")} className="ml-3 underline">dismiss</button>
        </div>
      )}
      {/* Desktop sidebar — glass layer 1, rounded right edge, defined border */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col lg:flex"
        style={{
          background: "var(--glass-sidebar)",
          backdropFilter: "var(--glass-blur-sidebar)",
          WebkitBackdropFilter: "var(--glass-blur-sidebar)",
          border: "1px solid var(--glass-panel-border)",
          borderLeft: "none",
          borderRadius: "0 1.25rem 1.25rem 0",
          boxShadow: "var(--glass-sidebar-shadow), 4px 0 24px oklch(0 0 0 / 0.12)",
        }}>
        <Link to="/" className="flex items-center gap-3 px-5 pt-5 pb-3">
          <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
          <div className="leading-tight min-w-0">
            {/* dark mode: silver/light text wording; light mode: navy text wording */}
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-7 object-contain object-left" />
            <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-7 object-contain object-left" />
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
          </div>
        </Link>
        {/* Live clock — browser timezone, no picker needed */}
        <div className="mx-3 mb-2 px-3 py-1.5 text-[10px] text-muted-foreground">
          🕐 <LiveClock timeZone={timeZone} />
        </div>
        {NavList}
        {CreditsCard}
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        {/* Mobile top bar — glass, rounded bottom, theme-aware */}
        <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3 lg:hidden"
          style={{
            background: "var(--glass-topbar)",
            backdropFilter: "var(--glass-blur-topbar)",
            WebkitBackdropFilter: "var(--glass-blur-topbar)",
            border: "1px solid var(--glass-panel-border)",
            borderTop: "none",
            borderLeft: "none",
            borderRadius: "0 0 1rem 1rem",
            boxShadow: "var(--glass-topbar-shadow), 0 4px 16px oklch(0 0 0 / 0.08)",
          }}>
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-icon.png" alt="NivaSpark icon" className="h-8 w-8 shrink-0 object-contain" />
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-6 object-contain" />
            <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-6 object-contain" />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <button onClick={() => setShowProfile(true)} className="grid h-8 w-8 place-items-center rounded-full border border-primary/40 bg-primary/10 text-xs font-semibold text-primary hover:border-primary/70">{personInitial}</button>
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

        {/* Mobile collapsible menu */}
        <div
          className={`lg:hidden overflow-hidden border-b border-sidebar-border backdrop-blur transition-[max-height] duration-300 ease-out ${
            open ? "max-h-[80vh]" : "max-h-0"
          }`}
        >
          <div className="max-h-[75vh] overflow-y-auto pt-3">
            {NavList}
            {CreditsCard}
          </div>
        </div>

        {/* Page header — glass layer 2, rounded bottom, defined border */}
        <header className="sticky top-[57px] z-20 px-5 py-5 lg:top-0 lg:px-10 lg:py-6"
          style={{
            background: "var(--glass-topbar)",
            backdropFilter: "var(--glass-blur-topbar)",
            WebkitBackdropFilter: "var(--glass-blur-topbar)",
            border: "1px solid var(--glass-panel-border)",
            borderTop: "none",
            borderLeft: "none",
            borderRadius: "0 0 1.25rem 1.25rem",
            boxShadow: "var(--glass-topbar-shadow), 0 8px 24px oklch(0 0 0 / 0.10)",
          }}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
            <div className="min-w-0">
              {eyebrow && <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">{eyebrow}</div>}
              <h1 className="mt-1 truncate font-display text-2xl font-bold tracking-tight text-glow lg:text-3xl">{title}</h1>
              {activeItem && (
                <div className="mt-1 text-[11px] text-muted-foreground lg:hidden">{activeItem.label}</div>
              )}
            </div>
            <div className="hidden items-center gap-3 text-xs text-muted-foreground lg:flex">
              <div className="hidden md:flex md:flex-col md:items-end">
                <span className="rounded-full border border-border px-3 py-1 text-xs">{me?.company_name}</span>
                <span className="mt-1 text-[11px] text-muted-foreground">{me?.user.full_name || me?.user.email} · {roleLabel[me?.user.role || ""] || me?.user.role}</span>
              </div>
              <ThemeToggle />
              {/* Notifications bell */}
              <div className="relative" ref={notifRef}>
                <button onClick={() => setShowNotifications((v) => !v)} title="Notifications"
                  className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground hover:border-primary/40 hover:text-foreground transition">
                  <Bell className="h-4 w-4" strokeWidth={2} />
                  {notifications.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white animate-pulse shadow-[0_0_8px_2px_rgba(239,68,68,0.5)]">
                      {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                  )}
                </button>
                {showNotifications && (
                  <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-white/[0.09] overflow-hidden
                    bg-gradient-to-b from-[oklch(from_var(--card)_l_c_h_/_0.92)] to-[oklch(from_var(--card)_l_c_h_/_0.80)]
                    backdrop-blur-2xl
                    shadow-[0_0_0_1px_oklch(1_0_0_/_0.08),0_16px_48px_-8px_oklch(0_0_0_/_0.6),0_32px_64px_-16px_oklch(0_0_0_/_0.4),inset_0_1px_0_oklch(1_0_0_/_0.14)]">
                    <div className="border-b border-white/[0.07] px-4 py-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">Notifications</span>
                      {notifications.length > 0 && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">{notifications.length} new</span>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.05]">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications</div>
                      ) : notifications.map((n) => (
                        <div key={n.id} className="px-4 py-3 hover:bg-white/[0.03] transition">
                          <div className="text-xs font-semibold text-foreground">{n.title}</div>
                          {n.body && <div className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{n.body}</div>}
                          <div className="mt-2 flex items-center gap-2">
                            {n.action_url && (
                              <a href={n.action_url} onClick={() => setShowNotifications(false)}
                                className="rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
                                Review →
                              </a>
                            )}
                            <button onClick={async () => {
                              try {
                                const token = localStorage.getItem("token") || "";
                                const res = await fetch(`/api/agent/notifications/${n.id}/dismiss`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
                                if (res.ok) setNotifications(await res.json());
                              } catch { /* ignore */ }
                            }} className="text-[10px] text-muted-foreground hover:text-foreground transition">
                              Dismiss
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowProfile(true)}
                title="Your profile"
                className="grid h-9 w-9 place-items-center rounded-full border border-primary/40 bg-primary/10 font-semibold text-primary hover:border-primary/70"
              >
                {personInitial}
              </button>
            </div>
          </div>
        </header>
        <div className="px-5 py-6 lg:px-10 lg:py-8">{children}</div>
      </main>
      {showBuyCredits && <BuyCreditsModal onClose={() => setShowBuyCredits(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-2xl border border-border/60 p-6 overflow-hidden bg-card
      shadow-[var(--shadow-glass-full)]
      ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">💡 {hint}</p>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${props.className ?? ""}`}
    />
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-14 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
