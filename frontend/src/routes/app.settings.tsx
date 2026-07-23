import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Panel } from "@/components/app-shell";
import { BuyCreditsModal } from "@/components/buy-credits-modal";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Settings — NivaSpark" }] }),
});

const TIER_LABEL: Record<string, string> = { free: "Free", starter: "Starter", growth: "Growth", pro: "Pro" };

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

        <AgentNivaSettingsPanel />
      </div>

      {showBuyCredits && <BuyCreditsModal onClose={() => setShowBuyCredits(false)} />}
    </AppShell>
  );
}
