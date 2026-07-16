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
