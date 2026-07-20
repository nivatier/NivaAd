import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi, type CompanyAdminOut } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/companies")({
  component: DeveloperCompanies,
  head: () => ({ meta: [{ title: "Companies — NivaAd Developer" }] }),
});

const TIER_LABEL: Record<string, string> = { free: "Free", starter: "Starter", growth: "Growth", pro: "Pro" };
const TIER_COLOR: Record<string, string> = {
  free: "border-border text-muted-foreground",
  starter: "border-secondary/40 bg-secondary/10 text-secondary",
  growth: "border-primary/40 bg-primary/10 text-primary",
  pro: "border-amber-500/40 bg-amber-500/10 text-amber-400",
};

function DeveloperCompanies() {
  const allowed = useRequireDeveloperPermission("companies");
  const handleAuthError = useDevAuthErrorHandler();

  const [companies, setCompanies] = useState<CompanyAdminOut[] | null>(null);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!allowed) return;
    devApi("/developer/companies")
      .then(setCompanies)
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load companies"); });
  }, [allowed]);

  if (!allowed) return null;

  const filtered = (companies || []).filter((c) => {
    if (tierFilter && c.tier !== tierFilter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <DeveloperShell title="Companies">
      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-700/50 bg-input/40 px-3 py-2 text-sm text-foreground focus:border-slate-500 focus:outline-none"
        />
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className="rounded-lg border border-slate-700/50 bg-input/40 px-3 py-2 text-sm text-foreground">
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="pro">Pro</option>
        </select>
        {companies && <span className="text-xs text-muted-foreground">{filtered.length} of {companies.length}</span>}
      </div>

      {companies === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 bg-card/60 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Sub status</th>
                <th className="px-4 py-3 font-medium">Credits</th>
                <th className="px-4 py-3 font-medium">Users</th>
                <th className="px-4 py-3 font-medium">Ads</th>
                <th className="px-4 py-3 font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.map((c) => (
                <tr key={c.id} className="bg-card/30 hover:bg-card/50">
                  <td className="px-4 py-3 text-foreground">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${TIER_COLOR[c.tier] || TIER_COLOR.free}`}>{TIER_LABEL[c.tier] || c.tier}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.subscription_status}{c.cancel_at_period_end && <span className="ml-1 text-amber-400">(canceling)</span>}
                  </td>
                  <td className="px-4 py-3 text-foreground">{c.credits_balance}</td>
                  <td className="px-4 py-3 text-foreground">{c.user_count}</td>
                  <td className="px-4 py-3 text-foreground">{c.ads_total}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No companies match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </DeveloperShell>
  );
}
