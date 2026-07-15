import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { BuyCreditsModal } from "@/components/buy-credits-modal";
import { ProfileModal } from "@/components/profile-modal";
import { useAuth } from "@/hooks/use-auth";

// capability: undefined = always visible to any active user (Create Ad
// and Products stay ungated even in the nav, matching the backend —
// Create Ad's own product picker depends on product-read regardless,
// so hiding Products from the sidebar without also gating that read
// would be inconsistent). "admin-only" is a special marker: shown only
// when role === "admin", never a configurable capability, matching the
// backend's hardcoded (non-configurable) Admin access.
const NAV: { section: string; items: { to: string; label: string; icon: string; capability?: string }[] }[] = [
  {
    section: "Create",
    items: [
      { to: "/app", label: "Create Ad", icon: "✦" },
      { to: "/app/campaigns", label: "Campaigns", icon: "◈", capability: "view_campaigns" },
    ],
  },
  {
    section: "Library",
    items: [
      { to: "/app/my-ads", label: "My Ads", icon: "▤", capability: "view_my_ads" },
      { to: "/app/products", label: "Products", icon: "▣" },
    ],
  },
  {
    section: "Setup",
    items: [
      { to: "/app/brand-kit", label: "Brand Kit", icon: "◐", capability: "view_brand_kit" },
      { to: "/app/connections", label: "Connections", icon: "🔗", capability: "admin-only" },
      { to: "/app/moderation", label: "Moderation", icon: "⛊", capability: "admin-only" },
      { to: "/app/settings", label: "Settings", icon: "◍", capability: "view_settings" },
    ],
  },
  {
    section: "Insights",
    items: [
      { to: "/app/analytics", label: "Analytics", icon: "◑", capability: "view_analytics" },
      { to: "/app/admin", label: "Admin", icon: "◆", capability: "admin-only" },
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
  const [showProfile, setShowProfile] = useState(false);
  const [billingBanner, setBillingBanner] = useState("");
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
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
      {nav.map((group) => (
        <div key={group.section}>
          <div className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{group.section}</div>
          <ul className="space-y-1">
            {group.items.map((it) => {
              const active = pathname === it.to;
              return (
                <li key={it.to}>
                  <Link
                    to={it.to}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? "bg-primary/10 text-primary neon-ring"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    {active && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-gold-gradient" />}
                    <span className={`w-4 text-center ${active ? "text-primary" : "text-muted-foreground"}`}>{it.icon}</span>
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
    <div className="m-3 rounded-xl border border-border bg-card/60 p-4 neon-bg">
      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Credits available</div>
      <div className="mt-1 font-display text-3xl font-bold text-foreground text-glow">{credits}</div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-neon-gradient" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground">
        {me?.tier ? me.tier.charAt(0).toUpperCase() + me.tier.slice(1) : "Free"} plan · {planCredits}/mo included
        {credits > planCredits ? " · topped up" : ""}
      </div>
      <button onClick={() => setShowBuyCredits(true)} className="mt-3 block w-full rounded-lg bg-gold-gradient py-2 text-center text-xs font-semibold text-background shadow-[var(--shadow-gold)]">
        + Buy credits
      </button>
      <button onClick={handleLogout} className="mt-2 w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
        Log out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {billingBanner && (
        <div className="fixed top-0 left-0 right-0 z-[110] bg-gold-gradient py-2 text-center text-xs font-medium text-background">
          {billingBanner} <button onClick={() => setBillingBanner("")} className="ml-3 underline">dismiss</button>
        </div>
      )}
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <Link to="/" className="flex items-center gap-3 px-5 py-6">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold-gradient font-display font-bold text-background shadow-[var(--shadow-neon)]">N</div>
          <div className="leading-tight">
            <div className="font-display font-bold tracking-tight text-sidebar-foreground text-glow">NivaAd</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
          </div>
        </Link>
        {NavList}
        {CreditsCard}
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-gold-gradient font-display text-sm font-bold text-background shadow-[var(--shadow-neon)]">N</div>
            <span className="font-display font-bold tracking-tight text-glow">NivaAd</span>
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
          className={`lg:hidden overflow-hidden border-b border-border bg-sidebar/95 backdrop-blur transition-[max-height] duration-300 ease-out ${
            open ? "max-h-[80vh]" : "max-h-0"
          }`}
        >
          <div className="max-h-[75vh] overflow-y-auto pt-3">
            {NavList}
            {CreditsCard}
          </div>
        </div>

        {/* Page header */}
        <header className="sticky top-[57px] z-20 border-b border-border bg-background/80 px-5 py-5 backdrop-blur lg:top-0 lg:px-10 lg:py-6">
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
  return <div className={`rounded-2xl border border-border bg-card p-6 shadow-[0_0_0_1px_transparent,0_0_40px_-20px_oklch(0.78_0.12_85/0.35)] ${className}`}>{children}</div>;
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
