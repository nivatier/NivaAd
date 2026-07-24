import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/monitoring")({
  component: DeveloperMonitoring,
  head: () => ({ meta: [{ title: "Monitoring — NivaSpark" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────
type MonitoringData = {
  live_jobs: number; queued_jobs: number; avg_job_duration_s: number;
  jobs_by_status_24h: Record<string, number>;
  queue_per_hour: { hour: string; total: number; generating: number; queued: number; failed: number }[];
  jobs_per_hour: { hour: string; count: number }[];
  jobs_per_day: { date: string; count: number }[];
  jobs_per_month: { month: string; count: number }[];
  jobs_by_kind_7d: { text: number; image: number; video: number };
  total_jobs_7d: number; total_jobs_30d: number;
  failed_jobs_7d: number; failure_rate_pct: number;
  top_errors: { model: string | null; error: string; count: number }[];
  dau: number; wau: number;
  dau_per_day: { date: string; dau: number }[];
  new_companies_7d: number;
  credits_consumed_24h: number; credits_consumed_7d: number;
  credits_per_day: { date: string; credits: number }[];
  credits_by_tier_7d: Record<string, number>;
  estimated_storage_gb: number;
};

// ── Charts ───────────────────────────────────────────────────────────────────
function MiniBarChart({ data, valueKey, labelKey, color = "var(--color-primary)", height = 64 }: {
  data: Record<string, any>[]; valueKey: string; labelKey?: string; color?: string; height?: number;
}) {
  if (!data.length) return <div className="text-[10px] text-muted-foreground">No data yet</div>;
  const max = Math.max(...data.map((d) => d[valueKey] as number), 1);
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {data.map((d, i) => {
        const lk = labelKey ?? (d.date ? "date" : d.hour ? "hour" : d.month ? "month" : "");
        const label = lk === "date" ? new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" })
          : lk === "month" ? d.month
          : d[lk] ?? "";
        return (
          <div key={i} className="flex-1 relative group min-w-0">
            <div className="w-full rounded-sm" style={{ height: `${Math.max(2, (d[valueKey] / max) * height)}px`, background: color, opacity: 0.85 }} />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex z-10 pointer-events-none">
              <div className="rounded-lg bg-foreground px-2 py-1 text-[9px] font-semibold text-background whitespace-nowrap shadow-lg">
                {label}: <span className="text-primary">{d[valueKey]}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Stacked bar chart for queue breakdown per hour */
function StackedBarChart({ data, height = 80 }: {
  data: { hour: string; generating: number; queued: number; failed: number; total: number }[];
  height?: number;
}) {
  if (!data.length) return <div className="text-[10px] text-muted-foreground">No data yet</div>;
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-px" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 relative group min-w-0 flex flex-col justify-end" style={{ height }}>
            <div className="w-full flex flex-col justify-end rounded-sm overflow-hidden" style={{ height: `${Math.max(2, (d.total / max) * height)}px` }}>
              {d.failed > 0    && <div className="w-full shrink-0" style={{ height: `${(d.failed    / Math.max(d.total,1)) * 100}%`, background: "var(--color-destructive)", minHeight: 2 }} />}
              {d.queued > 0    && <div className="w-full shrink-0" style={{ height: `${(d.queued    / Math.max(d.total,1)) * 100}%`, background: "oklch(0.78 0.18 85)",       minHeight: 2 }} />}
              {d.generating > 0 && <div className="w-full shrink-0" style={{ height: `${(d.generating / Math.max(d.total,1)) * 100}%`, background: "var(--color-primary)",     minHeight: 2 }} />}
            </div>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex z-10 pointer-events-none">
              <div className="rounded-lg bg-foreground px-2 py-1 text-[9px] font-semibold text-background whitespace-nowrap shadow-lg text-left">
                <div>{d.hour}</div>
                <div className="text-primary">generating: {d.generating}</div>
                <div className="text-amber-400">queued: {d.queued}</div>
                {d.failed > 0 && <div className="text-destructive">failed: {d.failed}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Generating</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400" /> Queued</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-destructive" /> Failed</span>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = false, warning = false }: {
  label: string; value: string | number; sub?: string; accent?: boolean; warning?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${warning ? "border-destructive/40 bg-destructive/5" : accent ? "border-primary/40 bg-primary/5" : "border-border bg-card/60"}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold ${warning ? "text-destructive" : accent ? "text-primary" : "text-foreground"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Migration signal badge ────────────────────────────────────────────────────
function Signal({ level, text }: { level: "ok" | "warn" | "critical"; text: string }) {
  const cls = level === "critical" ? "bg-destructive/15 border-destructive/50 text-destructive"
    : level === "warn" ? "bg-amber-500/15 border-amber-500/50 text-amber-400"
    : "bg-emerald-500/15 border-emerald-500/50 text-emerald-400";
  const icon = level === "critical" ? "🔴" : level === "warn" ? "🟡" : "🟢";
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${cls}`}>
      <span>{icon}</span>{text}
    </div>
  );
}

// ── Tab 1: Worker Queue ───────────────────────────────────────────────────────
function WorkerQueueTab({ d }: { d: MonitoringData }) {
  const [view, setView] = useState<"now" | "hourly">("now");
  const totalLive = d.live_jobs + d.queued_jobs;
  const queueSignal = totalLive >= 6 ? "critical" : totalLive >= 3 ? "warn" : "ok";
  const waitSignal = d.avg_job_duration_s > 300 ? "critical" : d.avg_job_duration_s > 120 ? "warn" : "ok";

  return (
    <div className="space-y-5">
      {/* Migration signals */}
      <div className="space-y-2">
        <Signal level={queueSignal} text={`${totalLive} jobs live/queued right now — ${queueSignal === "critical" ? "consider adding workers" : queueSignal === "warn" ? "watch closely" : "healthy"}`} />
        <Signal level={waitSignal} text={`Avg job duration ${d.avg_job_duration_s}s — ${waitSignal === "critical" ? "jobs taking too long, check worker logs" : waitSignal === "warn" ? "slightly elevated" : "healthy"}`} />
        <Signal level={d.queued_jobs > 4 ? "critical" : d.queued_jobs > 1 ? "warn" : "ok"} text={`${d.queued_jobs} jobs waiting — ${d.queued_jobs > 4 ? "move to ECS auto-scaling" : d.queued_jobs > 1 ? "add a Railway worker" : "queue is clear"}`} />
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Currently generating" value={d.live_jobs} accent={d.live_jobs > 0} />
        <StatCard label="Waiting in queue" value={d.queued_jobs} warning={d.queued_jobs > 3} />
        <StatCard label="Avg job duration" value={`${d.avg_job_duration_s}s`} sub="last 24 h" warning={d.avg_job_duration_s > 300} />
        <StatCard label="Completed today" value={d.jobs_by_status_24h["ready"] ?? 0} />
      </div>

      {/* View toggle */}
      <div className="flex gap-1.5">
        {(["now", "hourly"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${view === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
            {v === "now" ? "Status breakdown" : "Per hour (24 h)"}
          </button>
        ))}
      </div>

      {view === "now" && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground mb-3">Job status breakdown — last 24 h</div>
          <div className="space-y-2">
            {Object.entries(d.jobs_by_status_24h).map(([status, count]) => {
              const total = Object.values(d.jobs_by_status_24h).reduce((a, b) => a + b, 0) || 1;
              const pct = Math.round((count / total) * 100);
              const color = status === "ready" ? "bg-emerald-400" : status === "failed" ? "bg-destructive" : status === "generating" ? "bg-primary" : "bg-amber-400";
              return (
                <div key={status} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-[11px] capitalize text-foreground">{status}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted/30">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-10 text-right text-[11px] text-muted-foreground">{count}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "hourly" && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground mb-1">Queue depth per hour — last 24 h</div>
          <p className="text-[11px] text-muted-foreground mb-4">Each bar shows generating (blue) + queued (amber) + failed (red) jobs started in that hour. Hover for detail.</p>
          <StackedBarChart data={d.queue_per_hour} height={100} />
          <div className="mt-3 flex justify-between text-[9px] text-muted-foreground overflow-hidden">
            {d.queue_per_hour.filter((_, i) => i % 4 === 0).map((r) => (
              <span key={r.hour}>{r.hour}</span>
            ))}
          </div>
          {d.queue_per_hour.length === 0 && (
            <div className="text-[11px] text-muted-foreground text-center py-4">No jobs in the last 24 hours</div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-xs font-semibold text-muted-foreground mb-2">When to add workers</div>
        <div className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
          <div>• <span className="text-foreground font-medium">Queue ≥ 3 jobs</span> → add a Railway worker manually</div>
          <div>• <span className="text-foreground font-medium">Queue regularly ≥ 6 jobs</span> or you're adding workers weekly → migrate to AWS ECS auto-scaling</div>
          <div>• <span className="text-foreground font-medium">Avg duration &gt; 5 min</span> → video jobs saturating workers, add concurrency</div>
          <div>• <span className="text-foreground font-medium">30–50 active paying users generating simultaneously</span> → ECS migration point</div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 2: Job Volume ─────────────────────────────────────────────────────────
function JobVolumeTab({ d }: { d: MonitoringData }) {
  const [view, setView] = useState<"hourly" | "daily" | "monthly">("daily");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Jobs last 24 h" value={d.jobs_per_hour.reduce((a, b) => a + b.count, 0)} />
        <StatCard label="Jobs last 30 d" value={d.total_jobs_30d} />
        <StatCard label="Text ads (30 d)" value={d.jobs_by_kind_7d.text} />
        <StatCard label="Video ads (30 d)" value={d.jobs_by_kind_7d.video} accent={d.jobs_by_kind_7d.video > 0} />
      </div>

      {/* View toggle */}
      <div className="flex gap-1.5">
        {(["hourly", "daily", "monthly"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${view === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
            {v === "hourly" ? "Per hour (24 h)" : v === "daily" ? "Per day (30 d)" : "Per month (12 mo)"}
          </button>
        ))}
      </div>

      {view === "hourly" && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground mb-1">Jobs per hour — last 24 h</div>
          <p className="text-[11px] text-muted-foreground mb-4">Total jobs started each hour. Peaks show when your users are most active.</p>
          <MiniBarChart data={d.jobs_per_hour} valueKey="count" labelKey="hour" color="var(--color-primary)" height={100} />
          <div className="mt-2 flex justify-between text-[9px] text-muted-foreground overflow-hidden">
            {d.jobs_per_hour.filter((_, i) => i % 4 === 0).map((r) => (
              <span key={r.hour}>{r.hour}</span>
            ))}
          </div>
          {d.jobs_per_hour.length === 0 && <div className="text-[11px] text-muted-foreground text-center py-4">No jobs in the last 24 hours</div>}
        </div>
      )}

      {view === "daily" && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground mb-1">Jobs per day — last 30 days</div>
          <p className="text-[11px] text-muted-foreground mb-4">Daily generation volume. Consistent growth here is your primary scaling signal.</p>
          <MiniBarChart data={d.jobs_per_day} valueKey="count" labelKey="date" color="var(--color-primary)" height={100} />
          <div className="mt-2 flex justify-between text-[9px] text-muted-foreground overflow-hidden">
            {d.jobs_per_day.filter((_, i) => i % 7 === 0).map((r) => (
              <span key={r.date}>{new Date(r.date).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
            ))}
          </div>
          {d.jobs_per_day.length === 0 && <div className="text-[11px] text-muted-foreground text-center py-4">No data yet</div>}
        </div>
      )}

      {view === "monthly" && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground mb-1">Jobs per month — last 12 months</div>
          <p className="text-[11px] text-muted-foreground mb-4">Month-over-month growth. When monthly volume doubles, your worker fleet should too.</p>
          <MiniBarChart data={d.jobs_per_month} valueKey="count" labelKey="month" color="oklch(0.78 0.12 85)" height={100} />
          <div className="mt-2 flex justify-between text-[9px] text-muted-foreground overflow-hidden">
            {d.jobs_per_month.map((r) => <span key={r.month}>{r.month.split(" ")[0]}</span>)}
          </div>
          {d.jobs_per_month.length === 0 && <div className="text-[11px] text-muted-foreground text-center py-4">No data yet</div>}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground mb-3">Job type breakdown (30 d)</div>
        {(() => {
          const total = d.jobs_by_kind_7d.text + d.jobs_by_kind_7d.image + d.jobs_by_kind_7d.video || 1;
          return (
            <div className="space-y-2">
              {([["Text ✍️", d.jobs_by_kind_7d.text, "bg-muted-foreground/50"], ["Image 🖼", d.jobs_by_kind_7d.image, "bg-primary"], ["Video 🎬", d.jobs_by_kind_7d.video, "bg-cyan-400"]] as const).map(([label, count, color]) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-20 shrink-0 text-[11px] text-foreground">{label}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted/30">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round((count / total) * 100)}%` }} />
                  </div>
                  <div className="w-16 text-right text-[11px] text-muted-foreground">{count} ({Math.round((count / total) * 100)}%)</div>
                </div>
              ))}
            </div>
          );
        })()}
        <p className="mt-3 text-[11px] text-muted-foreground">Video jobs are 4–8× heavier on workers than text/image. High video % accelerates the worker scaling trigger.</p>
      </div>
    </div>
  );
}

// ── Tab 3: Failure Rate ───────────────────────────────────────────────────────
function FailureRateTab({ d }: { d: MonitoringData }) {
  const failSignal = d.failure_rate_pct > 10 ? "critical" : d.failure_rate_pct > 3 ? "warn" : "ok";
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Signal level={failSignal} text={`Failure rate ${d.failure_rate_pct}% — ${failSignal === "critical" ? "critically high, check worker logs immediately" : failSignal === "warn" ? "elevated, investigate top errors below" : "healthy (< 3%)"}`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Failed jobs (7 d)" value={d.failed_jobs_7d} warning={d.failed_jobs_7d > 0} />
        <StatCard label="Failure rate" value={`${d.failure_rate_pct}%`} warning={d.failure_rate_pct > 3} />
        <StatCard label="Total jobs (7 d)" value={d.total_jobs_7d} />
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground mb-3">Top errors — last 7 days</div>
        {d.top_errors.length === 0 ? (
          <div className="text-[11px] text-emerald-400">✓ No failures in the last 7 days</div>
        ) : (
          <div className="space-y-2">
            {d.top_errors.map((e, i) => (
              <div key={i} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-medium text-foreground">{e.model || "unknown model"}</span>
                  <span className="rounded-full bg-destructive/15 border border-destructive/40 px-2 py-0.5 text-[10px] font-semibold text-destructive">{e.count}×</span>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono break-all">{e.error || "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-xs font-semibold text-muted-foreground mb-2">What failure rate means for infrastructure</div>
        <div className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
          <div>• <span className="text-foreground font-medium">&lt; 3%</span> — healthy, usually model API timeouts</div>
          <div>• <span className="text-foreground font-medium">3–10%</span> — investigate; likely OpenRouter balance low or model overloaded</div>
          <div>• <span className="text-foreground font-medium">&gt; 10%</span> — infrastructure issue; check worker logs, Redis connectivity, DB connections</div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 4: Active Users ───────────────────────────────────────────────────────
function ActiveUsersTab({ d }: { d: MonitoringData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="DAU (today)" value={d.dau} accent={d.dau > 0} />
        <StatCard label="WAU (7 d)" value={d.wau} accent={d.wau > 0} />
        <StatCard label="New companies (7 d)" value={d.new_companies_7d} accent={d.new_companies_7d > 0} />
        <StatCard label="DAU/WAU ratio" value={d.wau > 0 ? `${Math.round((d.dau / d.wau) * 100)}%` : "—"} sub="stickiness indicator" />
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground mb-4">Daily active users — last 7 days</div>
        <MiniBarChart data={d.dau_per_day} valueKey="dau" color="var(--color-primary)" height={80} />
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          {d.dau_per_day.map((r) => (
            <span key={r.date}>{new Date(r.date).toLocaleDateString("en", { weekday: "short" })}</span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-xs font-semibold text-muted-foreground mb-2">User-based migration triggers</div>
        <div className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
          <div>• <span className="text-foreground font-medium">DAU &gt; 50</span> → monitor API response times closely</div>
          <div>• <span className="text-foreground font-medium">WAU &gt; 200</span> → consider read replica for PostgreSQL</div>
          <div>• <span className="text-foreground font-medium">30-50 users generating simultaneously</span> → Railway → ECS worker migration point</div>
          <div>• <span className="text-foreground font-medium">DAU/WAU &gt; 40%</span> → strong retention, scale proactively before it becomes reactive</div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 5: Credits & Revenue ──────────────────────────────────────────────────
function CreditsTab({ d }: { d: MonitoringData }) {
  const CREDIT_VALUE_USD = 0.45;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Credits consumed (24 h)" value={d.credits_consumed_24h} sub={`≈ $${(d.credits_consumed_24h * CREDIT_VALUE_USD).toFixed(2)}`} accent />
        <StatCard label="Credits consumed (7 d)" value={d.credits_consumed_7d} sub={`≈ $${(d.credits_consumed_7d * CREDIT_VALUE_USD).toFixed(2)}`} accent />
        <StatCard label="Avg per day (7 d)" value={Math.round(d.credits_consumed_7d / 7)} sub="credits/day" />
        <StatCard label="Projected monthly" value={Math.round((d.credits_consumed_7d / 7) * 30)} sub={`≈ $${((d.credits_consumed_7d / 7) * 30 * CREDIT_VALUE_USD).toFixed(0)}/mo`} />
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground mb-4">Credits consumed per day — last 7 days</div>
        <MiniBarChart data={d.credits_per_day} valueKey="credits" color="oklch(0.78 0.12 85)" height={80} />
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          {d.credits_per_day.map((r) => (
            <span key={r.date}>{new Date(r.date).toLocaleDateString("en", { weekday: "short" })}</span>
          ))}
        </div>
      </div>

      {Object.keys(d.credits_by_tier_7d).length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground mb-3">Credits by plan tier (7 d)</div>
          <div className="space-y-2">
            {Object.entries(d.credits_by_tier_7d).sort((a, b) => b[1] - a[1]).map(([tier, credits]) => {
              const total = Object.values(d.credits_by_tier_7d).reduce((a, b) => a + b, 0) || 1;
              return (
                <div key={tier} className="flex items-center gap-3">
                  <div className="w-20 shrink-0 text-[11px] capitalize text-foreground">{tier}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted/30">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round((credits / total) * 100)}%` }} />
                  </div>
                  <div className="w-20 text-right text-[11px] text-muted-foreground">{credits} cr</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 6: Storage ────────────────────────────────────────────────────────────
function StorageTab({ d }: { d: MonitoringData }) {
  const r2FreeGb = 10;
  const usedPct = Math.min(100, Math.round((d.estimated_storage_gb / r2FreeGb) * 100));
  const storageSignal = usedPct > 80 ? "critical" : usedPct > 50 ? "warn" : "ok";
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Signal level={storageSignal} text={`≈ ${d.estimated_storage_gb} GB used — ${usedPct}% of Cloudflare R2 free tier (10 GB)`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Estimated total storage" value={`${d.estimated_storage_gb} GB`} warning={usedPct > 80} />
        <StatCard label="R2 free tier remaining" value={`${Math.max(0, r2FreeGb - d.estimated_storage_gb).toFixed(1)} GB`} />
        <StatCard label="R2 free tier used" value={`${usedPct}%`} warning={usedPct > 80} />
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Storage breakdown estimate</div>
        <div className="text-[11px] text-muted-foreground space-y-1">
          <div>• Images: ~0.5 MB per ad result (PNG after reframe/padding)</div>
          <div>• Videos: ~15 MB per video ad (depends on model and duration)</div>
          <div>• Total estimate is conservative — actual varies by model output size</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Storage cost reference</div>
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          {[
            ["Cloudflare R2 — free", "0–10 GB free, then $0.015/GB/mo, no egress fees"],
            ["Cloudflare R2 — paid", "$0.015/GB stored + $0.36/million reads"],
            ["AWS S3 Standard", "$0.023/GB + $0.09/GB egress (expensive at video scale)"],
            ["Backblaze B2", "$0.006/GB stored, first 1 GB egress free/day"],
          ].map(([name, desc]) => (
            <div key={name} className="rounded-lg border border-border bg-background/40 p-2">
              <div className="font-medium text-foreground">{name}</div>
              <div className="mt-0.5 text-muted-foreground">{desc}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">R2 is recommended — same S3 API as MinIO, zero egress fees critical for video delivery.</p>
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
const TABS = [
  { key: "queue",   label: "⚙️ Worker Queue" },
  { key: "volume",  label: "📊 Job Volume" },
  { key: "failure", label: "❌ Failure Rate" },
  { key: "users",   label: "👥 Active Users" },
  { key: "credits", label: "💳 Credits" },
  { key: "storage", label: "💾 Storage" },
] as const;
type TabKey = typeof TABS[number]["key"];

function DeveloperMonitoring() {
  const allowed = useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();
  const [data, setData] = useState<MonitoringData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("queue");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(() => {
    if (!allowed) return;
    setLoading(true); setErr("");
    devApi("/developer/monitoring")
      .then((d) => { setData(d); setLastRefresh(new Date()); })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load monitoring data"); })
      .finally(() => setLoading(false));
  }, [allowed]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!allowed) return null;

  return (
    <DeveloperShell title="Monitoring">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Live platform health — auto-refreshes every 30 s.
          {lastRefresh && <span className="ml-1">Last updated: {lastRefresh.toLocaleTimeString()}</span>}
        </p>
        <button onClick={load} disabled={loading}
          className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ring disabled:opacity-50">
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${tab === t.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {err && <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</div>}

      {!data && loading && (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading monitoring data…</div>
      )}

      {data && (
        <>
          {tab === "queue"   && <WorkerQueueTab  d={data} />}
          {tab === "volume"  && <JobVolumeTab    d={data} />}
          {tab === "failure" && <FailureRateTab  d={data} />}
          {tab === "users"   && <ActiveUsersTab  d={data} />}
          {tab === "credits" && <CreditsTab      d={data} />}
          {tab === "storage" && <StorageTab      d={data} />}
        </>
      )}
    </DeveloperShell>
  );
}
