import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Panel } from "@/components/app-shell";
import { BuyCreditsModal } from "@/components/buy-credits-modal";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Plan & Billing — NivaSpark" }] }),
});

const TIER_LABEL: Record<string, string> = { free: "Free", starter: "Starter", growth: "Growth (legacy)", pro: "Pro" };

type AgentSettings = {
  quick_start_mode: string;
  event_approval_mode: string;
  credit_cap_mode: string;
  monthly_credit_budget: number;
};

function AgentNivaSettingsPanel() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    api("/agent/settings")
      .then(setSettings)
      .catch((e: any) => setErr(e.message || "Could not load Agent Niva settings"));
  }, [isAdmin]);

  async function save() {
    if (!settings) return;
    setSaving(true); setErr(""); setSaved(false);
    try {
      const updated = await api("/agent/settings", { method: "PUT", body: settings });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  if (!isAdmin) return null;

  return (
    <Panel>
      <div className="mb-1 text-sm font-semibold text-foreground">🤖 Agent Niva settings</div>
      <p className="text-xs text-muted-foreground mb-4">
        Control how Agent Niva behaves for your company — Quick Start ad recommendations, recurring event automation, and monthly credit limits.
      </p>

      {!settings ? (
        <div className="text-xs text-muted-foreground">{err || "Loading…"}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Quick Start: after recommending ad ideas</div>
              <select
                value={settings.quick_start_mode}
                onChange={(e) => setSettings({ ...settings, quick_start_mode: e.target.value })}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
              >
                <option value="review_first">Show recommendations — I'll click to create each one</option>
                <option value="auto_draft">Auto-create all as drafts immediately</option>
                <option value="auto_schedule">Auto-generate AND auto-schedule, no review</option>
              </select>
            </div>

            <div>
              <div className="text-xs font-medium text-foreground mb-1">Recurring events: before an event ad posts</div>
              <select
                value={settings.event_approval_mode}
                onChange={(e) => setSettings({ ...settings, event_approval_mode: e.target.value })}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
              >
                <option value="draft_only">Draft only — I'll schedule or post it myself</option>
                <option value="schedule_review">Generate and schedule, cancellable until post time</option>
                <option value="auto_post">Fully automatic — no step required from me</option>
              </select>
            </div>

            <div>
              <div className="text-xs font-medium text-foreground mb-1">Agent credit spend cap</div>
              <select
                value={settings.credit_cap_mode}
                onChange={(e) => setSettings({ ...settings, credit_cap_mode: e.target.value })}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
              >
                <option value="monthly_budget">Enforce a monthly credit budget</option>
                <option value="confirm_each_time">No automatic cap — normal balance check only</option>
                <option value="none">No cap at all</option>
              </select>
            </div>

            {settings.credit_cap_mode === "monthly_budget" && (
              <div>
                <div className="text-xs font-medium text-foreground mb-1">Monthly budget (credits)</div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={settings.monthly_credit_budget}
                  onChange={(e) => setSettings({ ...settings, monthly_credit_budget: Number(e.target.value) })}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              disabled={saving}
              onClick={save}
              className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
          </div>
          {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
        </>
      )}
    </Panel>
  );
}

function Settings() {
  const allowed = useRequireCapability("view_settings");

  const { me, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  const tier = me?.tier ?? "free";
  const isPaid = tier !== "free";
  const termMonths = me?.term_months ?? 1;
  const periodEnd = me?.current_period_end ? new Date(me.current_period_end) : null;
  const cancelScheduled = !!me?.cancel_at_period_end;
  const credits = me?.credits ?? 0;
  const planCredits = me?.plan_credits ?? 0;
  const creditsUsed = Math.max(0, planCredits - credits);
  const creditsPct = planCredits > 0 ? Math.min(100, (creditsUsed / planCredits) * 100) : 0;

  const TERM_LABEL: Record<number, string> = { 1: "Monthly", 3: "3-month", 6: "6-month", 12: "Annual" };
  const TIER_PRICES: Record<string, Record<number, number>> = {
    starter: { 1: 17.00, 3: 48.45, 6: 91.80, 12: 179.52 },
    pro:     { 1: 29.00, 3: 82.65, 6: 156.60, 12: 299.00 },
  };
  const nextChargeAmount = isPaid && tier in TIER_PRICES
    ? TIER_PRICES[tier][termMonths] ?? null
    : null;

  async function openPortal() {
    setErr(""); setBusy(true);
    try {
      const res = await api("/billing/portal", { method: "POST", body: { return_to: window.location.pathname } });
      window.location.href = res.url;
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  async function cancelPlan() {
    if (!confirm(`Cancel your ${TIER_LABEL[tier] ?? tier} plan? You'll keep access until ${periodEnd ? periodEnd.toLocaleDateString() : "the end of your current period"}, then move to the Free plan.`)) return;
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

  if (!allowed) return null;

  return (
    <AppShell eyebrow="Setup" title="Plan & Billing">
      <div className="grid max-w-3xl gap-6">
        <Panel>
          <div className="mb-3 text-sm font-semibold text-foreground">💳 Plan & Billing</div>

          {/* Plan details grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-background/40 px-3 py-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Plan</div>
              <div className="text-sm font-bold text-primary">{TIER_LABEL[tier] ?? tier}</div>
              {isPaid && <div className="text-[10px] text-muted-foreground mt-0.5">{TERM_LABEL[termMonths] ?? `${termMonths}-month`}</div>}
            </div>

            <div className="rounded-xl border border-border bg-background/40 px-3 py-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Status</div>
              {cancelScheduled ? (
                <div className="text-sm font-bold text-amber-400">Cancelling</div>
              ) : (
                <div className="text-sm font-bold text-emerald-400">Active</div>
              )}
              {isPaid && periodEnd && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {cancelScheduled ? `Ends ${periodEnd.toLocaleDateString()}` : `Renews ${periodEnd.toLocaleDateString()}`}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-background/40 px-3 py-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Next charge</div>
              {isPaid && nextChargeAmount && periodEnd && !cancelScheduled ? (
                <>
                  <div className="text-sm font-bold text-foreground">${nextChargeAmount.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{periodEnd.toLocaleDateString()}</div>
                </>
              ) : (
                <div className="text-sm font-bold text-muted-foreground">{cancelScheduled ? "None" : "—"}</div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-background/40 px-3 py-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Credits</div>
              <div className="text-sm font-bold text-foreground">
                {Number.isInteger(credits) ? credits : credits.toFixed(2).replace(/\.?0+$/, "")}
                <span className="text-[10px] font-normal text-muted-foreground"> / {planCredits}</span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-neon-gradient transition-all" style={{ width: `${100 - creditsPct}%` }} />
              </div>
            </div>
          </div>

          {/* Cancellation warning */}
          {cancelScheduled && periodEnd && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
              ⚠ Your plan cancels on {periodEnd.toLocaleDateString()} — you'll move to the Free plan after that date.
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/pricing" className="rounded-full border border-border px-4 py-2 text-xs hover:border-primary/40">
              {isPaid ? "Change plan" : "Upgrade"}
            </a>
            {isPaid && (
              <button onClick={() => setShowBuyCredits(true)}
                className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)]">
                + Buy credits
              </button>
            )}
            <button disabled={busy} onClick={openPortal}
              className="rounded-full border border-border px-4 py-2 text-xs hover:border-primary/40 disabled:opacity-50">
              🧾 Invoices & payment method
            </button>
            {isPaid && (
              cancelScheduled ? (
                <button disabled={busy} onClick={resumePlan}
                  className="rounded-full border border-emerald-500/40 px-4 py-2 text-xs text-emerald-400 hover:bg-emerald-500/5 disabled:opacity-50">
                  ↺ Resume plan
                </button>
              ) : (
                <button disabled={busy} onClick={cancelPlan}
                  className="rounded-full border border-destructive/40 px-4 py-2 text-xs text-destructive hover:bg-destructive/5 disabled:opacity-50">
                  Cancel plan
                </button>
              )
            )}
          </div>

          {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
          <p className="mt-3 text-[10px] text-muted-foreground">
            Payments processed securely by Stripe · {tier === "free" ? "No active subscription" : `${TERM_LABEL[termMonths] ?? termMonths + "-month"} ${TIER_LABEL[tier]} plan`} · All prices in USD
          </p>
        </Panel>

        <AgentNivaSettingsPanel />
      </div>

      {showBuyCredits && <BuyCreditsModal onClose={() => setShowBuyCredits(false)} />}
    </AppShell>
  );
}
