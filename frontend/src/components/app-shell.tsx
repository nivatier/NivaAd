import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:8000";

// Match the token retrieval used by api.ts — tokens are in sessionStorage not localStorage
function getAuthToken(): string {
  try {
    const raw = sessionStorage.getItem("nivaad_tokens");
    return raw ? (JSON.parse(raw)?.access_token ?? "") : "";
  } catch { return ""; }
}
import {
  BarChart3, Bell, Bot, CalendarDays, Crown, GalleryHorizontal, Images, Link2, Megaphone, Package, Palette,
  Settings as SettingsIcon, ShieldCheck, Sparkles, User, X, type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { BuyCreditsModal } from "@/components/buy-credits-modal";
import { ProfileModal } from "@/components/profile-modal";
import { FreePlanUpsellModal } from "@/components/free-plan-upsell-modal";
import { useAuth } from "@/hooks/use-auth";
import { LiveClock } from "@/components/timezone-picker";
import { detectedTimeZone } from "@/lib/timezone";
import { NAV } from "@/lib/nav-config";


// NAV is defined in @/lib/nav-config to keep this file component-only (Vite HMR requirement).

// Tab-level icons for the persistent bottom bar — one per NAV section + Account
const TAB_ICONS: Record<string, LucideIcon> = {
  Create: Sparkles,
  Library: Images,
  Setup: Palette,
  Insights: BarChart3,
  Account: User,
};

// Capabilities that are tier-gated — even admins must respect these.
// Must stay in sync with backend services/capabilities.py PRO_ONLY_CAPS.
const TIER_GATED_CAPS = new Set(["view_analytics"]);

function visibleNav(role: string | undefined, capabilities: Record<string, boolean> | undefined, tier: string | undefined) {
  return NAV
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.capability === "admin-only") return role === "admin";
        if (!item.capability) return true;
        // Tier-gated caps: always check the capability value, even for admins —
        // the backend already returns false for these on non-Pro plans.
        if (TIER_GATED_CAPS.has(item.capability)) return !!capabilities?.[item.capability];
        return role === "admin" || !!capabilities?.[item.capability];
      }),
    }))
    .filter((section) => section.items.length > 0);
}

// Must match the backend's monthly credit grant per tier (see backend/app/services/billing.py TIER_CREDITS).
// NOTE: do NOT hardcode this — use me.plan_credits which comes from the backend directly.
const TIER_MONTHLY_FALLBACK: Record<string, number> = { free: 3, starter: 150, pro: 500 };

// ---------- Liquid glass nav item ----------
//
// GPU budget for this effect:
//   • ONE overlay <span> per item (was 4) — a single composited layer
//   • NO backdrop-filter — eliminated; was the heaviest GPU cost
//   • Cursor position written as CSS custom props directly on the DOM
//     node via ref.style — bypasses React re-render entirely on mousemove
//   • Single drop-shadow filter on the icon (was 3 stacked)
//   • box-shadow on the Link itself for the neon ring — stays on the
//     element's own layer, no extra composite promotion
//   • rAF used only to batch the DOM write, not React setState
//
const GLASS_NAV_STYLE = `
  /* ── Base ───────────────────────────────────────────── */
  a[data-glass-nav] {
    --gnx: 50%;
    --gny: 50%;
    opacity: 0.85;
    transition: opacity 0.16s ease, box-shadow 0.16s ease,
                color 0.16s ease, text-shadow 0.16s ease;
    background: transparent !important;
  }
  a[data-glass-nav]:hover  { opacity: 1; background: transparent !important; }
  a[data-glass-nav][data-active="true"] { opacity: 1; }

  /* Single overlay — background uses CSS vars updated by JS */
  a[data-glass-nav] .gni-overlay {
    pointer-events: none;
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 0;
    transition: opacity 0.18s ease;
    background: radial-gradient(
      ellipse 110% 200% at var(--gnx) var(--gny),
      var(--glass-nav-fill-center) 0%,
      var(--glass-nav-fill-mid)    38%,
      transparent 68%
    );
  }
  a[data-glass-nav]:hover .gni-overlay { opacity: 1; }

  /* ── DARK mode ──────────────────────────────────────── */
  html.dark {
    --glass-nav-fill-center: oklch(0.92 0.20 205 / 0.26);
    --glass-nav-fill-mid:    oklch(0.80 0.16 212 / 0.13);
  }
  html.dark a[data-glass-nav] { color: oklch(0.88 0.03 280); }
  html.dark a[data-glass-nav]:hover {
    color: oklch(0.97 0.06 215) !important;
    text-shadow: 0 0 14px oklch(0.90 0.22 210 / 0.65),
                 0 0 30px oklch(0.85 0.20 210 / 0.28) !important;
    box-shadow:
      inset 0 1.5px 0 oklch(1 0 0 / 0.50),
      inset 0 -1.5px 0 oklch(0 0 0 / 0.24),
      0 0 0 1px oklch(0.88 0.24 210 / 0.48),
      0 0 10px 1px oklch(0.85 0.22 210 / 0.26),
      0 0 24px 2px oklch(0.80 0.20 215 / 0.14) !important;
  }
  html.dark a[data-glass-nav][data-active="true"] {
    color: oklch(0.92 0.20 215) !important;
    text-shadow: 0 0 12px oklch(0.90 0.22 210 / 0.55),
                 0 0 26px oklch(0.85 0.20 210 / 0.22) !important;
  }
  html.dark a[data-glass-nav] .glass-nav-icon {
    color: oklch(0.82 0.04 280);
    transition: color 0.16s ease, filter 0.16s ease;
  }
  html.dark a[data-glass-nav]:hover .glass-nav-icon {
    color: oklch(0.95 0.22 210);
    filter: drop-shadow(0 0 8px oklch(0.90 0.24 210 / 0.90));
  }
  html.dark a[data-glass-nav][data-active="true"] .glass-nav-icon {
    color: oklch(0.95 0.24 210);
    filter: drop-shadow(0 0 10px oklch(0.92 0.26 210 / 1.00));
  }

  /* ── LIGHT mode ─────────────────────────────────────── */
  html.light {
    --glass-nav-fill-center: oklch(0.52 0.16 52 / 0.18);
    --glass-nav-fill-mid:    oklch(0.46 0.12 55 / 0.08);
  }
  html.light a[data-glass-nav] { color: oklch(0.40 0.06 58); }
  html.light a[data-glass-nav]:hover {
    color: oklch(0.18 0.07 48) !important;
    text-shadow: 0 0 10px oklch(0.55 0.18 52 / 0.22) !important;
    box-shadow:
      inset 0 1.5px 0 oklch(1 0 0 / 0.85),
      inset 0 -1.5px 0 oklch(0 0 0 / 0.06),
      0 0 0 1px oklch(0.60 0.18 52 / 0.28),
      0 0 10px 1px oklch(0.60 0.16 52 / 0.12) !important;
  }
  html.light a[data-glass-nav][data-active="true"] {
    color: oklch(0.42 0.20 52) !important;
    text-shadow: 0 0 8px oklch(0.55 0.18 52 / 0.20) !important;
  }
  html.light a[data-glass-nav] .glass-nav-icon {
    color: oklch(0.52 0.07 60);
    transition: color 0.16s ease, filter 0.16s ease;
  }
  html.light a[data-glass-nav]:hover .glass-nav-icon {
    color: oklch(0.38 0.22 52);
    filter: drop-shadow(0 0 6px oklch(0.55 0.22 52 / 0.65));
  }
  html.light a[data-glass-nav][data-active="true"] .glass-nav-icon {
    color: oklch(0.36 0.24 52);
    filter: drop-shadow(0 0 8px oklch(0.55 0.24 52 / 0.75));
  }
`;

let _glassNavStyleInjected = false;
function useGlassNavStyle() {
  useEffect(() => {
    if (_glassNavStyleInjected) return;
    _glassNavStyleInjected = true;
    const el = document.createElement("style");
    el.id = "glass-nav-style";
    el.textContent = GLASS_NAV_STYLE;
    document.head.appendChild(el);
  }, []);
}

function GlassNavItem({
  to,
  label,
  icon: Icon,
  active,
  hintKey,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  hintKey?: string;
}) {
  useGlassNavStyle();

  const linkRef = useRef<HTMLAnchorElement>(null);
  const rafRef  = useRef<number>(0);

  // Write cursor position directly to CSS custom props on the DOM node —
  // zero React re-renders on mousemove, no useState, no stale closure.
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = linkRef.current;
    if (!el) return;
    // Capture values before rAF (avoids stale SyntheticEvent)
    const cx = e.clientX;
    const cy = e.clientY;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gnx", `${((cx - r.left) / r.width)  * 100}%`);
      el.style.setProperty("--gny", `${((cy - r.top)  / r.height) * 100}%`);
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <Link
      ref={linkRef}
      to={to}
      data-glass-nav
      data-active={active ? "true" : undefined}
      data-robot-hint-key={hintKey || undefined}
      onMouseMove={handleMouseMove}
      className="relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm overflow-hidden"
      style={active
        ? { background: "color-mix(in oklch, var(--primary) 14%, transparent)" }
        : undefined}
    >
      {/* Active left accent bar */}
      {active && (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-gold-gradient" />
      )}

      {/* Single overlay — position driven by CSS vars, no re-render */}
      <span aria-hidden className="gni-overlay" />

      {/* Icon */}
      <Icon
        className="glass-nav-icon relative z-10 h-4 w-4 shrink-0"
        strokeWidth={active ? 2.5 : 2}
      />

      {/* Label */}
      <span className="relative z-10">{label}</span>
    </Link>
  );
}

// ---------- Mobile bottom sheet grid ----------
function MobileNavSheet({
  section,
  pathname,
  onClose,
}: {
  section: { section: string; items: { to: string; label: string; icon: LucideIcon }[] };
  pathname: string;
  onClose: () => void;
}) {
  const items = section.items;
  // Split into rows of max 3
  const rows: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 lg:hidden"
        onClick={onClose}
        style={{ background: "oklch(0 0 0 / 0.45)" }}
      />
      {/* Sheet */}
      <div
        className="fixed bottom-[60px] left-0 right-0 z-50 lg:hidden rounded-t-2xl overflow-hidden"
        style={{
          background: "var(--glass-sidebar)",
          backdropFilter: "var(--glass-blur-sidebar)",
          WebkitBackdropFilter: "var(--glass-blur-sidebar)",
          border: "1px solid var(--glass-panel-border)",
          borderBottom: "none",
          boxShadow: "var(--glass-sidebar-shadow), 0 -8px 40px oklch(0 0 0 / 0.30)",
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-8 rounded-full bg-white/20" />
        </div>
        {/* Section label */}
        <div className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {section.section}
        </div>
        {/* Grid rows */}
        <div className="px-3 pb-4 space-y-2">
          {rows.map((row, ri) => (
            <div
              key={ri}
              className="flex gap-2"
              style={{ justifyContent: row.length === 3 ? "stretch" : "center" }}
            >
              {row.map((item) => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    data-robot-hint-key={(item as any).hintKey || undefined}
                    className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 transition"
                    style={{
                      flex: row.length === 3 ? "1 1 0%" : "0 0 30%",
                      background: active
                        ? "oklch(0.66 0.26 305 / 0.15)"
                        : "oklch(1 0 0 / 0.04)",
                      border: active
                        ? "1px solid oklch(0.66 0.26 305 / 0.35)"
                        : "1px solid oklch(1 0 0 / 0.08)",
                      boxShadow: active
                        ? "inset 0 1px 0 oklch(1 0 0 / 0.12), 0 0 16px -4px oklch(0.66 0.26 305 / 0.25)"
                        : "inset 0 1px 0 oklch(1 0 0 / 0.06)",
                    }}
                  >
                    <item.icon
                      className="h-5 w-5 shrink-0"
                      strokeWidth={2}
                      style={{ color: active ? "oklch(0.85 0.18 52)" : "oklch(0.70 0.05 280)" }}
                    />
                    <span
                      className="text-[11px] font-medium text-center leading-tight"
                      style={{ color: active ? "oklch(0.92 0.10 52)" : "oklch(0.75 0.04 280)" }}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------- Mobile account sheet ----------
function MobileAccountSheet({
  onClose,
  credits,
  pct,
  tier,
  planCredits,
  personInitial,
  userName,
  userEmail,
  userRole,
  companyName,
  onBuyCredits,
  onLogout,
  onProfile,
}: {
  onClose: () => void;
  credits: number;
  pct: number;
  tier: string;
  planCredits: number;
  personInitial: string;
  userName: string;
  userEmail: string;
  userRole: string;
  companyName: string;
  onBuyCredits: () => void;
  onLogout: () => void;
  onProfile: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 lg:hidden"
        onClick={onClose}
        style={{ background: "oklch(0 0 0 / 0.45)" }}
      />
      {/* Sheet */}
      <div
        className="fixed bottom-[60px] left-0 right-0 z-50 lg:hidden rounded-t-2xl overflow-hidden"
        style={{
          background: "var(--glass-sidebar)",
          backdropFilter: "var(--glass-blur-sidebar)",
          WebkitBackdropFilter: "var(--glass-blur-sidebar)",
          border: "1px solid var(--glass-panel-border)",
          borderBottom: "none",
          boxShadow: "var(--glass-sidebar-shadow), 0 -8px 40px oklch(0 0 0 / 0.30)",
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-8 rounded-full bg-white/20" />
        </div>

        {/* Section label */}
        <div className="px-4 pb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Account
        </div>

        {/* User info row */}
        <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{
            background: "oklch(1 0 0 / 0.04)",
            border: "1px solid oklch(1 0 0 / 0.08)",
          }}>
          <button
            onClick={() => { onProfile(); onClose(); }}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-sm font-semibold text-primary"
          >
            {personInitial}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{userName || userEmail}</div>
            <div className="truncate text-[11px] text-muted-foreground">{companyName} · {userRole}</div>
          </div>
          <button
            onClick={() => { onProfile(); onClose(); }}
            className="text-[11px] text-muted-foreground hover:text-foreground transition"
          >
            Edit
          </button>
        </div>

        {/* Credits card */}
        <div className="mx-3 mb-4 rounded-xl border border-white/[0.09] px-3 py-2.5 relative overflow-hidden"
          style={{
            background: "oklch(1 0 0 / 0.04)",
            boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.10), inset 0 -1px 0 oklch(0 0 0 / 0.12)",
          }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Credits</div>
            <div className="font-display text-xl font-bold text-foreground text-glow">{Number.isInteger(credits) ? credits : credits.toFixed(2).replace(/\.?0+$/, "")}</div>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-neon-gradient" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {tier} · {planCredits}/mo{credits > planCredits ? " · topped up" : ""}
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button
              onClick={() => { onBuyCredits(); onClose(); }}
              className="flex-1 rounded-lg bg-gold-gradient py-2 text-center text-[11px] font-semibold text-background shadow-[var(--shadow-gold)]"
            >
              + Buy Credits
            </button>
            <Link
              to="/app/settings"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border py-2 text-center text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
            >
              Plan & Billing
            </Link>
          </div>
          <button
            onClick={onLogout}
            className="mt-1.5 w-full rounded-lg border border-border py-2 text-[11px] text-muted-foreground hover:border-destructive/40 hover:text-destructive transition"
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );
}

// ---------- Main AppShell ----------
/** Shown when a user signed up after clicking a paid plan on the pricing page.
 * Reads the stored plan from sessionStorage and prompts them to upgrade. */
function UpgradeBanner() {
  const [pending, setPending] = useState<{ tier: string; term: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const { me } = useAuth();

  useEffect(() => {
    if (!me) return;
    // Only show if user is on free plan
    if (me.tier && me.tier !== "free") {
      sessionStorage.removeItem("pendingPlan");
      return;
    }
    try {
      const stored = sessionStorage.getItem("pendingPlan");
      if (stored) setPending(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [me]);

  if (!pending) return null;

  async function upgrade() {
    setBusy(true);
    try {
      const { api } = await import("@/lib/api");
      const res = await api("/billing/checkout", {
        method: "POST",
        body: { tier: pending!.tier, term_months: pending!.term, return_to: "/app" },
      });
      sessionStorage.removeItem("pendingPlan");
      window.location.href = res.url;
    } catch {
      setBusy(false);
    }
  }

  function dismiss() {
    sessionStorage.removeItem("pendingPlan");
    setPending(null);
  }

  const tierLabel = pending.tier.charAt(0).toUpperCase() + pending.tier.slice(1);
  const termLabel = pending.term === 1 ? "monthly" : pending.term === 12 ? "yearly" : `${pending.term}-month`;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm"
      style={{ background: "linear-gradient(135deg, oklch(0.85 0.18 52 / 0.15), oklch(0.72 0.22 45 / 0.10))", borderBottom: "1px solid oklch(0.85 0.18 52 / 0.3)" }}>
      <span className="text-[13px]">🎯</span>
      <span className="flex-1 text-foreground text-xs">
        You chose the <span className="font-semibold text-primary">{tierLabel} ({termLabel})</span> plan. Complete your upgrade to unlock all features.
      </span>
      <button
        onClick={upgrade}
        disabled={busy}
        className="rounded-full bg-gold-gradient px-3 py-1 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-60 shrink-0"
      >
        {busy ? "Loading…" : "Upgrade now →"}
      </button>
      <button onClick={dismiss} className="text-muted-foreground hover:text-foreground text-sm leading-none shrink-0">✕</button>
    </div>
  );
}


export function AppShell({ title, eyebrow, children, rightPanel }: { title: ReactNode; eyebrow?: ReactNode; children: ReactNode; rightPanel?: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { loading, isAuthed, me, logout, loggingOutRef, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null); // which bottom tab sheet is open
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const timeZone = detectedTimeZone();
  const [showProfile, setShowProfile] = useState(false);
  const [billingBanner, setBillingBanner] = useState("");
  const [notifications, setNotifications] = useState<{ id: string; type: string; title: string; body: string; action_url: string | null; created_at: string }[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close desktop drawer on route change
  useEffect(() => { setOpen(false); }, [pathname]);
  // Close bottom sheet on route change
  useEffect(() => { setActiveTab(null); }, [pathname]);

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
        const data = await fetch(`${API_BASE}/agent/notifications`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
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

  useEffect(() => {
    if (!loading && !isAuthed) {
      if (loggingOutRef.current) {
        loggingOutRef.current = false;
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
  const planCredits = me?.plan_credits ?? TIER_MONTHLY_FALLBACK[me?.tier ?? "free"] ?? 3;
  const credits = me?.credits ?? 0;
  const pct = Math.min(100, Math.round((credits / Math.max(planCredits, 1)) * 100));

  function handleLogout() {
    logout();
    navigate({ to: "/" });
  }

  const nav = visibleNav(me?.user.role, me?.capabilities, me?.tier);

  // Which section does the current route belong to?
  const activeSection = nav.find((g) => g.items.some((i) => i.to === pathname))?.section ?? null;

  const NavList = (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pt-10 pb-6">
      {nav.map((group) => (
        <div key={group.section}>
          <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">{group.section}</div>
          <ul className="space-y-0.5">
            {group.items.map((it) => {
              const active = pathname === it.to;
              return (
                <li key={it.to}>
                  <GlassNavItem
                    to={it.to}
                    label={it.label}
                    icon={it.icon}
                    active={active}
                    hintKey={(it as any).hintKey}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const CreditsCard = (
    <div className="relative mx-3 mb-3 overflow-hidden rounded-xl border border-white/[0.09] px-3 py-3.5 bg-card/70 backdrop-blur-xl
      shadow-[0_0_0_1px_oklch(1_0_0_/_0.06),0_4px_24px_-4px_oklch(0_0_0_/_0.4),inset_0_1px_0_oklch(1_0_0_/_0.12),inset_0_-1px_0_oklch(0_0_0_/_0.15)]
      neon-bg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Credits</div>
        <div className="font-display text-xl font-bold text-foreground text-glow">{Number.isInteger(credits) ? credits : credits.toFixed(2).replace(/\.?0+$/, "")}</div>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-neon-gradient" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {me?.tier ? me.tier.charAt(0).toUpperCase() + me.tier.slice(1) : "Free"} · {planCredits}/mo
        {credits > planCredits ? " · topped up" : ""}
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <button onClick={() => setShowBuyCredits(true)} className="flex-1 rounded-lg bg-gold-gradient py-1.5 text-center text-[11px] font-semibold text-background shadow-[var(--shadow-gold)]">
          + Buy
        </button>
        <Link to="/app/settings" className="flex-1 rounded-lg border border-border py-1.5 text-center text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
          Plan & Billing
        </Link>
      </div>
      <button onClick={handleLogout} className="mt-1.5 w-full rounded-lg border border-border py-1.5 text-[11px] text-muted-foreground hover:border-destructive/40 hover:text-destructive">
        Log out
      </button>
    </div>
  );

  // The bottom sheet section currently open (if any)
  const openSection = nav.find((g) => g.section === activeTab) ?? null;

  return (
    <div className="flex min-h-screen text-foreground" style={{ background: "transparent" }}>
      {billingBanner && (
        <div className="fixed top-0 left-0 right-0 z-[110] bg-gold-gradient py-2 text-center text-xs font-medium text-background">
          {billingBanner} <button onClick={() => setBillingBanner("")} className="ml-3 underline">dismiss</button>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
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
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-7 object-contain object-left" />
            <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-7 object-contain object-left" />
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
          </div>
        </Link>
        <div className="mx-3 mb-2 px-3 py-1.5 text-[10px] text-muted-foreground">
          🕐 <LiveClock timeZone={timeZone} />
        </div>
        {NavList}
        {CreditsCard}
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0">
        <UpgradeBanner />

        {/* Mobile top bar — compact */}
        <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-2 lg:hidden"
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
            <img src="/logo-icon.png" alt="NivaSpark icon" className="h-7 w-7 shrink-0 object-contain" />
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-5 object-contain" />
            <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-5 object-contain" />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {/* Notifications bell — mobile */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifications((v) => !v)}
                title="Notifications"
                className="relative grid h-7 w-7 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground hover:border-primary/40 transition"
              >
                <Bell className="h-3.5 w-3.5" strokeWidth={2} />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white animate-pulse shadow-[0_0_6px_1px_rgba(239,68,68,0.5)]">
                    {notifications.length > 9 ? "9+" : notifications.length}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-9 z-50 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-white/[0.09] overflow-hidden
                  bg-gradient-to-b from-[oklch(from_var(--card)_l_c_h_/_0.92)] to-[oklch(from_var(--card)_l_c_h_/_0.80)]
                  backdrop-blur-2xl
                  shadow-[0_0_0_1px_oklch(1_0_0_/_0.08),0_16px_48px_-8px_oklch(0_0_0_/_0.6),inset_0_1px_0_oklch(1_0_0_/_0.14)]">
                  <div className="border-b border-white/[0.07] px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">Notifications</span>
                      {notifications.length > 0 && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">{notifications.length} new</span>
                      )}
                    </div>
                    {notifications.length > 0 && (
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const res = await fetch(`${API_BASE}/agent/notifications/dismiss-all`, { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` } });
                          if (res.ok) setNotifications(await res.json());
                        } catch { /* ignore */ }
                      }} className="text-[10px] text-muted-foreground hover:text-red-400 transition">Clear all</button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05]">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications</div>
                    ) : notifications.map((n) => (
                      <div key={n.id}
                        onClick={() => {
                          if (n.action_url) {
                            setShowNotifications(false);
                            const [path, qs] = n.action_url.split("?");
                            const search = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
                            navigate({ to: path as any, search: (prev: any) => ({ ...prev, ...search }) });
                          }
                        }}
                        className={`group relative px-4 py-3 transition ${n.action_url ? "cursor-pointer hover:bg-white/[0.05]" : "hover:bg-white/[0.03]"}`}
                      >
                        <div className="text-xs font-semibold text-foreground pr-6">{n.title}</div>
                        {n.body && <div className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{n.body}</div>}
                        {n.action_url && (
                          <div className="mt-2">
                            <span className="rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">Review →</span>
                          </div>
                        )}
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const res = await fetch(`${API_BASE}/agent/notifications/${n.id}/dismiss`, { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` } });
                            if (res.ok) setNotifications(await res.json());
                          } catch { /* ignore */ }
                        }} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-foreground" title="Clear">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <ThemeToggle />
            <button
              onClick={() => setShowProfile(true)}
              className="grid h-7 w-7 place-items-center rounded-full border border-primary/40 bg-primary/10 text-[11px] font-semibold text-primary hover:border-primary/70"
            >
              {personInitial}
            </button>
          </div>
        </div>

        {/* Page header — tighter on mobile */}
        <header className="sticky top-[48px] z-20 px-4 py-2.5 lg:top-0 lg:px-10 lg:py-6"
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
              {eyebrow && <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-primary">{eyebrow}</div>}
              {/* Smaller title on mobile — lg keeps original size */}
              <h1 className="mt-0.5 truncate font-display text-lg font-bold tracking-tight text-glow lg:text-3xl lg:mt-1">{title}</h1>
            </div>
            <div className="hidden items-center gap-3 text-xs text-muted-foreground lg:flex">
              <div className="hidden md:flex md:flex-col md:items-end">
                <span className="rounded-full border border-border px-3 py-1 text-xs">{me?.company_name}</span>
                <span className="mt-1 text-[11px] text-muted-foreground">{me?.user.full_name || me?.user.email} · {roleLabel[me?.user.role || ""] || me?.user.role}</span>
              </div>
              <ThemeToggle />
              {/* Notifications bell — desktop */}
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
                    {/* Header */}
                    <div className="border-b border-white/[0.07] px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">Notifications</span>
                        {notifications.length > 0 && (
                          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">{notifications.length} new</span>
                        )}
                      </div>
                      {notifications.length > 0 && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                                const res = await fetch(`${API_BASE}/agent/notifications/dismiss-all`, { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` } });
                              if (res.ok) setNotifications(await res.json());
                            } catch { /* ignore */ }
                          }}
                          className="text-[10px] text-muted-foreground hover:text-red-400 transition"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {/* List */}
                    <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.05]">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications</div>
                      ) : notifications.map((n) => (
                        <div key={n.id}
                          onClick={() => {
                            if (n.action_url) {
                              setShowNotifications(false);
                              const [path, qs] = n.action_url.split("?");
                              const search = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
                              navigate({ to: path as any, search: (prev: any) => ({ ...prev, ...search }) });
                            }
                          }}
                          className={`group relative px-4 py-3 transition ${n.action_url ? "cursor-pointer hover:bg-white/[0.05]" : "hover:bg-white/[0.03]"}`}
                        >
                          <div className="text-xs font-semibold text-foreground pr-6">{n.title}</div>
                          {n.body && <div className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{n.body}</div>}
                          <div className="mt-2 flex items-center gap-2">
                            {n.action_url && (
                              <span className="rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
                                Review →
                              </span>
                            )}
                          </div>
                          {/* Clear button — top right of each row */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(`${API_BASE}/agent/notifications/${n.id}/dismiss`, { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` } });
                                if (res.ok) setNotifications(await res.json());
                              } catch { /* ignore */ }
                            }}
                            className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-foreground"
                            title="Clear"
                          >
                            <X className="h-3 w-3" />
                          </button>
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

        {/* Page content — extra bottom padding on mobile so content clears the bottom nav */}
        <div className="flex min-h-0 flex-1 items-start">
          <div className="flex-1 min-w-0 px-5 py-6 pb-24 lg:px-10 lg:py-8 lg:pb-8">{children}</div>
          {rightPanel && (
            <div
              className="hidden xl:flex w-[232px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 mr-6 bg-card"
              style={{
                boxShadow: "var(--shadow-glass-full)",
                position: "sticky",
                top: "144px",
                height: "calc(100vh - 144px - 20px)",
              }}
            >
              {rightPanel}
            </div>
          )}
        </div>
      </main>

      {/* ── Mobile bottom nav bar ── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden"
        style={{
          background: "var(--glass-sidebar)",
          backdropFilter: "var(--glass-blur-sidebar)",
          WebkitBackdropFilter: "var(--glass-blur-sidebar)",
          border: "1px solid var(--glass-panel-border)",
          borderBottom: "none",
          borderRadius: "1rem 1rem 0 0",
          boxShadow: "var(--glass-sidebar-shadow), 0 -4px 24px oklch(0 0 0 / 0.20)",
          // Respect iOS home indicator
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex items-stretch h-[60px]">
          {/* Nav section tabs */}
          {nav.map((group) => {
            const TabIcon = TAB_ICONS[group.section] ?? Sparkles;
            const isTabActive = activeSection === group.section;
            const isSheetOpen = activeTab === group.section;
            const lit = isTabActive || isSheetOpen;

            return (
              <button
                key={group.section}
                type="button"
                onClick={() => setActiveTab(isSheetOpen ? null : group.section)}
                className="flex flex-1 flex-col items-center justify-center gap-1 relative"
              >
                <span
                  className="absolute top-0 h-0.5 w-8 rounded-b transition-all duration-200"
                  style={{ background: lit ? "oklch(0.85 0.18 52)" : "transparent" }}
                />
                <TabIcon
                  className="h-5 w-5 shrink-0"
                  strokeWidth={lit ? 2.5 : 1.75}
                  style={{ color: lit ? "oklch(0.85 0.18 52)" : "oklch(0.60 0.04 280)" }}
                />
                <span
                  className="text-[10px] font-medium"
                  style={{ color: lit ? "oklch(0.85 0.18 52)" : "oklch(0.55 0.04 280)" }}
                >
                  {group.section}
                </span>
              </button>
            );
          })}

          {/* Account tab — always last */}
          {(() => {
            const isSheetOpen = activeTab === "Account";
            return (
              <button
                type="button"
                onClick={() => setActiveTab(isSheetOpen ? null : "Account")}
                className="flex flex-1 flex-col items-center justify-center gap-1 relative"
              >
                <span
                  className="absolute top-0 h-0.5 w-8 rounded-b transition-all duration-200"
                  style={{ background: isSheetOpen ? "oklch(0.85 0.18 52)" : "transparent" }}
                />
                <User
                  className="h-5 w-5 shrink-0"
                  strokeWidth={isSheetOpen ? 2.5 : 1.75}
                  style={{ color: isSheetOpen ? "oklch(0.85 0.18 52)" : "oklch(0.60 0.04 280)" }}
                />
                <span
                  className="text-[10px] font-medium"
                  style={{ color: isSheetOpen ? "oklch(0.85 0.18 52)" : "oklch(0.55 0.04 280)" }}
                >
                  Account
                </span>
              </button>
            );
          })()}
        </div>
      </div>

      {/* ── Nav section bottom sheet ── */}
      {openSection && (
        <MobileNavSheet
          section={openSection}
          pathname={pathname}
          onClose={() => setActiveTab(null)}
        />
      )}

      {/* ── Account bottom sheet ── */}
      {activeTab === "Account" && (
        <MobileAccountSheet
          onClose={() => setActiveTab(null)}
          credits={credits}
          pct={pct}
          tier={me?.tier ? me.tier.charAt(0).toUpperCase() + me.tier.slice(1) : "Free"}
          planCredits={planCredits}
          personInitial={personInitial}
          userName={me?.user.full_name ?? ""}
          userEmail={me?.user.email ?? ""}
          userRole={roleLabel[me?.user.role ?? ""] ?? (me?.user.role ?? "")}
          companyName={me?.company_name ?? ""}
          onBuyCredits={() => setShowBuyCredits(true)}
          onLogout={handleLogout}
          onProfile={() => setShowProfile(true)}
        />
      )}

      {showBuyCredits && <BuyCreditsModal onClose={() => setShowBuyCredits(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {me?.tier === "free" && <FreePlanUpsellModal />}
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
