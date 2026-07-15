import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "@/components/app-shell";
import { PLATFORMS } from "@/components/create-ad-parts";
import { TimezoneSelect, LiveClock } from "@/components/timezone-picker";
import { detectedTimeZone, formatInTimeZone } from "@/lib/timezone";
import { api, type ScheduledPostOut } from "@/lib/api";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/schedule")({
  component: Schedule,
  head: () => ({ meta: [{ title: "Schedule — NivaAd" }] }),
});

const PAGE_SIZE = 10;
const STATUS_COLOR: Record<string, string> = {
  pending: "text-secondary",
  posted: "text-primary",
  canceled: "text-muted-foreground",
  failed: "text-destructive",
};
const PHASE_LABEL: Record<string, string> = { teaser: "Teaser", launch: "Launch", followup: "Follow-up" };

type ScheduleListOut = { items: ScheduledPostOut[]; total_groups: number; page: number; page_size: number };

// Groups the per-platform rows the backend returns into one card per
// (ad, exact scheduled time) — so "Instagram + Facebook, same post, same
// time" shows as ONE entry with both platforms listed, not two separate
// rows that look like unrelated posts. The backend already paginates by
// group, so this is purely a DISPLAY grouping of an already-correct page
// of rows, not a re-sort or re-page.
function groupRows(rows: ScheduledPostOut[]) {
  const groups = new Map<string, ScheduledPostOut[]>();
  for (const r of rows) {
    const key = `${r.ad_id}__${r.scheduled_at}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.values());
}

function GroupCard({ group, timeZone, onCancel }: { group: ScheduledPostOut[]; timeZone: string; onCancel?: (id: string) => void }) {
  const first = group[0];
  const allSameStatus = group.every((r) => r.status === first.status);

  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground">{first.ad_title || "Untitled ad"}</span>
            {first.campaign_name && (
              <span className="shrink-0 rounded-full border border-secondary/40 bg-secondary/5 px-2 py-0.5 text-[10px] text-secondary">
                📣 {first.campaign_name}{first.campaign_phase && ` · ${PHASE_LABEL[first.campaign_phase] || first.campaign_phase}`}
              </span>
            )}
          </div>
          <div className={`mt-1 text-[11px] ${first.status === "pending" ? "text-secondary" : "text-muted-foreground"}`}>📅 {formatInTimeZone(first.scheduled_at, timeZone)}</div>
        </div>
        {allSameStatus && (
          <span className={`shrink-0 text-xs ${STATUS_COLOR[first.status] || "text-muted-foreground"}`}>{first.status}</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {group.map((r) => {
          const p = PLATFORMS.find((x) => x.id === r.platform);
          return (
            <div key={r.id} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1">
              <span className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-950" style={{ background: p?.color }}>{p?.tag}</span>
              <span className="text-[11px] text-foreground">{p?.name || r.platform}</span>
              {!allSameStatus && <span className={`text-[10px] ${STATUS_COLOR[r.status] || "text-muted-foreground"}`}>· {r.status}</span>}
              {onCancel && r.status === "pending" && (
                <button onClick={() => onCancel(r.id)} className="ml-0.5 text-[10px] text-muted-foreground hover:text-destructive">✕</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Schedule() {
  const allowed = useRequireCapability("view_schedule");

  const [data, setData] = useState<ScheduleListOut | null>(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" = all, "scheduled" | "posted" | "canceled" | "failed"
  const [timeZone, setTimeZone] = useState(detectedTimeZone());
  const [err, setErr] = useState("");

  async function load() {
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(PAGE_SIZE));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (statusFilter) params.set("status_filter", statusFilter);
      setData(await api(`/schedule?${params.toString()}`));
    } catch (e: any) {
      setErr(e.message || "Could not load the schedule");
    }
  }
  useEffect(() => {
    if (!allowed) return;
    load();
  }, [allowed, page, dateFrom, dateTo, statusFilter]);

  async function cancel(id: string) {
    setData((cur) => cur ? { ...cur, items: cur.items.map((r) => r.id === id ? { ...r, status: "canceled" } : r) } : cur);
    try { await api(`/schedule/${id}`, { method: "DELETE" }); } catch { load(); }
  }

  function clearFilters() {
    setDateFrom(""); setDateTo(""); setStatusFilter(""); setPage(1);
  }
  const hasFilters = dateFrom || dateTo || statusFilter;

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  const groups = data ? groupRows(data.items) : [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total_groups / PAGE_SIZE)) : 1;

  return (
    <AppShell eyebrow="Library" title="Schedule">
      <p className="mb-2 text-sm text-muted-foreground">
        Platforms: {PLATFORMS.map((p) => `${p.tag} ${p.name}`).join(" · ")}
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        Scheduled posts fire automatically when their time arrives (checked every minute). Each card below is one post — if it went out to multiple platforms at once, they're grouped together here, not shown as separate posts. A 📣 badge means it came from a campaign phase.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/40 p-3">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Viewing times in</div>
          <TimezoneSelect value={timeZone} onChange={setTimeZone} />
        </div>
        <div className="text-xs text-muted-foreground">
          🕐 Right now there: <LiveClock timeZone={timeZone} />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/40 p-4">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">From</div>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">To</div>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Status</div>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
            <option value="">Any status</option>
            <option value="scheduled">Scheduled (pending)</option>
            <option value="posted">Posted</option>
            <option value="canceled">Canceled</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        {hasFilters && <button onClick={clearFilters} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40">Clear filters</button>}
      </div>

      {err && <div className="mb-4 text-xs text-destructive">{err}</div>}

      {data === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : groups.length > 0 ? (
        <>
          <div className="space-y-2">
            {groups.map((g) => <GroupCard key={`${g[0].ad_id}__${g[0].scheduled_at}`} group={g} timeZone={timeZone} onCancel={cancel} />)}
          </div>

          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {data.page} of {totalPages} · {data.total_groups} post{data.total_groups !== 1 ? "s" : ""} total</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-border px-3 py-1.5 disabled:opacity-40">← Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-border px-3 py-1.5 disabled:opacity-40">Next →</button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState>
          {hasFilters ? "No scheduled posts match these filters." : "Nothing scheduled — generate an ad from a campaign phase and schedule it, or use \"Preview / Repost\" in My Ads."}
        </EmptyState>
      )}
    </AppShell>
  );
}
