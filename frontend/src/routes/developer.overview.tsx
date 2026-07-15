import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi, type PlatformOverviewOut, type OpenRouterCreditsOut } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/overview")({
  component: DeveloperOverview,
  head: () => ({ meta: [{ title: "Developer Overview — NivaAd" }] }),
});

const TIER_LABEL: Record<string, string> = { free: "Free", starter: "Starter", growth: "Growth", pro: "Pro" };

function OpenRouterBalanceCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [credits, setCredits] = useState<OpenRouterCreditsOut | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true); setErr("");
    devApi("/developer/openrouter-credits")
      .then(setCredits)
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not reach OpenRouter"); })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const low = credits && credits.remaining < 5;

  return (
    <div className={`mb-6 rounded-xl border p-5 ${low ? "border-destructive/50 bg-destructive/5" : "border-slate-700/50 bg-card/60"}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">OpenRouter balance</div>
          <p className="mt-1 text-xs text-muted-foreground">The actual account every company's image/video generation draws from — this is what's behind any "Insufficient credits" error.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="rounded-full border border-slate-700/50 px-3 py-1 text-[11px] text-muted-foreground hover:border-slate-500 disabled:opacity-50">
            {loading ? "Checking…" : "↻ Refresh"}
          </button>
          <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer" className="rounded-full bg-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-600">
            Manage / top up ↗
          </a>
        </div>
      </div>
      {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
      {credits && (
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[11px] text-muted-foreground">Purchased</div>
            <div className="mt-1 text-lg font-bold text-foreground">${credits.total_credits.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Used</div>
            <div className="mt-1 text-lg font-bold text-foreground">${credits.total_usage.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Remaining</div>
            <div className={`mt-1 text-lg font-bold ${low ? "text-destructive" : "text-primary"}`}>${credits.remaining.toFixed(2)}</div>
          </div>
        </div>
      )}
      {low && <div className="mt-3 text-xs text-destructive">⚠ Balance is low — generations across every company will start failing with "Insufficient credits" soon if this isn't topped up.</div>}
    </div>
  );
}

function TeamLimitCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/team-limits")
      .then((r) => setValue(String(r.max_extra_users)))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load the team limit"); });
  }, []);

  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return;
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/team-limits", { method: "PUT", body: { max_extra_users: n } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-5 max-w-md">
      <div className="text-sm font-semibold text-foreground">Team size limit</div>
      <p className="mt-1 text-xs text-muted-foreground">How many non-admin members (editor/poster) a single company can add, on top of its admin(s). Applies to every company the same way. Pending invites count too, so this genuinely caps what's in the database, not just active accounts.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-slate-500 focus:outline-none" />
        <span className="text-xs text-muted-foreground">extra users per company</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function DataRetentionCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/retention")
      .then((r) => setValue(String(r.retention_months)))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load the retention period"); });
  }, []);

  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return;
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/retention", { method: "PUT", body: { retention_months: n } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-5 max-w-md">
      <div className="text-sm font-semibold text-foreground">Media retention period</div>
      <p className="mt-1 text-xs text-muted-foreground">How long a generated ad's image/video stays in storage before automatic cleanup. Only the media files are removed — the ad's caption, metadata, and analytics stay forever. Also caps how far out a post can be scheduled (measured from each ad's own creation date), so the two settings can never drift apart.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-slate-500 focus:outline-none" />
        <span className="text-xs text-muted-foreground">months</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function DeveloperOverview() {
  const allowed = useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();

  const [data, setData] = useState<PlatformOverviewOut | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!allowed) return;
    devApi("/developer/overview")
      .then(setData)
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load overview"); });
  }, [allowed]);

  if (!allowed) return null;

  return (
    <DeveloperShell title="Platform Overview">
      <OpenRouterBalanceCard />
      <TeamLimitCard />
      <DataRetentionCard />
      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}
      {!data ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Total companies", data.total_companies],
              ["Active paid subscriptions", data.active_paid_subscriptions],
              ["Estimated MRR", `$${data.estimated_mrr_usd.toLocaleString()}`],
              ["Total users (active)", data.total_users],
              ["Total ads generated", data.total_ads],
              ["Total campaigns", data.total_campaigns],
              ["Unresolved flagged content", data.flagged_unresolved_total],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-slate-700/50 bg-card/60 p-4">
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="mt-2 font-display text-2xl font-bold">{v}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-slate-700/50 bg-card/60 p-5">
            <div className="text-sm font-semibold text-foreground">Companies by plan</div>
            <p className="mt-1 text-xs text-muted-foreground">Estimated MRR uses each tier's base monthly price — actual revenue may differ slightly with multi-month term discounts.</p>
            <div className="mt-4 space-y-2">
              {Object.entries(data.companies_by_tier).sort().map(([tier, count]) => (
                <div key={tier} className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-background/40 px-3 py-2 text-sm">
                  <span className="text-foreground">{TIER_LABEL[tier] || tier}</span>
                  <span className="font-semibold text-foreground">{count} {count === 1 ? "company" : "companies"}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </DeveloperShell>
  );
}
