import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, getTokens } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
  head: () => ({ meta: [{ title: "Pricing — NivaAd" }] }),
});

const TIERS = [
  { key: "starter", name: "Starter", monthly: 29, credits: 10, feats: ["Text + image ads", "2 connected platforms", "No watermark", "Basic analytics"] },
  { key: "growth", name: "Growth", monthly: 79, credits: 30, hot: true, feats: ["Image + video + carousels", "5 platforms · variations", "Brand kit + scheduling", "Creative score + compliance"] },
  { key: "pro", name: "Pro", monthly: 199, credits: 120, feats: ["Everything in Growth", "Campaign launch sets", "Team seats + approvals", "Priority support"] },
];
const TERMS = [
  { m: 1, label: "1 month", disc: 0 },
  { m: 3, label: "3 months", disc: 0.10 },
  { m: 6, label: "6 months", disc: 0.18 },
  { m: 12, label: "12 months", disc: 0.30 },
];

function Pricing() {
  const { isAuthed } = useAuth();
  const [term, setTerm] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function choose(tierKey: string) {
    if (!isAuthed) return; // Link below handles the logged-out case
    setErr(""); setBusy(true);
    try {
      const res = await api("/billing/checkout", { method: "POST", body: { tier: tierKey, term_months: TERMS[term].m, return_to: window.location.pathname } });
      window.location.href = res.url;
    } catch (e: any) {
      setErr(e.message || "Could not start checkout");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex items-center justify-between mb-10">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold-gradient font-display font-bold text-background">N</div>
            <div className="leading-tight">
              <div className="font-display font-bold tracking-tight">NivaAd</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
            </div>
          </Link>
          {isAuthed ? (
            <Link to="/app" className="rounded-full border border-border px-4 py-2 text-sm hover:border-primary/40">← Back to app</Link>
          ) : (
            <Link to="/login" className="rounded-full border border-border px-4 py-2 text-sm hover:border-primary/40">Log in</Link>
          )}
        </div>

        <h1 className="text-center font-display text-4xl font-bold tracking-tight text-glow">
          Simple plans, <span className="text-gold-gradient">no surprise charges</span>
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">Every generation shows its credit cost before you click it. Cancel anytime.</p>

        <div className="mt-8 flex justify-center gap-2">
          {TERMS.map((t, i) => (
            <button key={t.m} onClick={() => setTerm(i)} className={`rounded-full border px-4 py-2 text-sm ${term === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
              {t.label}{t.disc > 0 && <span className="ml-1 text-secondary">−{t.disc * 100}%</span>}
            </button>
          ))}
        </div>

        {err && <div className="mt-4 text-center text-xs text-destructive">{err}</div>}

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {TIERS.map((tier) => {
            const price = Math.round(tier.monthly * (1 - TERMS[term].disc));
            return (
              <div key={tier.key} className={`rounded-2xl border p-6 ${tier.hot ? "border-primary bg-primary/5" : "border-border bg-card/60"}`}>
                {tier.hot && <div className="mb-2 text-[10px] uppercase tracking-widest text-primary">Most popular</div>}
                <div className="font-display text-xl font-bold text-foreground">{tier.name}</div>
                <div className="mt-3 font-display text-4xl font-bold text-foreground">${price}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
                <div className="mt-1 text-sm text-secondary">{tier.credits} credits / month</div>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {tier.feats.map((f) => <li key={f}>✓ {f}</li>)}
                </ul>
                {isAuthed ? (
                  <button disabled={busy} onClick={() => choose(tier.key)}
                    className={`mt-6 w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-50 ${tier.hot ? "bg-gold-gradient text-background shadow-[var(--shadow-gold)]" : "border border-border text-foreground"}`}>
                    {busy ? "Redirecting…" : `Upgrade to ${tier.name}`}
                  </button>
                ) : (
                  <Link to="/signup" className={`mt-6 block w-full rounded-full py-2.5 text-center text-sm font-semibold ${tier.hot ? "bg-gold-gradient text-background shadow-[var(--shadow-gold)]" : "border border-border text-foreground"}`}>
                    Choose {tier.name}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
