import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PLATFORMS } from "@/components/create-ad-parts";
import { api, type ProductOut } from "@/lib/api";

export const Route = createFileRoute("/app/agent-niva")({
  component: AgentNiva,
  head: () => ({ meta: [{ title: "Agent Niva — NivaAd" }] }),
});

type ScrapeJob = { id: string; url: string; count: number; status: string; error: string | null; created_at: string };
type Recommendation = { id: string; source_url: string; status: string; title: string; description: string; audience: string; platforms: string[]; created_ad_id: string | null; created_at: string };
type AgentEvent = {
  id: string; name: string; month: number; day: number; lead_days: number; guidance: string; platforms: string[];
  product_id: string | null; enabled: boolean; skipped_years: number[]; last_run_year: number | null; next_run_date: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GENERATING = new Set(["queued", "running"]);

function PlatformChips({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLATFORMS.map((p) => (
        <button key={p.id} type="button" onClick={() => onToggle(p.id)}
          className={`rounded-full border px-3 py-1.5 text-xs ${selected.includes(p.id) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
          {p.tag} {p.name}
        </button>
      ))}
    </div>
  );
}

function QuickStartTab() {
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(5);
  const [focus, setFocus] = useState("");
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  async function loadRecs() {
    try { setRecs(await api("/agent/recommendations")); } catch (e: any) { setErr(e.message || "Could not load recommendations"); }
  }
  useEffect(() => { loadRecs(); }, []);

  useEffect(() => {
    if (!job || !GENERATING.has(job.status)) return;
    const t = setInterval(async () => {
      try {
        const j = await api(`/agent/quick-start/${job.id}`);
        setJob(j);
        if (j.status === "ready") loadRecs();
      } catch { /* transient — next poll retries */ }
    }, 3000);
    return () => clearInterval(t);
  }, [job]);

  async function start() {
    if (!url.trim()) return;
    setErr("");
    try {
      const j = await api("/agent/quick-start", { method: "POST", body: { url: url.trim(), count, focus: focus.trim() || null } });
      setJob(j);
    } catch (e: any) { setErr(e.message || "Could not start"); }
  }

  async function createFrom(rec: Recommendation) {
    sessionStorage.setItem(
      "nivaad_prefill_product",
      JSON.stringify({ name: rec.title, description: rec.description, audience: rec.audience }),
    );
    navigate({ to: "/app" });
  }

  async function dismiss(id: string) {
    setBusyId(id); setErr("");
    try { setRecs(await api(`/agent/recommendations/${id}/dismiss`, { method: "POST" })); }
    catch (e: any) { setErr(e.message || "Could not dismiss"); }
    setBusyId(null);
  }

  const pending = (recs || []).filter((r) => r.status === "pending");

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Study a website, get ad ideas</div>
        <p className="text-xs text-muted-foreground mb-3">Give Agent Niva your company's URL — it reads the site and recommends concrete ad ideas you can turn into real ads with one click.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourcompany.com"
            className="flex-1 min-w-[240px] rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}
            className="rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none">
            {[1, 2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} ad{n > 1 ? "s" : ""}</option>)}
          </select>
          <button onClick={start} disabled={!url.trim() || (job !== null && GENERATING.has(job.status))}
            className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
            {job && GENERATING.has(job.status) ? "Studying site…" : "Get ad ideas"}
          </button>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-foreground">Focus on a specific subject <span className="font-normal text-muted-foreground">(optional)</span></label>
          <textarea
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="e.g. our summer sale, the new iOS app, our loyalty programme…"
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <div className="mt-0.5 text-right text-[10px] text-muted-foreground">{focus.length}/500</div>
        </div>
        {job?.status === "failed" && <div className="mt-2 text-xs text-destructive">Couldn't do that: {job.error}</div>}
      </div>

      {err && <div className="text-xs text-destructive">{err}</div>}

      <div>
        <div className="text-sm font-semibold text-foreground mb-3">Ideas to review ({pending.length})</div>
        {recs === null ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="text-xs text-muted-foreground">No pending ideas yet — run Quick Start above.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card/40 p-4">
                <div className="text-sm font-semibold text-foreground">{r.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{r.description}</div>
                {r.audience && (
                  <div className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Audience:</span> {r.audience}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.platforms.map((p) => {
                    const meta = PLATFORMS.find((pl) => pl.id === p);
                    return <span key={p} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{meta?.tag || p}</span>;
                  })}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground truncate">from {r.source_url}</div>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => createFrom(r)}
                    className="rounded-full bg-gold-gradient px-3 py-1.5 text-xs font-semibold text-background">
                    Create this ad →
                  </button>
                  <button onClick={() => dismiss(r.id)} disabled={busyId === r.id}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50">
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventsTab() {
  const [events, setEvents] = useState<AgentEvent[] | null>(null);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AgentEvent | null>(null);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [month, setMonth] = useState(12);
  const [day, setDay] = useState(25);
  const [leadDays, setLeadDays] = useState(2);
  const [guidance, setGuidance] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["facebook", "instagram"]);
  const [productId, setProductId] = useState("");

  async function load() {
    try { setEvents(await api("/agent/events")); } catch (e: any) { setErr(e.message || "Could not load events"); }
  }
  useEffect(() => {
    load();
    api("/products").then(setProducts).catch(() => {});
  }, []);

  function resetForm() {
    setName(""); setMonth(12); setDay(25); setLeadDays(2); setGuidance(""); setPlatforms(["facebook", "instagram"]); setProductId("");
    setEditing(null); setShowForm(false);
  }

  function startEdit(ev: AgentEvent) {
    setEditing(ev); setName(ev.name); setMonth(ev.month); setDay(ev.day); setLeadDays(ev.lead_days);
    setGuidance(ev.guidance); setPlatforms(ev.platforms); setProductId(ev.product_id || "");
    setShowForm(true);
  }

  async function save() {
    if (!name.trim() || platforms.length === 0) return;
    setErr("");
    const body = { name: name.trim(), month, day, lead_days: leadDays, guidance, platforms, product_id: productId || null, enabled: editing ? editing.enabled : true };
    try {
      if (editing) await api(`/agent/events/${editing.id}`, { method: "PUT", body });
      else await api("/agent/events", { method: "POST", body });
      resetForm();
      load();
    } catch (e: any) { setErr(e.message || "Could not save event"); }
  }

  async function toggleEnabled(ev: AgentEvent) {
    setBusyId(ev.id); setErr("");
    try {
      await api(`/agent/events/${ev.id}`, { method: "PUT", body: { name: ev.name, month: ev.month, day: ev.day, lead_days: ev.lead_days, guidance: ev.guidance, platforms: ev.platforms, product_id: ev.product_id, enabled: !ev.enabled } });
      load();
    } catch (e: any) { setErr(e.message || "Could not update"); }
    setBusyId(null);
  }

  async function toggleSkipThisYear(ev: AgentEvent) {
    const year = new Date().getFullYear();
    const skipped = ev.skipped_years.includes(year);
    setBusyId(ev.id); setErr("");
    try {
      await api(`/agent/events/${ev.id}/${skipped ? "unskip-year" : "skip-year"}?year=${year}`, { method: "POST" });
      load();
    } catch (e: any) { setErr(e.message || "Could not update"); }
    setBusyId(null);
  }

  async function remove(id: string) {
    if (!confirm("Delete this recurring event? This can't be undone.")) return;
    setBusyId(id); setErr("");
    try { setEvents(await api(`/agent/events/${id}`, { method: "DELETE" })); }
    catch (e: any) { setErr(e.message || "Could not delete"); }
    setBusyId(null);
  }

  function togglePlatform(id: string) {
    setPlatforms((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  const thisYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground max-w-2xl">
        Define occasions Agent Niva should automatically create ads for — every year, it generates the ad the number of
        lead days you choose before the date, so it's ready in time. What happens after generation (draft only, scheduled
        for review, or fully automatic) is set platform-wide by your developer under Developer &gt; Settings.
      </p>

      {err && <div className="text-xs text-destructive">{err}</div>}

      <div className="space-y-3">
        {events === null ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="text-xs text-muted-foreground">No recurring events yet.</div>
        ) : events.map((ev) => {
          const skippedThisYear = ev.skipped_years.includes(thisYear);
          return (
            <div key={ev.id} className={`rounded-xl border p-4 ${ev.enabled ? "border-border bg-card/40" : "border-border/50 bg-card/20 opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{ev.name}</div>
                  <div className="text-xs text-muted-foreground">{MONTHS[ev.month - 1]} {ev.day} · generates {ev.lead_days} day{ev.lead_days === 1 ? "" : "s"} ahead</div>
                  {ev.next_run_date && <div className="text-[11px] text-muted-foreground mt-0.5">Next: generates {ev.next_run_date}</div>}
                  {ev.guidance && <div className="text-[11px] text-muted-foreground mt-1 max-w-md">{ev.guidance}</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ev.platforms.map((p) => {
                      const meta = PLATFORMS.find((pl) => pl.id === p);
                      return <span key={p} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{meta?.tag || p}</span>;
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => toggleSkipThisYear(ev)} disabled={busyId === ev.id}
                    className={`rounded-full border px-3 py-1 text-[11px] ${skippedThisYear ? "border-amber-500/50 text-amber-500" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                    {skippedThisYear ? `Skipping ${thisYear}` : `Skip ${thisYear}`}
                  </button>
                  <button onClick={() => toggleEnabled(ev)} disabled={busyId === ev.id}
                    className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-primary/40">
                    {ev.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => startEdit(ev)} className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-primary/40">Edit</button>
                  <button onClick={() => remove(ev.id)} disabled={busyId === ev.id} className="rounded-full border border-destructive/40 px-3 py-1 text-[11px] text-destructive hover:bg-destructive/10">Delete</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showForm ? (
        <div className="max-w-xl rounded-xl border border-primary/40 bg-card/60 p-4 space-y-3">
          <div className="text-sm font-semibold text-foreground">{editing ? "Edit event" : "New recurring event"}</div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Christmas"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="text-[11px] text-muted-foreground mb-1">Month</div>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <div className="text-[11px] text-muted-foreground mb-1">Day</div>
              <input type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
            </div>
            <div className="flex-1">
              <div className="text-[11px] text-muted-foreground mb-1">Lead days</div>
              <input type="number" min={0} max={60} value={leadDays} onChange={(e) => setLeadDays(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">What should the ad be about? (optional)</div>
            <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={2} placeholder="e.g. 20% off holiday sale, festive theme"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Link a product (optional)</div>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
              <option value="">None</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Platforms</div>
            <PlatformChips selected={platforms} onToggle={togglePlatform} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={!name.trim() || platforms.length === 0} className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
              {editing ? "Save changes" : "Create event"}
            </button>
            <button onClick={resetForm} className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="rounded-full border border-dashed border-primary/50 px-4 py-2 text-xs text-primary hover:bg-primary/5">
          + New recurring event
        </button>
      )}
    </div>
  );
}

function AgentNiva() {
  const [tab, setTab] = useState<"quick-start" | "events">("quick-start");
  return (
    <AppShell eyebrow="Library" title="Agent Niva">
      <p className="mb-5 text-xs text-muted-foreground max-w-2xl">Your AI marketing agent — studies your site for ad ideas, and keeps seasonal ads generating and scheduling themselves throughout the year.</p>
      <div className="flex gap-2 mb-5">
        {([["quick-start", "Quick Start"], ["events", "Recurring Events"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${tab === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "quick-start" ? <QuickStartTab /> : <EventsTab />}
    </AppShell>
  );
}
