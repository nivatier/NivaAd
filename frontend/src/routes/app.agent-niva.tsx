import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { NovaHint } from "@/components/nova-hint";
import { RequirementChecklist } from "@/components/requirement-checklist";
import { PLATFORMS } from "@/components/create-ad-parts";
import { useConnectedPlatforms } from "@/hooks/use-connected-platforms";
import { api, type ProductOut } from "@/lib/api";

export const Route = createFileRoute("/app/agent-niva")({
  component: AgentNiva,
  head: () => ({ meta: [{ title: "Agent Niva — NivaSpark" }] }),
});

type ScrapeJob = { id: string; url: string; count: number; status: string; error: string | null; created_at: string };
type Recommendation = { id: string; source_url: string; status: string; title: string; description: string; audience: string; platforms: string[]; created_ad_id: string | null; created_at: string };
type AgentEvent = {
  id: string; name: string; month: number; day: number; lead_days: number; guidance: string; platforms: string[];
  product_id: string | null; enabled: boolean; approval_mode: string; skipped_years: number[]; last_run_year: number | null; next_run_date: string | null;
};

const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GENERATING = new Set(["queued", "running"]);
const THIS_YEAR = new Date().getFullYear();
const TODAY = new Date();

// ── Helpers ────────────────────────────────────────────────────────────

function eventStatus(ev: AgentEvent): "disabled" | "posted" | "generated" | "pending" {
  if (!ev.enabled) return "disabled";
  if (ev.last_run_year === THIS_YEAR) {
    // Check if the event date has passed — if so it's posted/done for this year
    const eventDate = new Date(THIS_YEAR, ev.month - 1, ev.day);
    return eventDate <= TODAY ? "posted" : "generated";
  }
  return "pending";
}

const STATUS_STYLES = {
  pending:   { pill: "bg-amber-500/15 border-amber-400/40 text-amber-300",   dot: "bg-amber-400",   label: "Scheduled" },
  generated: { pill: "bg-blue-500/15 border-blue-400/40 text-blue-300",     dot: "bg-blue-400",    label: "Ad Ready" },
  posted:    { pill: "bg-emerald-500/15 border-emerald-400/40 text-emerald-300", dot: "bg-emerald-400", label: "Posted" },
  disabled:  { pill: "bg-muted/30 border-border/30 text-muted-foreground/50", dot: "bg-muted-foreground/30", label: "Disabled" },
};

const APPROVAL_LABELS: Record<string, { label: string; short: string; description: string }> = {
  draft_only:      { label: "Draft only",          short: "Draft",     description: "Creates a draft. You'll get a notification to review and schedule it yourself. If you don't act before the event date, it's ignored." },
  schedule_review: { label: "Scheduled for review", short: "Review",   description: "Generates and schedules the ad, then notifies you to approve before it posts. If you don't act, the ad does not post." },
  auto_post:       { label: "Fully automatic",      short: "Auto",     description: "Generates and posts automatically. You'll get two advance notifications — one before generation, one before posting — with a chance to make changes." },
};

function PlatformChips({ selected, onToggle, platforms = PLATFORMS }: { selected: string[]; onToggle: (id: string) => void; platforms?: typeof PLATFORMS }) {
  return (
    <div className="flex flex-wrap gap-2">
      {platforms.map((p) => (
        <button key={p.id} type="button" onClick={() => onToggle(p.id)}
          className={`rounded-full border px-3 py-1.5 text-xs transition-all ${selected.includes(p.id) ? "border-primary bg-primary/15 text-primary shadow-[0_0_10px_-3px_oklch(0.78_0.12_85/0.4)]" : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
          {p.tag} {p.name}
        </button>
      ))}
    </div>
  );
}

// ── Event Modal ────────────────────────────────────────────────────────

function EventModal({ editing, products, defaultApproval, onSave, onClose }: {
  editing: AgentEvent | null;
  products: ProductOut[];
  defaultApproval: string;
  onSave: (ev: AgentEvent) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(editing?.name ?? "");
  const [month, setMonth] = useState(editing?.month ?? (TODAY.getMonth() + 1));
  const [day, setDay] = useState(editing?.day ?? 1);
  const [leadDays, setLeadDays] = useState(editing?.lead_days ?? 7);
  const [guidance, setGuidance] = useState(editing?.guidance ?? "");
  const [platforms, setPlatforms] = useState<string[]>(editing?.platforms ?? ["facebook", "instagram"]);
  const [productId, setProductId] = useState(editing?.product_id ?? "");
  const [approvalMode, setApprovalMode] = useState(editing?.approval_mode ?? defaultApproval);
  const connectedPlatformIds = useConnectedPlatforms();
  const availablePlatforms = connectedPlatformIds === null ? PLATFORMS : PLATFORMS.filter((p) => connectedPlatformIds.has(p.id));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function togglePlatform(id: string) {
    setPlatforms((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function save() {
    if (!name.trim() || platforms.length === 0) return;
    setSaving(true); setErr("");
    try {
      const body = { name: name.trim(), month, day, lead_days: leadDays, guidance, platforms, product_id: productId || null, enabled: editing?.enabled ?? true, approval_mode: approvalMode };
      const result = editing
        ? await api(`/agent/events/${editing.id}`, { method: "PUT", body })
        : await api("/agent/events", { method: "POST", body });
      onSave(result);
    } catch (e: any) { setErr(e.message || "Could not save"); }
    setSaving(false);
  }

  function generateNow() {
    const eventDate = new Date(THIS_YEAR, month - 1, day);
    sessionStorage.setItem("nivaad_prefill_product", JSON.stringify({
      name, description: guidance || `${name} ad`,
      scheduled_date: eventDate.toISOString().split("T")[0],
      platforms,
    }));
    onClose();
    navigate({ to: "/app" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl overflow-hidden">
        {/* glass header */}
        <div className="border-b border-white/[0.07] px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-primary/70">Recurring Event</div>
            <div className="mt-0.5 text-base font-bold text-foreground">{editing ? "Edit event" : "New recurring event"}</div>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-muted-foreground hover:text-foreground transition">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Event name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Christmas, Black Friday, Summer Sale"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition" />
          </div>

          {/* Date + Lead Days */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Month</label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
                {MONTHS_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Day</label>
              <input type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Lead days</label>
              <input type="number" min={0} max={60} value={leadDays} onChange={(e) => setLeadDays(Number(e.target.value))}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">Ad generates {leadDays} day{leadDays !== 1 ? "s" : ""} before {MONTHS[month - 1]} {day}.</p>

          {/* Guidance */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Ad brief <span className="normal-case font-normal">(optional)</span></label>
            <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={2} placeholder="e.g. 20% off everything, festive theme, highlight gift bundles"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none transition resize-none" />
          </div>

          {/* Approval mode */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">What happens after the ad generates</label>
            <div className="mt-2 grid gap-2">
              {Object.entries(APPROVAL_LABELS).map(([key, val]) => (
                <button key={key} type="button" onClick={() => setApprovalMode(key)}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${approvalMode === key ? "border-primary/50 bg-primary/10 shadow-[0_0_14px_-4px_oklch(0.78_0.12_85/0.3)]" : "border-white/8 bg-white/3 hover:border-white/15"}`}>
                  <div className={`text-xs font-semibold ${approvalMode === key ? "text-primary" : "text-foreground"}`}>{val.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{val.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Product */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Link a product <span className="normal-case font-normal">(optional)</span></label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
              <option value="">None</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Platforms */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Platforms</label>
            <div className="mt-2"><PlatformChips selected={platforms} onToggle={togglePlatform} platforms={availablePlatforms} /></div>
          </div>

          {err && <div className="text-xs text-destructive">{err}</div>}
        </div>

        {/* Footer actions */}
        <div className="border-t border-white/[0.07] px-6 py-4 flex items-center justify-between gap-3">
          <button onClick={generateNow} className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-white/20 transition">
            Generate ad now →
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
            <div className="flex flex-col items-end gap-1">
              <RequirementChecklist items={[
                { label: "Event name", met: !!name.trim() },
                { label: "At least one platform", met: platforms.length > 0 },
              ]} />
              <button onClick={save} disabled={!name.trim() || platforms.length === 0 || saving}
              className="rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold text-background disabled:opacity-50 shadow-[var(--shadow-gold)] transition">
              {saving ? "Saving…" : editing ? "Save changes" : "Create event"}
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Month Grid ─────────────────────────────────────────────────────────

function EventPill({ ev, onExpand }: { ev: AgentEvent; onExpand: () => void }) {
  const st = STATUS_STYLES[eventStatus(ev)];
  return (
    <button onClick={onExpand}
      className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all hover:scale-[1.02] active:scale-[0.98] ${st.pill}`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${st.dot}`} />
        <span className="truncate">{ev.name}</span>
      </div>
      <div className="mt-0.5 pl-3 text-[10px] opacity-70">{MONTHS[ev.month - 1]} {ev.day} · {APPROVAL_LABELS[ev.approval_mode]?.short ?? ev.approval_mode}</div>
    </button>
  );
}

function EventDetailPanel({ ev, products, defaultApproval, onEdit, onToggleEnabled, onSkip, onRemove, onClose }: {
  ev: AgentEvent; products: ProductOut[]; defaultApproval: string;
  onEdit: () => void; onToggleEnabled: () => void; onSkip: () => void; onRemove: () => void; onClose: () => void;
}) {
  const st = STATUS_STYLES[eventStatus(ev)];
  const skippedThisYear = ev.skipped_years.includes(THIS_YEAR);
  const product = products.find((p) => p.id === ev.product_id);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl overflow-hidden">
        <div className="border-b border-white/[0.07] px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${st.pill.split(" ").find(c => c.startsWith("text-"))}`}>{st.label}</span>
            </div>
            <div className="mt-1 text-base font-bold text-foreground">{ev.name}</div>
            <div className="text-xs text-muted-foreground">{MONTHS_FULL[ev.month - 1]} {ev.day} · {ev.lead_days} day{ev.lead_days !== 1 ? "s" : ""} lead time</div>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground hover:text-foreground transition">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">After generation</div>
            <div className="mt-1 text-xs font-semibold text-foreground">{APPROVAL_LABELS[ev.approval_mode]?.label ?? ev.approval_mode}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{APPROVAL_LABELS[ev.approval_mode]?.description}</div>
          </div>

          {ev.guidance && (
            <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ad brief</div>
              <div className="mt-1 text-xs text-foreground">{ev.guidance}</div>
            </div>
          )}

          {product && (
            <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Linked product</div>
              <div className="mt-1 text-xs text-foreground">{product.name}</div>
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {ev.platforms.map((p) => {
              const meta = PLATFORMS.find((pl) => pl.id === p);
              return <span key={p} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-muted-foreground">{meta?.tag || p}</span>;
            })}
          </div>

          {ev.next_run_date && !ev.last_run_year && (
            <div className="text-[11px] text-muted-foreground">Next: ad generates on {ev.next_run_date}</div>
          )}
        </div>

        <div className="border-t border-white/[0.07] px-5 py-3 flex flex-wrap items-center gap-2">
          <button onClick={onEdit} className="rounded-full bg-gold-gradient px-4 py-1.5 text-xs font-semibold text-background shadow-[var(--shadow-gold)]">Edit</button>
          <button onClick={onSkip} className={`rounded-full border px-3 py-1.5 text-xs transition ${skippedThisYear ? "border-amber-500/50 text-amber-400" : "border-white/10 text-muted-foreground hover:text-foreground"}`}>
            {skippedThisYear ? `↩ Unskip ${THIS_YEAR}` : `Skip ${THIS_YEAR}`}
          </button>
          <button onClick={onToggleEnabled} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition">
            {ev.enabled ? "Disable" : "Enable"}
          </button>
          <button onClick={onRemove} className="rounded-full border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition ml-auto">Delete</button>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ events, products, defaultApproval, onEventSaved, onEventDeleted }: {
  events: AgentEvent[]; products: ProductOut[]; defaultApproval: string;
  onEventSaved: (ev: AgentEvent) => void; onEventDeleted: (events: AgentEvent[]) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<AgentEvent | null>(null);
  const [showModalFor, setShowModalFor] = useState<AgentEvent | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const expandedEvent = events.find((e) => e.id === expandedId) ?? null;

  async function toggleEnabled(ev: AgentEvent) {
    setBusyId(ev.id);
    try {
      const updated = await api(`/agent/events/${ev.id}`, { method: "PUT", body: { ...ev, enabled: !ev.enabled } });
      onEventSaved(updated);
    } catch { /* ignore */ }
    setBusyId(null);
    setExpandedId(null);
  }

  async function toggleSkip(ev: AgentEvent) {
    const year = THIS_YEAR;
    const skipped = ev.skipped_years.includes(year);
    setBusyId(ev.id);
    try {
      const updated = await api(`/agent/events/${ev.id}/${skipped ? "unskip-year" : "skip-year"}?year=${year}`, { method: "POST" });
      onEventSaved(updated);
    } catch { /* ignore */ }
    setBusyId(null);
    setExpandedId(null);
  }

  async function remove(ev: AgentEvent) {
    if (!confirm(`Delete "${ev.name}"? This can't be undone.`)) return;
    setBusyId(ev.id);
    try {
      const remaining = await api(`/agent/events/${ev.id}`, { method: "DELETE" });
      onEventDeleted(remaining);
    } catch { /* ignore */ }
    setBusyId(null);
    setExpandedId(null);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MONTHS.map((monthName, i) => {
          const monthNum = i + 1;
          const monthEvents = events.filter((e) => e.month === monthNum);
          const isCurrentMonth = monthNum === TODAY.getMonth() + 1;

          return (
            <div key={monthName}
              className={`relative rounded-2xl border p-3 backdrop-blur-sm transition-all ${isCurrentMonth ? "border-primary/30 bg-gradient-to-b from-primary/[0.07] to-primary/[0.02] shadow-[0_0_0_1px_oklch(0.78_0.12_85/0.15),0_8px_32px_-8px_oklch(0.78_0.12_85/0.12)]" : "border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-white/[0.02] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_4px_16px_-4px_rgba(0,0,0,0.3)]"}`}>
              {/* Month header */}
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-[11px] font-semibold uppercase tracking-widest ${isCurrentMonth ? "text-primary" : "text-muted-foreground"}`}>{monthName}</span>
                {monthEvents.length > 0 && (
                  <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{monthEvents.length}</span>
                )}
              </div>

              {/* Event pills */}
              <div className="space-y-1.5 min-h-[32px]">
                {monthEvents.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground/40 italic">No events</div>
                ) : (
                  monthEvents.map((ev) => (
                    <EventPill key={ev.id} ev={ev} onExpand={() => setExpandedId(ev.id)} />
                  ))
                )}
              </div>

              {/* Add button per month */}
              <button
                onClick={() => { setEditingEvent(null); setShowModalFor("new"); }}
                className="mt-2 w-full rounded-lg border border-dashed border-white/10 py-1 text-[10px] text-muted-foreground/40 hover:border-primary/30 hover:text-primary/60 transition-all">
                + add
              </button>
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {expandedEvent && !showModalFor && (
        <EventDetailPanel
          ev={expandedEvent}
          products={products}
          defaultApproval={defaultApproval}
          onEdit={() => { setShowModalFor(expandedEvent); setExpandedId(null); }}
          onToggleEnabled={() => toggleEnabled(expandedEvent)}
          onSkip={() => toggleSkip(expandedEvent)}
          onRemove={() => remove(expandedEvent)}
          onClose={() => setExpandedId(null)}
        />
      )}

      {/* Create / Edit modal */}
      {showModalFor !== null && (
        <EventModal
          editing={showModalFor === "new" ? null : showModalFor}
          products={products}
          defaultApproval={defaultApproval}
          onSave={(ev) => { onEventSaved(ev); setShowModalFor(null); }}
          onClose={() => setShowModalFor(null)}
        />
      )}
    </>
  );
}

// ── Events Tab ─────────────────────────────────────────────────────────

function EventsTab() {
  const [events, setEvents] = useState<AgentEvent[] | null>(null);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [defaultApproval, setDefaultApproval] = useState("draft_only");
  const [showModal, setShowModal] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const [evs, settings] = await Promise.all([api("/agent/events"), api("/agent/settings").catch(() => null)]);
      setEvents(evs);
      if (settings?.event_approval_mode) setDefaultApproval(settings.event_approval_mode);
    } catch (e: any) { setErr(e.message || "Could not load events"); }
  }

  useEffect(() => {
    load();
    api("/products").then(setProducts).catch(() => {});
  }, []);

  function handleEventSaved(updated: AgentEvent) {
    setEvents((prev) => {
      if (!prev) return [updated];
      const idx = prev.findIndex((e) => e.id === updated.id);
      return idx >= 0 ? prev.map((e) => (e.id === updated.id ? updated : e)) : [...prev, updated];
    });
  }

  function handleEventDeleted(remaining: AgentEvent[]) {
    setEvents(remaining);
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-xs text-muted-foreground">
            Define occasions Agent Niva should automatically create ads for — every year, it generates the ad the number of lead days you choose before the date. Set what happens after generation per event below.
          </p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] shrink-0">
          + New event
        </button>
      </div>

      {/* Colour key */}
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        {(["pending", "generated", "posted", "disabled"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[s].dot}`} />
            {STATUS_STYLES[s].label}
          </span>
        ))}
      </div>

      {err && <div className="text-xs text-destructive">{err}</div>}

      {events === null ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <MonthGrid
          events={events}
          products={products}
          defaultApproval={defaultApproval}
          onEventSaved={handleEventSaved}
          onEventDeleted={handleEventDeleted}
        />
      )}

      {showModal && (
        <EventModal
          editing={null}
          products={products}
          defaultApproval={defaultApproval}
          onSave={(ev) => { handleEventSaved(ev); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Quick Start Tab ────────────────────────────────────────────────────

type SavedSite = { id: string; url: string; label: string; scraped_at: string };

function QuickStartTab() {
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(5);
  const [focus, setFocus] = useState("");
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const navigate = useNavigate();
  // Saved sites
  const [savedSites, setSavedSites] = useState<SavedSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(""); // "" = use URL input
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadRecs() {
    try { setRecs(await api("/agent/recommendations")); } catch (e: any) { setErr(e.message || "Could not load recommendations"); }
  }
  async function loadSavedSites() {
    try { setSavedSites(await api("/agent/scraped-sites")); } catch { /* non-fatal */ }
  }
  useEffect(() => { loadRecs(); loadSavedSites(); }, []);

  useEffect(() => {
    if (!job || !GENERATING.has(job.status)) return;
    const t = setInterval(async () => {
      try {
        const j = await api(`/agent/quick-start/${job.id}`);
        setJob(j);
        if (j.status === "ready") {
          loadRecs();
          // Only prompt to save if this was a fresh scrape (no pre-selected saved site)
          if (!selectedSiteId) setShowSavePrompt(true);
        }
      } catch { /* transient */ }
    }, 3000);
    return () => clearInterval(t);
  }, [job, selectedSiteId]);

  async function start() {
    setErr(""); setShowSavePrompt(false);
    try {
      let j;
      if (selectedSiteId) {
        // Use cached scrape — no re-crawl
        j = await api(`/agent/quick-start/from-site/${selectedSiteId}`, { method: "POST", body: { count, focus: focus.trim() || null } });
      } else {
        if (!url.trim()) return;
        j = await api("/agent/quick-start", { method: "POST", body: { url: url.trim(), count, focus: focus.trim() || null } });
      }
      setJob(j);
    } catch (e: any) { setErr(e.message || "Could not start"); }
  }

  async function saveSite() {
    if (!job) return;
    setSaving(true);
    try {
      const site = await api(`/agent/scraped-sites?job_id=${job.id}`, { method: "POST", body: { label: saveLabel.trim() || job.url } });
      setSavedSites((prev) => {
        const without = prev.filter((s) => s.id !== site.id);
        return [site, ...without];
      });
      setShowSavePrompt(false);
      setSaveLabel("");
    } catch (e: any) { setErr(e.message || "Could not save site"); }
    setSaving(false);
  }

  async function deleteSavedSite(siteId: string) {
    try {
      await api(`/agent/scraped-sites/${siteId}`, { method: "DELETE" });
      setSavedSites((prev) => prev.filter((s) => s.id !== siteId));
      if (selectedSiteId === siteId) setSelectedSiteId("");
    } catch (e: any) { setErr(e.message || "Could not delete"); }
  }

  async function createFrom(rec: Recommendation) {
    sessionStorage.setItem("nivaad_prefill_product", JSON.stringify({ name: rec.title, description: rec.description, audience: rec.audience }));
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
      {/* Input card — glass */}
      <div className="rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_8px_32px_-8px_rgba(0,0,0,0.3)] backdrop-blur-sm">
        <div className="text-sm font-semibold text-foreground mb-1">Study a website, get ad ideas <NovaHint hintKey="page:quick-start" /></div>
        <p className="text-xs text-muted-foreground mb-4">Give Agent Niva your URL — it reads the site and recommends concrete ad ideas you can turn into real ads with one click.</p>

        {/* Saved sites dropdown — shown only when there are saved sites */}
        {savedSites.length > 0 && (
          <div className="mb-3">
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Use a saved site</label>
            <div className="flex items-center gap-2">
              <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
                <option value="">— Enter a new URL instead —</option>
                {savedSites.map((s) => (
                  <option key={s.id} value={s.id}>{s.label || s.url} · {new Date(s.scraped_at).toLocaleDateString()}</option>
                ))}
              </select>
              {selectedSiteId && (
                <button onClick={() => deleteSavedSite(selectedSiteId)}
                  title="Delete this saved site"
                  className="shrink-0 rounded-full border border-destructive/40 px-3 py-2 text-[11px] text-destructive hover:bg-destructive/10 transition">
                  🗑 Delete
                </button>
              )}
            </div>
          </div>
        )}

        {/* URL input — shown only when no saved site is selected */}
        {!selectedSiteId && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourcompany.com"
              className="flex-1 min-w-[200px] rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
            {[1, 2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} idea{n > 1 ? "s" : ""}</option>)}
          </select>
          {!selectedSiteId && (
            <div className="w-full">
              <RequirementChecklist items={[
                { label: "Website URL", met: !!url.trim() },
              ]} />
            </div>
          )}
          <button onClick={start}
            disabled={(!selectedSiteId && !url.trim()) || (job !== null && GENERATING.has(job.status))}
            className="rounded-full bg-gold-gradient px-5 py-2.5 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50 transition">
            {job && GENERATING.has(job.status) ? "Studying site…" : selectedSiteId ? "Get new ideas →" : "Get ad ideas"}
          </button>
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium text-foreground">Focus on a specific subject <span className="font-normal text-muted-foreground">(optional)</span></label>
          <textarea value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. our summer sale, the new iOS app, our loyalty programme…"
            rows={2} maxLength={500}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none transition resize-none" />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">{focus.length}/500</div>
        </div>

        {/* Save prompt — appears after a fresh scrape completes */}
        {showSavePrompt && job?.status === "ready" && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="text-xs font-semibold text-foreground mb-1">💾 Save this site for next time?</div>
            <p className="text-[11px] text-muted-foreground mb-2">Store the scraped content so you can generate new ideas from it without re-crawling.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                placeholder={`Label (e.g. "Main site") — optional`}
                className="flex-1 min-w-[160px] rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
              />
              <button onClick={saveSite} disabled={saving}
                className="rounded-full bg-gold-gradient px-4 py-1.5 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setShowSavePrompt(false)}
                className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                Not now
              </button>
            </div>
          </div>
        )}

        {job?.status === "failed" && <div className="mt-2 text-xs text-destructive">Couldn't do that: {job.error}</div>}
      </div>

      {err && <div className="text-xs text-destructive">{err}</div>}

      {/* Recommendations */}
      <div>
        <div className="text-sm font-semibold text-foreground mb-3">Ideas to review ({pending.length})</div>
        {recs === null ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.07] bg-white/[0.02] px-6 py-10 text-center text-xs text-muted-foreground">
            No pending ideas — run Quick Start above to get some.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((r) => (
              <div key={r.id} className="rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)] backdrop-blur-sm transition hover:border-white/12">
                <div className="text-sm font-semibold text-foreground">{r.title}</div>
                <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{r.description}</div>
                {r.audience && (
                  <div className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground/70">Audience:</span> {r.audience}</div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {r.platforms.map((p) => {
                    const meta = PLATFORMS.find((pl) => pl.id === p);
                    return <span key={p} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">{meta?.tag || p}</span>;
                  })}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground/50 truncate">from {r.source_url}</div>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => createFrom(r)} className="rounded-full bg-gold-gradient px-3.5 py-1.5 text-xs font-semibold text-background shadow-[var(--shadow-gold)]">
                    Create this ad →
                  </button>
                  <button onClick={() => dismiss(r.id)} disabled={busyId === r.id}
                    className="rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50 transition">
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

// ── Root Component ─────────────────────────────────────────────────────

function AgentNiva() {
  const [tab, setTab] = useState<"quick-start" | "events">("quick-start");
  return (
    <AppShell eyebrow="Library" title="Agent Niva">
      <p className="mb-6 text-xs text-muted-foreground max-w-2xl">
        Your AI marketing agent — studies your site for ad ideas, and keeps seasonal ads generating and scheduling themselves throughout the year.
      </p>
      <div className="flex gap-2 mb-6">
        {([ ["quick-start", "⚡ Quick Start", "page:quick-start"], ["events", "📅 Recurring Events", "page:recurring-events"] ] as const).map(([k, l, hk]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${tab === k ? "border-primary/50 bg-primary/10 text-primary shadow-[0_0_14px_-4px_oklch(0.78_0.12_85/0.3)]" : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"}`}>
            {l} <NovaHint hintKey={hk} />
          </button>
        ))}
      </div>
      {tab === "quick-start" ? <QuickStartTab /> : <EventsTab />}
    </AppShell>
  );
}
