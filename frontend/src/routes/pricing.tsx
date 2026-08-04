import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, getTokens } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-toggle";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
  head: () => ({ meta: [{ title: "Pricing — NivaSpark" }] }),
});

// Prices match Stripe exactly — update via Developer > Settings if they change.
// Discounts: 3mo −5%, 6mo −10%, 12mo −15% (kept conservative to protect margins).
const TIERS = [
  {
    key: "starter",
    name: "Starter",
    // Monthly base price per term (total ÷ months)
    prices: { 1: 17.00, 3: 16.15, 6: 15.30, 12: 14.45 },
    // Total charged per period in Stripe
    totals: { 1: 17.00, 3: 48.45, 6: 91.80, 12: 173.40 },
    credits: 150,
    hot: false,
    feats: [
      { text: "150 credits / month", highlight: true },
      { text: "Text + image ads" },
      { text: "AI video ads" },
      { text: "Carousel ads" },
      { text: "Brand Kit" },
      { text: "Campaigns" },
      { text: "Agent Niva (autonomous)" },
      { text: "All platform connections" },
      { text: "Scheduling" },
      { text: "Credit top-ups" },
      { text: "Admin (test mode)" },
    ],
    cta: "Start with Starter",
  },
  {
    key: "pro",
    name: "Pro",
    prices: { 1: 59.00, 3: 56.05, 6: 53.10, 12: 55.75 },  // 12mo = $669/12 = $55.75 (~$999 total, rounded)
    totals: { 1: 59.00, 3: 168.15, 6: 318.60, 12: 999.00 },
    credits: 500,
    hot: true,
    feats: [
      { text: "500 credits / month", highlight: true },
      { text: "Everything in Starter" },
      { text: "Analytics" },
      { text: "Team seats (2 members)" },
      { text: "Content moderation & approvals" },
      { text: "Priority support" },
    ],
    cta: "Go Pro",
  },
];

// Term options — shown as toggle buttons above the cards
const TERMS = [
  { m: 1,  label: "Monthly",   badge: null },
  { m: 3,  label: "3 months",  badge: "−5%" },
  { m: 6,  label: "6 months",  badge: "−10%" },
  { m: 12, label: "Annual",    badge: "−15%" },
];

function Pricing() {
  const { isAuthed, me } = useAuth();
  const { theme } = useTheme(); // ensures html.dark / html.light class is applied on this standalone page
  const isDark = theme === "dark";
  const [term, setTerm] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const currentTier = me?.tier ?? null; // "free" | "starter" | "pro" | null

  async function choose(tierKey: string) {
    if (!isAuthed) return;
    setErr(""); setBusy(true);
    try {
      const res = await api("/billing/checkout", {
        method: "POST",
        body: { tier: tierKey, term_months: TERMS[term].m, return_to: window.location.pathname },
      });
      window.location.href = res.url;
    } catch (e: any) {
      setErr(e.message || "Could not start checkout");
      setBusy(false);
    }
  }

  const selectedTerm = TERMS[term];

  return (
    <div className="min-h-screen text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-12">

        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
            <div className="leading-tight min-w-0">
              <img src={isDark ? "/logo-wording-dark.png" : "/logo-wording-light.png"} alt="NivaSpark" className="h-7 object-contain object-left" />
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
            </div>
          </Link>
          {isAuthed ? (
            <Link to="/app" className="rounded-full border border-border px-4 py-2 text-sm hover:border-primary/40">← Back to app</Link>
          ) : (
            <Link to="/login" className="rounded-full border border-border px-4 py-2 text-sm hover:border-primary/40">Log in</Link>
          )}
        </div>

        {/* Title */}
        <h1 className="text-center font-display text-4xl font-bold tracking-tight text-glow">
          Simple plans, <span className="text-gold-gradient">no surprise charges</span>
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Every generation shows its credit cost before you click. 1 credit = $0.10. Cancel anytime.
        </p>

        {/* Term toggle */}
        <div className="mt-8 flex justify-center gap-2 flex-wrap">
          {TERMS.map((t, i) => (
            <button
              key={t.m}
              onClick={() => setTerm(i)}
              className={`relative rounded-full border px-4 py-2 text-sm transition ${
                term === i
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {t.label}
              {t.badge && (
                <span className="ml-1.5 rounded-full bg-gold-gradient px-1.5 py-0.5 text-[10px] font-semibold text-background">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {err && <div className="mt-4 text-center text-xs text-destructive">{err}</div>}

        {/* Free + Paid plan cards */}
        <div className="mt-10 grid gap-4 md:grid-cols-3">

          {/* Free plan */}
          <div className={`rounded-2xl border p-6 flex flex-col ${currentTier === "free" ? "border-primary bg-primary/5" : "border-border bg-card/60"}`}>
            <div className="flex items-center gap-2">
              <div className="font-display text-xl font-bold text-foreground">Free</div>
              {currentTier === "free" && (
                <span className="rounded-full bg-primary/15 border border-primary/40 px-2 py-0.5 text-[10px] font-semibold text-primary">Your plan</span>
              )}
            </div>
            <div className="mt-3 font-display text-4xl font-bold text-foreground">
              $0<span className="text-sm font-normal text-muted-foreground">/mo</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">3 credits / month</div>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
              <li>✓ 3 credits / month</li>
              <li>✓ Text + image ads</li>
              <li>✓ 1 platform connection</li>
              <li className="text-muted-foreground/50">✗ AI video</li>
              <li className="text-muted-foreground/50">✗ Campaigns</li>
              <li className="text-muted-foreground/50">✗ Agent Niva</li>
              <li className="text-muted-foreground/50">✗ Brand Kit</li>
              <li className="text-muted-foreground/50">✗ Team seats</li>
            </ul>
            {isAuthed ? (
              currentTier === "free" ? (
                <Link to="/app" className="mt-6 block w-full rounded-full border border-primary/40 bg-primary/5 py-2.5 text-center text-sm text-primary font-medium">
                  ✓ Current plan
                </Link>
              ) : (
                <Link to="/app" className="mt-6 block w-full rounded-full border border-border py-2.5 text-center text-sm text-muted-foreground hover:border-primary/40">
                  Continue on Free
                </Link>
              )
            ) : (
              <Link to="/signup" className="mt-6 block w-full rounded-full border border-border py-2.5 text-center text-sm text-foreground hover:border-primary/40">
                Get started free
              </Link>
            )}
          </div>

          {/* Starter + Pro */}
          {TIERS.map((tier) => {
            const monthlyPrice = tier.prices[selectedTerm.m as keyof typeof tier.prices];
            const totalCharged = tier.totals[selectedTerm.m as keyof typeof tier.totals];
            const isCurrent = currentTier === tier.key;
            const isDowngrade = currentTier === "pro" && tier.key === "starter";
            return (
              <div
                key={tier.key}
                className={`rounded-2xl border p-6 flex flex-col ${
                  isCurrent
                    ? "border-primary bg-primary/5 shadow-[0_0_0_1px_oklch(0.66_0.26_305_/_0.15),0_8px_32px_-4px_oklch(0.66_0.26_305_/_0.20)]"
                    : tier.hot
                    ? "border-primary bg-primary/5 shadow-[0_0_0_1px_oklch(0.66_0.26_305_/_0.15),0_8px_32px_-4px_oklch(0.66_0.26_305_/_0.20)]"
                    : "border-border bg-card/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  {tier.hot && !isCurrent && (
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">Most popular</div>
                  )}
                  {isCurrent && (
                    <span className="rounded-full bg-primary/15 border border-primary/40 px-2 py-0.5 text-[10px] font-semibold text-primary">Your plan</span>
                  )}
                </div>
                <div className="font-display text-xl font-bold text-foreground">{tier.name}</div>
                <div className="mt-3 font-display text-4xl font-bold text-foreground">
                  ${monthlyPrice.toFixed(2).replace(/\.00$/, "")}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </div>
                {selectedTerm.m > 1 && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    ${totalCharged.toFixed(2).replace(/\.00$/, "")} billed every {selectedTerm.m === 12 ? "year" : `${selectedTerm.m} months`}
                  </div>
                )}
                <div className="mt-1 text-sm text-muted-foreground">{tier.credits} credits / month</div>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {tier.feats.map((f) => (
                    <li
                      key={f.text}
                      className={f.highlight ? "font-semibold text-foreground" : "text-muted-foreground"}
                    >
                      ✓ {f.text}
                    </li>
                  ))}
                </ul>
                {isAuthed ? (
                  isCurrent ? (
                    <Link
                      to="/app/settings"
                      className={`mt-6 block w-full rounded-full border border-primary/40 bg-primary/5 py-2.5 text-center text-sm text-primary font-medium`}
                    >
                      ✓ Current plan — Manage
                    </Link>
                  ) : isDowngrade ? (
                    <Link
                      to="/app/settings"
                      className="mt-6 block w-full rounded-full border border-border py-2.5 text-center text-sm text-muted-foreground hover:border-primary/40"
                    >
                      Downgrade — manage in Settings
                    </Link>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => choose(tier.key)}
                      className={`mt-6 w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-50 transition ${
                        tier.hot
                          ? "bg-gold-gradient text-background shadow-[var(--shadow-gold)]"
                          : "border border-border text-foreground hover:border-primary/40"
                      }`}
                    >
                      {busy ? "Redirecting…" : currentTier === "free" ? tier.cta : `Upgrade to ${tier.name}`}
                    </button>
                  )
                ) : (
                  <Link
                    to="/signup"
                    className={`mt-6 block w-full rounded-full py-2.5 text-center text-sm font-semibold ${
                      tier.hot
                        ? "bg-gold-gradient text-background shadow-[var(--shadow-gold)]"
                        : "border border-border text-foreground hover:border-primary/40"
                    }`}
                  >
                    {tier.cta}
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {/* Credit explainer */}
        <div className="mt-10 rounded-2xl border border-border/60 bg-card/40 px-6 py-5">
          <div className="text-sm font-semibold text-foreground mb-2">How credits work</div>
          <div className="grid gap-3 sm:grid-cols-3 text-xs text-muted-foreground">
            <div>
              <div className="font-medium text-foreground mb-1">Text ad copy</div>
              ~0.25 credits per generation. Always shown before you generate.
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">Image ads</div>
              ~0.75–2 credits depending on model quality chosen.
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">Video ads</div>
              Priced by model + duration. Preview shown before generating.
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Unused credits don't roll over. Need more? Buy top-up credits anytime from your account (Starter and Pro plans only).
          </div>
        </div>

        {/* FAQ-style footer notes */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          All prices in USD · VAT/tax may apply · Payments processed securely by Stripe · Cancel anytime, no lock-in
        </p>
      </div>
    </div>
  );
}
