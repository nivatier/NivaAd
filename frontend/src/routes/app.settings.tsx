import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Panel } from "@/components/app-shell";
import { BuyCreditsModal } from "@/components/buy-credits-modal";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Settings — NivaAd" }] }),
});

const TIER_LABEL: Record<string, string> = { free: "Free", starter: "Starter", growth: "Growth", pro: "Pro" };

function Settings() {
  const allowed = useRequireCapability("view_settings");

  const { me, refresh } = useAuth();
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  const tier = me?.tier ?? "free";
  const isPaid = tier !== "free";
  const periodEnd = me?.current_period_end ? new Date(me.current_period_end) : null;
  const cancelScheduled = !!me?.cancel_at_period_end;

  async function openPortal() {
    setErr(""); setBusy(true);
    try {
      const res = await api("/billing/portal", { method: "POST", body: { return_to: window.location.pathname } });
      window.location.href = res.url;
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  async function cancelPlan() {
    if (!confirm(`Cancel your ${TIER_LABEL[tier]} plan? You'll keep access until ${periodEnd ? periodEnd.toLocaleDateString() : "the end of your current period"}, then move to the Free plan.`)) return;
    setErr(""); setBusy(true);
    try {
      await api("/billing/cancel", { method: "POST" });
      await refresh();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function resumePlan() {
    setErr(""); setBusy(true);
    try {
      await api("/billing/resume", { method: "POST" });
      await refresh();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  return (
    <AppShell eyebrow="Setup" title="Settings">
      <div className="grid max-w-3xl gap-6">
        <Panel>
          <div className="mb-1 text-sm font-semibold text-foreground">💳 Plan & billing</div>
          <p className="text-xs text-muted-foreground">
            Current plan: <span className="text-primary">{TIER_LABEL[tier]}</span> · {me?.credits ?? 0} credits available
          </p>
          {isPaid && periodEnd && (
            cancelScheduled ? (
              <p className="mt-1 text-xs text-amber-400">⚠ Cancels on {periodEnd.toLocaleDateString()} — you'll then move to the Free plan.</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Renews on {periodEnd.toLocaleDateString()}</p>
            )
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/pricing" className="rounded-full border border-border px-4 py-2 text-xs hover:border-primary/40">Change plan</a>
            <button onClick={() => setShowBuyCredits(true)} className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)]">
              + Buy credits
            </button>
            <button disabled={busy} onClick={openPortal} className="rounded-full border border-border px-4 py-2 text-xs hover:border-primary/40 disabled:opacity-50">🧾 Manage billing / invoices</button>
            {isPaid && (
              cancelScheduled ? (
                <button disabled={busy} onClick={resumePlan} className="rounded-full border border-emerald-500/40 px-4 py-2 text-xs text-emerald-400 disabled:opacity-50">↺ Resume plan</button>
              ) : (
                <button disabled={busy} onClick={cancelPlan} className="rounded-full border border-destructive/40 px-4 py-2 text-xs text-destructive disabled:opacity-50">Cancel plan</button>
              )
            )}
          </div>
          {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
          <p className="mt-4 text-xs text-muted-foreground">Payments run through Stripe (sandbox/test mode). Manage billing opens Stripe's own portal for invoices and payment method.</p>
        </Panel>

        <Panel>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-foreground">📋 Require approval before posting</div>
              <p className="mt-1 text-xs text-muted-foreground">Not backend-wired yet (local toggle only) — full approval workflow is a later phase.</p>
            </div>
            <button onClick={() => setApproval((v) => !v)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${approval ? "bg-gold-gradient" : "bg-muted"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-all ${approval ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </Panel>
      </div>

      {showBuyCredits && <BuyCreditsModal onClose={() => setShowBuyCredits(false)} />}
    </AppShell>
  );
}
