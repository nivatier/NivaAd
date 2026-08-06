import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Zap, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useNavigate } from "@tanstack/react-router";

// Shown once per browser session when the logged-in user is on the free plan.
// Uses sessionStorage so it fires on every fresh login but not on every navigation.
const SESSION_KEY = "upsellShown";

const TERMS = [
  { m: 1,  label: "Monthly",  badge: null },
  { m: 3,  label: "3 months", badge: "−5%" },
  { m: 6,  label: "6 months", badge: "−10%" },
  { m: 12, label: "Annual",   badge: "−12%" },
];

const TIERS = [
  {
    key: "starter",
    name: "Starter",
    prices: { 1: 17.00, 3: 16.15, 6: 15.30, 12: 14.96 },
    totals: { 1: 17.00, 3: 48.45, 6: 91.80, 12: 179.52 },
    credits: 150,
    hot: false,
    feats: [
      { text: "150 credits / month", highlight: true },
      { text: "Text, image & video ads" },
      { text: "Brand Kit & Campaigns" },
      { text: "Agent Niva (autonomous)" },
      { text: "All platform connections" },
      { text: "Credit top-ups" },
    ],
    cta: "Get Starter",
  },
  {
    key: "pro",
    name: "Pro",
    prices: { 1: 29.00, 3: 27.55, 6: 26.10, 12: 24.92 },
    totals: { 1: 29.00, 3: 82.65, 6: 156.60, 12: 299.00 },
    credits: 290,
    hot: true,
    feats: [
      { text: "290 credits / month", highlight: true },
      { text: "Everything in Starter" },
      { text: "Analytics dashboard" },
      { text: "Team seats (2 members)" },
      { text: "Content moderation" },
      { text: "Priority support" },
    ],
    cta: "Go Pro",
  },
];

export function FreePlanUpsellModal({ forceOpen, onClose }: { forceOpen?: boolean; onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [termIdx, setTermIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // tierKey being processed
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (forceOpen) {
      // Triggered explicitly (e.g. clicking a locked platform) — open immediately,
      // do NOT set the session key so the auto-show can still fire on next login.
      setOpen(true);
      return;
    }
    // Only show once per session — cleared on logout (sessionStorage clears on tab close)
    if (sessionStorage.getItem(SESSION_KEY)) return;
    // Small delay so the page settles first
    const t = setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem(SESSION_KEY, "1");
    }, 1200);
    return () => clearTimeout(t);
  }, [forceOpen]);

  function dismiss() {
    setOpen(false);
    onClose?.();
  }

  async function choose(tierKey: string) {
    setErr("");
    setBusy(tierKey);
    try {
      const res = await api("/billing/checkout", {
        method: "POST",
        body: { tier: tierKey, term_months: TERMS[termIdx].m, return_to: "/app" },
      });
      window.location.href = res.url;
    } catch (e: any) {
      setErr(e.message || "Could not start checkout");
      setBusy(null);
    }
  }

  const selectedTerm = TERMS[termIdx];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogPrimitive.Portal>
        {/* Backdrop */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[120]"
          style={{ background: "oklch(0 0 0 / 0.60)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
        />

        {/* Modal — full-screen scroll on mobile, centered card on desktop */}
        <DialogPrimitive.Content
          className="fixed z-[130] focus:outline-none inset-0 overflow-y-auto flex items-start sm:items-center justify-center p-3 sm:p-6"
        >
          <div
            className="relative w-full max-w-2xl rounded-2xl sm:rounded-3xl my-auto"
            style={{
              background: "oklch(0.13 0.02 280 / 0.97)",
              backdropFilter: "blur(32px) saturate(1.6)",
              WebkitBackdropFilter: "blur(32px) saturate(1.6)",
              border: "1px solid oklch(1 0 0 / 0.10)",
              boxShadow: [
                "0 0 0 1px oklch(0.85 0.18 52 / 0.15)",
                "inset 0 1px 0 oklch(1 0 0 / 0.12)",
                "0 40px 100px -20px oklch(0 0 0 / 0.80)",
                "0 0 80px -20px oklch(0.66 0.26 305 / 0.15)",
              ].join(", "),
            }}
          >
            {/* Gold top accent */}
            <div
              className="h-[2px] w-full rounded-t-3xl"
              style={{ background: "linear-gradient(90deg, transparent 0%, oklch(0.85 0.18 52 / 0.9) 30%, oklch(0.72 0.22 45 / 0.9) 70%, transparent 100%)" }}
            />

            {/* Close button */}
            <DialogPrimitive.Close
              onClick={dismiss}
              className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full text-white/40 hover:text-white transition-colors"
              style={{ background: "oklch(1 0 0 / 0.06)", border: "1px solid oklch(1 0 0 / 0.10)" }}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>

            <div className="px-5 pt-6 pb-7 sm:px-8 sm:pt-8 sm:pb-9">

              {/* Header */}
              <div className="text-center mb-6 sm:mb-8">
                <div
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold mb-3"
                  style={{ background: "oklch(0.85 0.18 52 / 0.12)", border: "1px solid oklch(0.85 0.18 52 / 0.30)", color: "oklch(0.88 0.18 52)" }}
                >
                  <Zap className="h-3 w-3 fill-current" />
                  You're on the Free plan — only 3 credits/month
                </div>
                <h2
                  className="font-display text-2xl sm:text-3xl font-bold tracking-tight"
                  style={{ color: "oklch(0.97 0.01 280)" }}
                >
                  Unlock the full power of{" "}
                  <span style={{ color: "oklch(0.88 0.18 52)" }}>NivaSpark</span>
                </h2>
                <p className="mt-2 text-xs sm:text-sm" style={{ color: "oklch(0.65 0.03 280)" }}>
                  Generate unlimited ads, connect all platforms, and let Agent Niva run on autopilot.
                </p>
              </div>

              {/* Term toggle */}
              <div className="flex justify-center mb-5 sm:mb-6">
                <div
                  className="flex flex-wrap justify-center gap-1 rounded-xl p-1"
                  style={{ background: "oklch(1 0 0 / 0.05)", border: "1px solid oklch(1 0 0 / 0.08)" }}
                >
                  {TERMS.map((t, i) => (
                    <button
                      key={t.m}
                      onClick={() => setTermIdx(i)}
                      className="relative rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                      style={
                        termIdx === i
                          ? { background: "oklch(0.66 0.26 305)", color: "white", boxShadow: "0 2px 10px oklch(0.66 0.26 305 / 0.40)" }
                          : { color: "oklch(0.60 0.03 280)" }
                      }
                    >
                      {t.label}
                      {t.badge && (
                        <span
                          className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                          style={
                            termIdx === i
                              ? { background: "oklch(1 0 0 / 0.20)", color: "white" }
                              : { background: "oklch(0.85 0.18 52 / 0.20)", color: "oklch(0.88 0.18 52)" }
                          }
                        >
                          {t.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Plan cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {TIERS.map((tier) => {
                  const monthlyPrice = tier.prices[selectedTerm.m as keyof typeof tier.prices];
                  const totalCharged = tier.totals[selectedTerm.m as keyof typeof tier.totals];
                  const isBusy = busy === tier.key;

                  return (
                    <div
                      key={tier.key}
                      className="relative flex flex-col rounded-2xl p-4 sm:p-5"
                      style={
                        tier.hot
                          ? {
                              background: "oklch(0.66 0.26 305 / 0.10)",
                              border: "1px solid oklch(0.66 0.26 305 / 0.35)",
                              boxShadow: "0 0 0 1px oklch(0.66 0.26 305 / 0.10), 0 8px 32px -4px oklch(0.66 0.26 305 / 0.15)",
                            }
                          : {
                              background: "oklch(1 0 0 / 0.04)",
                              border: "1px solid oklch(1 0 0 / 0.09)",
                            }
                      }
                    >
                      {/* Most popular badge */}
                      {tier.hot && (
                        <div
                          className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                          style={{ background: "oklch(0.66 0.26 305)", color: "white", boxShadow: "0 2px 12px oklch(0.66 0.26 305 / 0.50)" }}
                        >
                          Most popular
                        </div>
                      )}

                      {/* Tier name + price */}
                      <div className="mb-3">
                        <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "oklch(0.60 0.03 280)" }}>
                          {tier.name}
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="font-display text-3xl font-bold" style={{ color: "oklch(0.97 0.01 280)" }}>
                            ${monthlyPrice.toFixed(2).replace(/\.00$/, "")}
                          </span>
                          <span className="text-xs" style={{ color: "oklch(0.55 0.03 280)" }}>/mo</span>
                        </div>
                        {selectedTerm.m > 1 && (
                          <div className="mt-0.5 text-[11px]" style={{ color: "oklch(0.55 0.03 280)" }}>
                            ${totalCharged.toFixed(2).replace(/\.00$/, "")} billed every {selectedTerm.m === 12 ? "year" : `${selectedTerm.m} months`}
                          </div>
                        )}
                      </div>

                      {/* Features */}
                      <ul className="flex-1 space-y-1.5 mb-4">
                        {tier.feats.map((f) => (
                          <li key={f.text} className="flex items-center gap-2">
                            <Check
                              className="h-3.5 w-3.5 shrink-0"
                              style={{ color: tier.hot ? "oklch(0.75 0.20 305)" : "oklch(0.70 0.15 165)" }}
                              strokeWidth={2.5}
                            />
                            <span
                              className={`text-xs ${f.highlight ? "font-semibold" : ""}`}
                              style={{ color: f.highlight ? "oklch(0.90 0.05 280)" : "oklch(0.65 0.03 280)" }}
                            >
                              {f.text}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {/* CTA */}
                      <button
                        onClick={() => choose(tier.key)}
                        disabled={!!busy}
                        className="w-full rounded-full py-2.5 text-sm font-semibold transition disabled:opacity-60"
                        style={
                          tier.hot
                            ? {
                                background: "linear-gradient(135deg, oklch(0.88 0.18 52), oklch(0.74 0.22 45))",
                                color: "black",
                                boxShadow: "0 4px 20px oklch(0.72 0.22 45 / 0.45), inset 0 1px 0 oklch(1 0 0 / 0.25)",
                              }
                            : {
                                background: "linear-gradient(135deg, oklch(0.50 0.22 260), oklch(0.44 0.20 280))",
                                color: "white",
                                boxShadow: "0 4px 16px oklch(0.50 0.22 260 / 0.35)",
                              }
                        }
                      >
                        {isBusy ? "Redirecting…" : tier.cta}
                      </button>
                    </div>
                  );
                })}
              </div>

              {err && (
                <div className="mt-3 text-center text-xs" style={{ color: "oklch(0.65 0.20 25)" }}>{err}</div>
              )}

              {/* Footer */}
              <div className="mt-5 text-center space-y-2">
                <p className="text-[11px]" style={{ color: "oklch(0.50 0.02 280)" }}>
                  No lock-in · Cancel anytime · Payments by Stripe
                </p>
                <button
                  onClick={dismiss}
                  className="text-xs underline underline-offset-2 transition"
                  style={{ color: "oklch(0.45 0.02 280)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "oklch(0.65 0.02 280)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "oklch(0.45 0.02 280)")}
                >
                  Continue with Free plan for now
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
