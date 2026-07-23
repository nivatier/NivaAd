import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AppShell, Panel } from "@/components/app-shell";
import { PLATFORMS } from "@/components/create-ad-parts";
import { useRequireCapability } from "@/hooks/use-require-capability";
import { api } from "@/lib/api";

export const Route = createFileRoute("/app/analytics")({
  component: Analytics,
  head: () => ({ meta: [{ title: "Analytics — NivaSpark" }] }),
});

type AnalyticsData = {
  ads_created_total: number;
  ads_created_this_month: number;
  credits_used_this_month: number;
  scheduled_pending: number;
  campaigns_total: number;
  ads_by_day: { date: string; count: number }[];
  platform_breakdown: Record<string, number>;
  status_breakdown: { created: number; scheduled: number; posted: number };
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  created: { label: "Created", color: "text-muted-foreground" },
  scheduled: { label: "Scheduled", color: "text-secondary" },
  posted: { label: "Posted", color: "text-primary" },
};

function Analytics() {
  const allowed = useRequireCapability("view_analytics");

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!allowed) return;
    api("/analytics").then(setData).catch((e: any) => setErr(e.message || "Could not load analytics"));
  }, [allowed]);

  if (!allowed) return null;

  const platformMax = data ? Math.max(1, ...Object.values(data.platform_breakdown)) : 1;
  const statusTotal = data ? data.status_breakdown.created + data.status_breakdown.scheduled + data.status_breakdown.posted : 1;

  return (
    <AppShell eyebrow="Insights" title="Analytics">
      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}
      {!data ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Ads created (all time)", data.ads_created_total],
              ["Ads created this month", data.ads_created_this_month],
              ["Credits used this month", data.credits_used_this_month],
              ["Scheduled (pending)", data.scheduled_pending],
            ].map(([l, v]) => (
              <Panel key={l as string}>
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="mt-2 font-display text-4xl font-bold text-gold-gradient">{v}</div>
              </Panel>
            ))}
          </div>

          <Panel className="mt-4">
            <div className="text-sm font-semibold text-foreground">Ads created — last 30 days</div>
            <div className="mt-4 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.ads_by_day} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    interval={4}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(d) => new Date(d as string).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  />
                  <Area type="monotone" dataKey="count" name="Ads created" stroke="var(--primary)" strokeWidth={2} fill="url(#adsGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Panel>
              <div className="text-sm font-semibold text-foreground">Platforms targeted</div>
              <p className="mt-1 text-[11px] text-muted-foreground">An ad targeting 2 platforms counts once for each.</p>
              <div className="mt-4 space-y-2.5">
                {PLATFORMS.map((p) => {
                  const count = data.platform_breakdown[p.id] || 0;
                  return (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
                      <span className="w-16 shrink-0 text-xs text-foreground">{p.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-gold-gradient" style={{ width: `${(count / platformMax) * 100}%` }} />
                      </div>
                      <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel>
              <div className="text-sm font-semibold text-foreground">Ad status breakdown</div>
              <p className="mt-1 text-[11px] text-muted-foreground">Matches the same Created / Scheduled / Posted filter as My Ads.</p>
              <div className="mt-4 space-y-3">
                {(["created", "scheduled", "posted"] as const).map((key) => {
                  const count = data.status_breakdown[key];
                  const pct = statusTotal > 0 ? (count / statusTotal) * 100 : 0;
                  const meta = STATUS_LABEL[key];
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={meta.color}>{meta.label}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-gold-gradient" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 text-xs text-muted-foreground">Campaigns: <span className="font-semibold text-foreground">{data.campaigns_total}</span></div>
            </Panel>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">Post-performance metrics (reach, clicks) appear here once direct platform posting is live — everything above reflects your real activity in NivaSpark today.</p>
        </>
      )}
    </AppShell>
  );
}
