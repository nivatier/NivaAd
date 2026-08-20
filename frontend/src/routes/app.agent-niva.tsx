import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { NovaHint } from "@/components/nova-hint";
import { RequirementChecklist } from "@/components/requirement-checklist";
import { PLATFORMS, type Platform } from "@/components/create-ad-parts";
import { useConnectedPlatforms } from "@/hooks/use-connected-platforms";
import { useAuth } from "@/hooks/use-auth";
import { api, type ProductOut } from "@/lib/api";

export const Route = createFileRoute("/app/agent-niva")({
  component: AgentNiva,
  head: () => ({ meta: [{ title: "Agent Niva — NivaSpark" }] }),
});

type ScrapeJob = { id: string; url: string; count: number; status: string; error: string | null; created_at: string };
type Recommendation = { id: string; source_url: string; status: string; title: string; description: string; audience: string; platforms: string[]; voice: string | null; reference_style: string | null; image_prompt: string | null; product_id: string | null; created_ad_id: string | null; created_at: string };
type AgentEvent = {
  id: string; name: string; month: number; day: number; lead_days: number; guidance: string; platforms: string[];
  product_id: string | null; enabled: boolean; approval_mode: string;
  post_hour: number; post_minute: number;
  wish_tone: string; visual_style: string; reference_image_url: string | null;
  skipped_years: number[]; last_run_year: number | null; next_run_date: string | null;
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

function PlatformChips({ selected, onToggle, platforms = PLATFORMS, connectedPlatformIds = new Set<string>(), testMode = false }: {
  selected: string[]; onToggle: (id: string) => void; platforms?: Platform[];
  connectedPlatformIds?: Set<string>; testMode?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {platforms.map((p) => {
        const isConnected = connectedPlatformIds.has(p.id);
        const isSelectable = testMode || isConnected;
        const isSelected = selected.includes(p.id);
        return (
          <button key={p.id} type="button"
            disabled={!isSelectable}
            onClick={() => isSelectable && onToggle(p.id)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-all
              ${isSelected ? "border-primary bg-primary/15 text-primary shadow-[0_0_10px_-3px_oklch(0.78_0.12_85/0.4)]" :
                isSelectable ? "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground" :
                "border-border/30 text-muted-foreground/30 opacity-40 cursor-not-allowed"}`}>
            <span className="h-3.5 w-3.5 rounded-full inline-flex items-center justify-center text-[8px] font-bold text-slate-950 shrink-0" style={{ background: isSelectable ? p.color : "#888" }}>{p.tag}</span>
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

// ── Time zone helpers ──────────────────────────────────────────────────
function utcToLocal(utcHour: number, utcMinute: number) {
  const d = new Date(); d.setUTCHours(utcHour, utcMinute, 0, 0);
  return { hour: d.getHours(), minute: d.getMinutes() };
}
function localToUtc(localHour: number, localMinute: number) {
  const d = new Date(); d.setHours(localHour, localMinute, 0, 0);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
function fmtLocalTime(utcHour: number, utcMinute: number) {
  const d = new Date(); d.setUTCHours(utcHour, utcMinute, 0, 0);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop()?.replace(/_/g, " ") ?? "";
  return tz ? `${t} (${tz})` : t;
}

// ── Event Templates ────────────────────────────────────────────────────
type EventTemplate = {
  name: string; month: number; day: number; wish_tone: string; visual_style: string;
  variable_date?: boolean; category: string; emoji: string;
};

const EVENT_TEMPLATES: EventTemplate[] = [
  // Seasonal & Holidays
  { name: "Christmas",        month: 12, day: 25, wish_tone: "warm",         visual_style: "festive",  category: "Seasonal & Holidays", emoji: "🎄" },
  { name: "New Year",         month: 1,  day: 1,  wish_tone: "fun",          visual_style: "bold",     category: "Seasonal & Holidays", emoji: "🎆" },
  { name: "Halloween",        month: 10, day: 31, wish_tone: "fun",          visual_style: "bold",     category: "Seasonal & Holidays", emoji: "🎃" },
  { name: "Thanksgiving",     month: 11, day: 28, wish_tone: "warm",         visual_style: "festive",  category: "Seasonal & Holidays", emoji: "🦃" },
  { name: "Valentine's Day",  month: 2,  day: 14, wish_tone: "warm",         visual_style: "elegant",  category: "Seasonal & Holidays", emoji: "💝" },
  { name: "Easter",           month: 4,  day: 20, wish_tone: "warm",         visual_style: "minimal",  category: "Seasonal & Holidays", emoji: "🐣", variable_date: true },
  { name: "Mother's Day",     month: 5,  day: 11, wish_tone: "warm",         visual_style: "elegant",  category: "Seasonal & Holidays", emoji: "💐", variable_date: true },
  // Islamic Occasions
  { name: "Eid al-Fitr",      month: 3,  day: 30, wish_tone: "warm",         visual_style: "elegant",  category: "Islamic Occasions",   emoji: "🌙", variable_date: true },
  { name: "Eid al-Adha",      month: 6,  day: 7,  wish_tone: "warm",         visual_style: "festive",  category: "Islamic Occasions",   emoji: "🕌", variable_date: true },
  { name: "Ramadan",          month: 3,  day: 1,  wish_tone: "professional", visual_style: "elegant",  category: "Islamic Occasions",   emoji: "☪️", variable_date: true },
  // Regional
  { name: "UAE National Day", month: 12, day: 2,  wish_tone: "professional", visual_style: "bold",     category: "Regional",            emoji: "🇦🇪" },
  { name: "Diwali",           month: 10, day: 20, wish_tone: "warm",         visual_style: "festive",  category: "Regional",            emoji: "🪔", variable_date: true },
  { name: "Chinese New Year", month: 1,  day: 29, wish_tone: "warm",         visual_style: "bold",     category: "Regional",            emoji: "🧧", variable_date: true },
  { name: "Holi",             month: 3,  day: 14, wish_tone: "fun",          visual_style: "bold",     category: "Regional",            emoji: "🎨", variable_date: true },
  // Business
  { name: "End of Year",      month: 12, day: 31, wish_tone: "professional", visual_style: "minimal",  category: "Business",            emoji: "📅" },
  { name: "Back to Season",   month: 9,  day: 1,  wish_tone: "professional", visual_style: "bold",     category: "Business",            emoji: "🚀" },
];

const TEMPLATE_CATEGORIES = [...new Set(EVENT_TEMPLATES.map(t => t.category))];

function EventTemplatesPanel({ onPick }: { onPick: (t: EventTemplate) => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3 px-1">Event templates</div>
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {TEMPLATE_CATEGORIES.map(cat => (
          <div key={cat}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 px-1">{cat}</div>
            <div className="space-y-1">
              {EVENT_TEMPLATES.filter(t => t.category === cat).map(t => (
                <button key={t.name} type="button" onClick={() => onPick(t)}
                  className="w-full text-left rounded-xl border border-white/8 bg-white/3 px-3 py-2 hover:border-primary/40 hover:bg-primary/8 transition-all group">
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{t.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">{t.name}</div>
                      <div className="text-[10px] text-muted-foreground">{MONTHS[t.month - 1]} {t.day}{t.variable_date ? " ·" : ""}{t.variable_date ? " ⚠ date varies" : ""}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Event Modal ────────────────────────────────────────────────────────

const WISH_TONES = [
  { value: "warm",         label: "Warm & Friendly",   desc: "Genuine, heartfelt, human" },
  { value: "professional", label: "Professional",       desc: "Polished, sincere, brand-forward" },
  { value: "fun",          label: "Fun & Playful",      desc: "Upbeat, light, energetic" },
  { value: "luxury",       label: "Luxurious",          desc: "Sophisticated, elegant, exclusive" },
];

const VISUAL_STYLES = [
  { value: "festive",  label: "Festive",        desc: "Warm glow, bokeh, seasonal colours" },
  { value: "minimal",  label: "Minimal & Clean", desc: "Neutral palette, lots of negative space" },
  { value: "bold",     label: "Bold & Vibrant",  desc: "High contrast, dynamic, energetic" },
  { value: "elegant",  label: "Elegant",         desc: "Muted tones, graceful, refined" },
];

function EventModal({ editing, products, defaultApproval, brandLogoUrl, onSave, onClose }: {
  editing: AgentEvent | null;
  products: ProductOut[];
  defaultApproval: string;
  brandLogoUrl: string | null;
  onSave: (ev: AgentEvent) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(editing?.name ?? "");
  const [month, setMonth] = useState(editing?.month ?? (TODAY.getMonth() + 1));
  const [day, setDay] = useState(editing?.day ?? 1);
  const [leadDays, setLeadDays] = useState(editing?.lead_days ?? 7);
  const initLocal = editing ? utcToLocal(editing.post_hour, editing.post_minute) : utcToLocal(10, 0);
  const [postHour, setPostHour] = useState(initLocal.hour);
  const [postMinute, setPostMinute] = useState(initLocal.minute);
  const [wishTone, setWishTone] = useState(editing?.wish_tone ?? "warm");
  const [visualStyle, setVisualStyle] = useState(editing?.visual_style ?? "festive");
  const [guidance, setGuidance] = useState(editing?.guidance ?? "");
  // Default to connected platforms when creating a new event — not a hardcoded list.
  // connectedPlatformIds is populated after the hook resolves, so we sync once it loads.
  const [platforms, setPlatforms] = useState<string[]>(editing?.platforms ?? []);
  const [productId, setProductId] = useState(editing?.product_id ?? "");
  const [approvalMode, setApprovalMode] = useState(editing?.approval_mode ?? defaultApproval);
  // Reference image — either from product auto-pick, existing stored URL, or fresh upload
  const [refImageUrl, setRefImageUrl] = useState<string | null>(editing?.reference_image_url ?? null);
  const [refImagePreview, setRefImagePreview] = useState<string | null>(editing?.reference_image_url ?? null);
  const [refImageBase64, setRefImageBase64] = useState<string | null>(null); // fresh upload, sent as base64
  const refInputRef = useRef<HTMLInputElement>(null);

  const { platforms: availablePlatforms, connected: connectedPlatformIds, testMode } = useConnectedPlatforms();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // When creating a new event: once connected platforms load, default-select them.
  // Skip if editing (already has stored platforms) or user already toggled something.
  const platformsInitialisedRef = useRef(false);
  useEffect(() => {
    if (editing || platformsInitialisedRef.current || connectedPlatformIds.size === 0) return;
    setPlatforms(Array.from(connectedPlatformIds));
    platformsInitialisedRef.current = true;
  }, [connectedPlatformIds, editing]);

  // When product changes, auto-pick its image as reference if no custom upload
  const linkedProduct = products.find(p => p.id === productId);
  useEffect(() => {
    if (!refImageBase64 && linkedProduct?.image_url) {
      setRefImageUrl(linkedProduct.image_url);
      setRefImagePreview(linkedProduct.image_url);
    } else if (!refImageBase64 && !linkedProduct) {
      // Only clear if it was auto-set (not a custom upload)
      if (refImageUrl === editing?.reference_image_url || refImageUrl === linkedProduct?.image_url) {
        setRefImageUrl(null);
        setRefImagePreview(null);
      }
    }
  }, [productId]);

  async function handleRefImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setRefImageBase64(dataUrl);
      setRefImagePreview(dataUrl);
      setRefImageUrl(null); // will be uploaded on save
    };
    reader.readAsDataURL(file);
  }

  function clearRefImage() {
    setRefImageBase64(null);
    setRefImagePreview(null);
    setRefImageUrl(null);
    if (refInputRef.current) refInputRef.current.value = "";
  }

  function applyTemplate(t: EventTemplate) {
    setName(t.name);
    setMonth(t.month);
    setDay(t.day);
    setWishTone(t.wish_tone);
    setVisualStyle(t.visual_style);
  }

  function togglePlatform(id: string) {
    setPlatforms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  async function save() {
    if (!name.trim() || platforms.length === 0) return;
    setSaving(true); setErr("");
    try {
      const utc = localToUtc(postHour, postMinute);
      const body: Record<string, any> = {
        name: name.trim(), month, day, lead_days: leadDays, guidance,
        platforms, product_id: productId || null,
        enabled: editing?.enabled ?? true, approval_mode: approvalMode,
        post_hour: utc.hour, post_minute: utc.minute,
        wish_tone: wishTone, visual_style: visualStyle,
        reference_image_url: refImageBase64 ? null : refImageUrl,
        reference_image: refImageBase64 ?? undefined,
      };
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
      name, description: guidance || `${name} greeting`,
      scheduled_date: eventDate.toISOString().split("T")[0], platforms,
    }));
    onClose();
    navigate({ to: "/app" });
  }

  const utcForDisplay = localToUtc(postHour, postMinute);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />
      {/* Wide modal: form left + templates right */}
      <div className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="border-b border-white/[0.07] px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-primary/70">Recurring Event</div>
            <div className="mt-0.5 text-base font-bold text-foreground">{editing ? "Edit event" : "New recurring event"}</div>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-muted-foreground hover:text-foreground transition">✕</button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0">

          {/* ── Left: form ── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 border-r border-white/[0.07]">

            {/* No-logo warning */}
            {!brandLogoUrl && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/8 px-4 py-3 flex items-start gap-2.5">
                <span className="text-amber-400 text-base leading-none mt-0.5 shrink-0">⚠</span>
                <div>
                  <div className="text-xs font-semibold text-amber-300">No logo set</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Add your logo in <button onClick={() => { onClose(); navigate({ to: "/app/brand-kit" }); }} className="text-primary underline-offset-2 hover:underline">Brand Kit</button> — it will be composited onto your greeting image automatically.</div>
                </div>
              </div>
            )}

            {/* Event name */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Event name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Christmas, Eid al-Fitr, UAE National Day"
                className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition" />
            </div>

            {/* Date + Lead days */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Month</label>
                <select value={month} onChange={e => setMonth(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
                  {MONTHS_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Day</label>
                <input type="number" min={1} max={31} value={day} onChange={e => setDay(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Lead days</label>
                <input type="number" min={0} max={60} value={leadDays} onChange={e => setLeadDays(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">Ad generates {leadDays} day{leadDays !== 1 ? "s" : ""} before {MONTHS[month - 1]} {day}.</p>

            {/* Posting time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Posting hour (local)</label>
                <select value={postHour} onChange={e => setPostHour(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Posting minute</label>
                <select value={postMinute} onChange={e => setPostMinute(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
                  {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Posts at {fmtLocalTime(utcForDisplay.hour, utcForDisplay.minute)} · {String(utcForDisplay.hour).padStart(2,"0")}:{String(utcForDisplay.minute).padStart(2,"0")} UTC
            </p>

            {/* Wish tone */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Greeting tone</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {WISH_TONES.map(t => (
                  <button key={t.value} type="button" onClick={() => setWishTone(t.value)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${wishTone === t.value ? "border-primary/50 bg-primary/10" : "border-white/8 bg-white/3 hover:border-white/15"}`}>
                    <div className={`text-xs font-semibold ${wishTone === t.value ? "text-primary" : "text-foreground"}`}>{t.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Visual style */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Image style</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {VISUAL_STYLES.map(s => (
                  <button key={s.value} type="button" onClick={() => setVisualStyle(s.value)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${visualStyle === s.value ? "border-primary/50 bg-primary/10" : "border-white/8 bg-white/3 hover:border-white/15"}`}>
                    <div className={`text-xs font-semibold ${visualStyle === s.value ? "text-primary" : "text-foreground"}`}>{s.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Reference image */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Reference image <span className="normal-case font-normal">(optional)</span></label>
              <p className="text-[10px] text-muted-foreground mt-0.5 mb-2">Your product or scene shown alongside the logo. Auto-set from linked product, or upload your own.</p>
              {refImagePreview ? (
                <div className="flex items-center gap-3">
                  <img src={refImagePreview} alt="Reference" className="h-16 w-16 rounded-xl object-cover border border-border shrink-0" />
                  <div className="flex flex-col gap-1.5">
                    <button type="button" onClick={() => refInputRef.current?.click()}
                      className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition">
                      Replace image
                    </button>
                    <button type="button" onClick={clearRefImage}
                      className="rounded-full border border-destructive/30 px-3 py-1.5 text-[11px] text-destructive hover:bg-destructive/10 transition">
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => refInputRef.current?.click()}
                  className="w-full rounded-xl border border-dashed border-border bg-input/40 py-4 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition">
                  📷 Click to upload a photo
                </button>
              )}
              <input ref={refInputRef} type="file" accept="image/*" className="hidden" onChange={handleRefImageUpload} />
            </div>

            {/* Additional context */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Additional context <span className="normal-case font-normal">(optional)</span></label>
              <textarea value={guidance} onChange={e => setGuidance(e.target.value)} rows={2}
                placeholder="e.g. Mention our charity drive, include discount code XMAS20, reference our 10th anniversary…"
                className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none transition resize-none" />
            </div>

            {/* Approval mode */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">After the greeting generates</label>
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

            {/* Product link */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Link a product <span className="normal-case font-normal">(optional — auto-sets reference image)</span></label>
              <select value={productId} onChange={e => setProductId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
                <option value="">None</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Platforms */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Platforms</label>
              <div className="mt-2"><PlatformChips selected={platforms} onToggle={togglePlatform} platforms={availablePlatforms} connectedPlatformIds={connectedPlatformIds} testMode={testMode} /></div>
            </div>

            {err && <div className="text-xs text-destructive">{err}</div>}
          </div>

          {/* ── Right: templates ── */}
          <div className="w-64 shrink-0 overflow-y-auto px-4 py-5">
            <EventTemplatesPanel onPick={applyTemplate} />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.07] px-6 py-4 flex items-center justify-between gap-3 shrink-0">
          <button onClick={generateNow} className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-white/20 transition">
            Generate greeting now →
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
            <div className="flex flex-col items-end gap-1">
              <div className="text-[10px] text-muted-foreground/60 text-right mb-1">
                💳 Ad generation deducts credits as per the selected output types
              </div>
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

          {/* Tone + Style badges */}
          <div className="flex flex-wrap gap-2">
            {ev.wish_tone && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary capitalize">
                🎨 {ev.wish_tone} tone
              </span>
            )}
            {ev.visual_style && (
              <span className="rounded-full border border-border bg-input/60 px-2.5 py-1 text-[10px] font-medium text-muted-foreground capitalize">
                🖼 {ev.visual_style} style
              </span>
            )}
          </div>

          {ev.reference_image_url && (
            <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Reference image</div>
              <img src={ev.reference_image_url} alt="Reference" className="h-20 w-20 rounded-lg object-cover border border-border" />
            </div>
          )}

          {ev.guidance && (
            <div className="rounded-xl border border-white/8 bg-white/4 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Additional context</div>
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
              return <span key={p} className="rounded-full border border-border bg-input/60 px-2.5 py-1 text-[10px] text-muted-foreground">{meta?.tag || p}</span>;
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

function MonthGrid({ events, products, defaultApproval, brandLogoUrl, onEventSaved, onEventDeleted }: {
  events: AgentEvent[]; products: ProductOut[]; defaultApproval: string; brandLogoUrl: string | null;
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
              className={`relative rounded-2xl border p-3 transition-all ${
                isCurrentMonth
                  ? "border-primary/40 bg-primary/[0.06] shadow-[0_0_0_1px_oklch(0.78_0.12_85/0.15),0_8px_32px_-8px_oklch(0.78_0.12_85/0.12)]"
                  : "border-border bg-card shadow-[var(--shadow-glass)]"
              }`}>
              {/* Month header */}
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-[11px] font-semibold uppercase tracking-widest ${isCurrentMonth ? "text-primary" : "text-muted-foreground"}`}>{monthName}</span>
                {monthEvents.length > 0 && (
                  <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{monthEvents.length}</span>
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
                className="mt-2 w-full rounded-lg border border-dashed border-border py-1 text-[10px] text-muted-foreground/50 hover:border-primary/40 hover:text-primary/70 transition-all">
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
          brandLogoUrl={brandLogoUrl}
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
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
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
    api("/brand-kit").then((kit: any) => setBrandLogoUrl(kit?.logo_url ?? null)).catch(() => {});
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
            Define recurring occasions for Agent Niva to post branded greetings — Christmas, Eid, National Days and more. Every year, your logo is composited onto a themed image with a warm message, posted to the platforms you choose.
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
          brandLogoUrl={brandLogoUrl}
          onEventSaved={handleEventSaved}
          onEventDeleted={handleEventDeleted}
        />
      )}

      {showModal && (
        <EventModal
          editing={null}
          products={products}
          defaultApproval={defaultApproval}
          brandLogoUrl={brandLogoUrl}
          onSave={(ev) => { handleEventSaved(ev); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Website Spark Tab ──────────────────────────────────────────────────

type SavedSite = { id: string; url: string; label: string; scraped_at: string };

const VOICE_OPTIONS = [
  { value: "we",      label: "We",      desc: "Company voice" },
  { value: "i",       label: "I",       desc: "Founder voice" },
  { value: "neutral", label: "Neutral", desc: "Briefing style" },
  { value: "you",     label: "You",     desc: "Customer-facing" },
];

const REF_OPTIONS = [
  { value: "none",  label: "None" },
  { value: "start", label: "Courtesy at start" },
  { value: "end",   label: "Courtesy at end" },
];

// ── Per-card chip selectors ─────────────────────────────────────────
function VoiceRefChips({ voice, refStyle, onVoice, onRef, regenBusy, onRegen }: {
  voice: string; refStyle: string;
  onVoice: (v: string) => void; onRef: (v: string) => void;
  regenBusy: boolean; onRegen: () => void;
}) {
  return (
    <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
      {/* Voice row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-14 shrink-0">Voice</span>
        {VOICE_OPTIONS.map((o) => (
          <button key={o.value} type="button" onClick={() => onVoice(o.value)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
              voice === o.value
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
            title={o.desc}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* Reference row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-14 shrink-0">Source</span>
        {REF_OPTIONS.map((o) => (
          <button key={o.value} type="button" onClick={() => onRef(o.value)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
              refStyle === o.value
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
        <button type="button" onClick={onRegen} disabled={regenBusy}
          className="ml-auto rounded-full border border-border/50 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-40 transition-all"
          title="Rewrite description with current voice & source settings"
        >
          {regenBusy ? "Rewriting…" : "↻ Rewrite · 0.25 cr"}
        </button>
      </div>
    </div>
  );
}

// ── Recommendation card ─────────────────────────────────────────────
function RecCard({ r, products, onUpdate, onSave, onDismiss, onCreateFrom }: {
  r: Recommendation;
  products: import("@/lib/api").ProductOut[];
  onUpdate: (updated: Recommendation) => void;
  onSave: (id: string) => void;
  onDismiss: (id: string) => void;
  onCreateFrom: (r: Recommendation) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(r.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descVal, setDescVal] = useState(r.description);
  const [voice, setVoice] = useState(r.voice || "neutral");
  const [refStyle, setRefStyle] = useState(r.reference_style || "none");
  const [imagePromptVal, setImagePromptVal] = useState(r.image_prompt || "");
  const [imagePromptBusy, setImagePromptBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [dismissBusy, setDismissBusy] = useState(false);

  async function patch(fields: Partial<Recommendation>) {
    try {
      const updated = await api(`/agent/recommendations/${r.id}`, { method: "PATCH", body: fields });
      onUpdate(updated);
    } catch { /* non-fatal inline edit */ }
  }

  async function saveTitle() {
    setEditingTitle(false);
    if (titleVal !== r.title) await patch({ title: titleVal } as any);
  }

  async function saveDesc() {
    setEditingDesc(false);
    if (descVal !== r.description) await patch({ description: descVal } as any);
  }

  async function setProduct(productId: string) {
    await patch({ product_id: productId || null } as any);
    onUpdate({ ...r, product_id: productId || null });
  }

  async function handleVoice(v: string) {
    setVoice(v);
    await patch({ voice: v } as any);
  }

  async function handleRef(v: string) {
    setRefStyle(v);
    await patch({ reference_style: v } as any);
  }

  async function regen() {
    setRegenBusy(true);
    try {
      const updated = await api(`/agent/recommendations/${r.id}/regenerate`, {
        method: "POST", body: { voice, reference_style: refStyle },
      });
      onUpdate(updated);
      setDescVal(updated.description);
    } catch { /* ignore */ }
    setRegenBusy(false);
  }

  async function save() {
    setSaveBusy(true);
    try {
      await api(`/agent/recommendations/${r.id}/save`, { method: "POST" });
      onSave(r.id);
    } catch { /* ignore */ }
    setSaveBusy(false);
  }

  async function dismiss() {
    setDismissBusy(true);
    try { onDismiss(r.id); await api(`/agent/recommendations/${r.id}/dismiss`, { method: "POST" }); }
    catch { /* ignore */ }
    setDismissBusy(false);
  }

  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-card shadow-[var(--shadow-glass)] overflow-hidden transition hover:border-primary/40 hover:shadow-[var(--shadow-glass-hover)]">
      <div className="h-1 w-full bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />
      <div className="flex flex-col flex-1 p-4">

        {/* Editable title */}
        {editingTitle ? (
          <input autoFocus value={titleVal} onChange={(e) => setTitleVal(e.target.value)}
            onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && saveTitle()}
            className="text-sm font-bold text-foreground bg-input/60 border border-primary/40 rounded-lg px-2 py-1 focus:outline-none w-full mb-1" />
        ) : (
          <div className="text-sm font-bold text-foreground leading-snug cursor-pointer hover:text-primary transition-colors"
            onClick={() => setEditingTitle(true)} title="Click to edit">
            {r.title} <span className="text-[10px] text-muted-foreground/40 font-normal">✏</span>
          </div>
        )}

        {/* Editable description */}
        {editingDesc ? (
          <textarea autoFocus value={descVal} onChange={(e) => setDescVal(e.target.value)}
            onBlur={saveDesc} rows={4}
            className="mt-2 text-xs text-muted-foreground bg-input/60 border border-primary/40 rounded-lg px-2 py-1.5 focus:outline-none w-full resize-none leading-relaxed" />
        ) : (
          <div className="mt-2 text-xs text-muted-foreground leading-relaxed flex-1 cursor-pointer hover:text-foreground/80 transition-colors"
            onClick={() => setEditingDesc(true)} title="Click to edit">
            {r.description} <span className="text-[10px] text-muted-foreground/40">✏</span>
          </div>
        )}

        {/* Audience */}
        {r.audience && (
          <div className="mt-3 flex items-start gap-1.5">
            <span className="mt-px shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Audience</span>
            <span className="text-xs text-foreground/80 leading-snug">{r.audience}</span>
          </div>
        )}



        {/* Product selector */}
        {products.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Product</div>
            <select value={r.product_id || ""} onChange={(e) => setProduct(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/60 px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none transition">
              <option value="">— Use idea title as product —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {/* Source URL */}
        {r.source_url && (
          <div className="mt-2 text-[10px] text-muted-foreground/50 truncate">
            🔗 <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors underline underline-offset-2">{r.source_url}</a>
          </div>
        )}

        {/* Voice + reference chips + regenerate */}
        <VoiceRefChips voice={voice} refStyle={refStyle} onVoice={handleVoice} onRef={handleRef} regenBusy={regenBusy} onRegen={regen} />

        {/* Image prompt */}
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              🖼 Image prompt
            </label>
            <button
              type="button"
              disabled={imagePromptBusy}
              onClick={async () => {
                setImagePromptBusy(true);
                try {
                  const updated = await api(`/agent/recommendations/${r.id}/image-prompt`, { method: "POST" });
                  setImagePromptVal(updated.image_prompt || "");
                  onUpdate(updated);
                } catch { /* ignore */ }
                setImagePromptBusy(false);
              }}
              className="text-[10px] text-primary hover:underline disabled:opacity-40 transition-all"
            >
              {imagePromptBusy ? "Generating…" : imagePromptVal ? "↻ Regenerate · 0.25 cr" : "✦ Generate · 0.25 cr"}
            </button>
          </div>
          <textarea
            value={imagePromptVal}
            onChange={e => setImagePromptVal(e.target.value)}
            rows={2}
            placeholder={imagePromptBusy ? "Generating image prompt…" : "Click Generate above to create an AI image prompt for this idea"}
            className="w-full rounded-lg border border-border/40 bg-input/30 px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button onClick={() => onCreateFrom({ ...r, image_prompt: imagePromptVal || r.image_prompt })}
            className="flex-1 rounded-full bg-gold-gradient px-3.5 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] hover:opacity-90 transition">
            Create this ad →
          </button>
          <button onClick={save} disabled={saveBusy}
            className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50 transition"
            title="Save for later">
            {saveBusy ? "…" : "🔖"}
          </button>
          <button onClick={dismiss} disabled={dismissBusy}
            className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50 transition">
            {dismissBusy ? "…" : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WebsiteSparkTab() {
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(5);
  const [focus, setFocus] = useState("");
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [saved, setSaved] = useState<Recommendation[]>([]);
  const [err, setErr] = useState("");
  const [mobileView, setMobileView] = useState<"pending" | "saved">("pending");
  const navigate = useNavigate();
  const [products, setProducts] = useState<import("@/lib/api").ProductOut[]>([]);
  // Saved sites
  const [savedSites, setSavedSites] = useState<SavedSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadRecs() {
    try { setRecs(await api("/agent/recommendations")); } catch (e: any) { setErr(e.message || "Could not load recommendations"); }
  }
  async function loadSaved() {
    try { setSaved(await api("/agent/recommendations/saved")); } catch { /* non-fatal */ }
  }
  async function loadSavedSites() {
    try { setSavedSites(await api("/agent/scraped-sites")); } catch { /* non-fatal */ }
  }
  async function loadProducts() {
    try { setProducts(await api("/products")); } catch { /* non-fatal */ }
  }

  useEffect(() => { loadRecs(); loadSaved(); loadSavedSites(); loadProducts(); }, []);

  useEffect(() => {
    if (!job || !GENERATING.has(job.status)) return;
    const t = setInterval(async () => {
      try {
        const j = await api(`/agent/quick-start/${job.id}`);
        setJob(j);
        if (j.status === "ready") {
          loadRecs();
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
      setSavedSites((prev) => { const without = prev.filter((s) => s.id !== site.id); return [site, ...without]; });
      setShowSavePrompt(false); setSaveLabel("");
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

  function createFrom(rec: Recommendation) {
    const product = products.find((p) => p.id === rec.product_id);
    // Translate voice + reference_style into plain-English copy directions
    // so the Create Ad page can display and use them without knowing Agent Niva internals.
    const voiceMap: Record<string, string> = {
      we:      "Write using 'We' and 'Our' to refer to the company.",
      i:       "Write in first-person using 'I' and 'My' — founder voice.",
      neutral: "",
      you:     "Address the reader directly using 'You' and 'Your'.",
    };
    const dirParts: string[] = [];
    const voice = rec.voice || "neutral";
    const refStyle = rec.reference_style || "none";
    if (voice !== "neutral") dirParts.push(voiceMap[voice] || "");
    if (refStyle !== "none" && rec.source_url) {
      const domain = rec.source_url.replace(/https?:\/\/(www\.)?/, "").split("/")[0];
      const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
      if (refStyle === "start") dirParts.push(`Begin the copy with "Courtesy ${domainLabel} —".`);
      if (refStyle === "end")   dirParts.push(`End the copy with "— Courtesy ${domainLabel}".`);
    }
    sessionStorage.setItem("nivaad_prefill_product", JSON.stringify({
      name: product?.name || rec.title,
      description: product?.description || rec.description,
      audience: product?.audience || rec.audience,
      voice,
      reference_style: refStyle,
      source_url: rec.source_url,
      copy_directions: dirParts.filter(Boolean).join(" ") || null,
      image_scene: rec.image_prompt || null,  // AI-generated image prompt from quick start
    }));
    navigate({ to: "/app" });
  }

  function handleUpdate(updated: Recommendation) {
    setRecs((prev) => prev ? prev.map((r) => r.id === updated.id ? updated : r) : prev);
  }

  function handleSave(id: string) {
    const rec = recs?.find((r) => r.id === id);
    if (rec) {
      setRecs((prev) => prev ? prev.filter((r) => r.id !== id) : prev);
      setSaved((prev) => [{ ...rec, status: "saved" }, ...prev]);
    }
  }

  function handleDismiss(id: string) {
    setRecs((prev) => prev ? prev.filter((r) => r.id !== id) : prev);
  }

  async function unsave(id: string) {
    try {
      await api(`/agent/recommendations/${id}/unsave`, { method: "POST" });
      const rec = saved.find((r) => r.id === id);
      if (rec) {
        setSaved((prev) => prev.filter((r) => r.id !== id));
        setRecs((prev) => prev ? [{ ...rec, status: "pending" }, ...prev] : [{ ...rec, status: "pending" }]);
      }
    } catch { /* ignore */ }
  }

  async function dismissSaved(id: string) {
    try {
      await api(`/agent/recommendations/${id}/dismiss`, { method: "POST" });
      setSaved((prev) => prev.filter((r) => r.id !== id));
    } catch { /* ignore */ }
  }

  const pending = (recs || []).filter((r) => r.status === "pending");

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left: main content ── */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Input card */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-glass)]">
          <div className="text-sm font-semibold text-foreground mb-1">Study a website, get ad ideas <NovaHint hintKey="page:quick-start" /></div>
          <p className="text-xs text-muted-foreground mb-4">Give Agent Niva your URL — it reads the site and recommends concrete ad ideas you can turn into real ads with one click.</p>

          {savedSites.length > 0 && (
            <div className="mb-3">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Use a saved site</label>
              <div className="flex items-center gap-2">
                <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}
                  className="flex-1 rounded-xl border border-border bg-input/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
                  <option value="">— Enter a new URL instead —</option>
                  {savedSites.map((s) => (
                    <option key={s.id} value={s.id}>{s.label || s.url} · {new Date(s.scraped_at).toLocaleDateString()}</option>
                  ))}
                </select>
                {selectedSiteId && (
                  <button onClick={() => deleteSavedSite(selectedSiteId)}
                    className="shrink-0 rounded-full border border-destructive/40 px-3 py-2 text-[11px] text-destructive hover:bg-destructive/10 transition">
                    🗑 Delete
                  </button>
                )}
              </div>
            </div>
          )}

          {!selectedSiteId && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourcompany.com"
                className="flex-1 min-w-[200px] rounded-xl border border-border bg-input/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition" />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
              {[1, 2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} idea{n > 1 ? "s" : ""}</option>)}
            </select>
            {!selectedSiteId && (
              <div className="w-full">
                <RequirementChecklist items={[{ label: "Website URL", met: !!url.trim() }]} />
              </div>
            )}
            <button onClick={start}
              disabled={(!selectedSiteId && !url.trim()) || (job !== null && GENERATING.has(job.status))}
              className="rounded-full bg-gold-gradient px-5 py-2.5 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50 transition">
              {job && GENERATING.has(job.status) ? "Studying site…" : selectedSiteId ? "Get new ideas · 0.25 cr →" : "Get ad ideas · 0.25 cr"}
            </button>
          </div>

          <div className="mt-3">
            <label className="text-xs font-medium text-foreground">Focus on a specific subject <span className="font-normal text-muted-foreground">(optional)</span></label>
            <textarea value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. our summer sale, the new iOS app, our loyalty programme…"
              rows={2} maxLength={500}
              className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none transition resize-none" />
            <div className="mt-1 text-right text-[10px] text-muted-foreground">{focus.length}/500</div>
          </div>

          {showSavePrompt && job?.status === "ready" && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs font-semibold text-foreground mb-1">💾 Save this site for next time?</div>
              <p className="text-[11px] text-muted-foreground mb-2">Store the scraped content so you can generate new ideas from it without re-crawling.</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)}
                  placeholder={`Label (e.g. "Main site") — optional`}
                  className="flex-1 min-w-[160px] rounded-lg border border-border bg-input/60 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none" />
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

        {/* Mobile tab switcher — hidden on xl where the right panel takes over */}
        <div className="flex xl:hidden rounded-xl border border-border bg-card/60 p-1 gap-1">
          {(["pending", "saved"] as const).map((v) => {
            const count = v === "pending" ? pending.length : saved.length;
            const label = v === "pending" ? "Ideas to review" : "Saved";
            return (
              <button key={v} onClick={() => setMobileView(v)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                  mobileView === v
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}>
                {label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    mobileView === v ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Pending ideas — shown on desktop always; on mobile only when mobileView=pending */}
        <div className={mobileView === "saved" ? "hidden xl:block" : ""}>
          <div className="hidden xl:flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-foreground">Ideas to review</div>
            {pending.length > 0 && (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold text-primary">{pending.length} pending</span>
            )}
          </div>
          {recs === null ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : pending.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/30 px-6 py-12 text-center">
              <div className="text-2xl mb-2">🌐</div>
              <div className="text-xs text-muted-foreground">No pending ideas — paste a URL above and run Website Spark to get some.</div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {pending.map((r) => (
                <RecCard key={r.id} r={r} products={products}
                  onUpdate={handleUpdate} onSave={handleSave}
                  onDismiss={handleDismiss} onCreateFrom={createFrom} />
              ))}
            </div>
          )}
        </div>

        {/* Saved ideas — mobile only (desktop uses the right panel) */}
        <div className={`xl:hidden ${mobileView === "pending" ? "hidden" : ""}`}>
          {saved.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/30 px-6 py-12 text-center">
              <div className="text-2xl mb-2">🔖</div>
              <div className="text-xs text-muted-foreground">No saved ideas yet. Click 🔖 on any idea card to save it here for later.</div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {saved.map((r) => (
                <div key={r.id} className="rounded-2xl border border-border bg-card shadow-[var(--shadow-glass)] overflow-hidden">
                  <div className="h-1 w-full bg-gradient-to-r from-amber-500/60 via-amber-400/30 to-transparent" />
                  <div className="p-4">
                    <div className="text-sm font-semibold text-foreground leading-snug">{r.title}</div>
                    <div className="mt-1.5 text-xs text-muted-foreground leading-relaxed line-clamp-3">{r.description}</div>
                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={() => createFrom(r)}
                        className="flex-1 rounded-full bg-gold-gradient px-3 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] hover:opacity-90 transition">
                        Create this ad →
                      </button>
                      <button onClick={() => unsave(r.id)}
                        className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition"
                        title="Move back to pending">↩</button>
                      <button onClick={() => dismissSaved(r.id)}
                        className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive transition"
                        title="Dismiss">✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Saved Ideas panel — always visible ── */}
      <div className="hidden xl:flex w-[280px] shrink-0 flex-col rounded-2xl border border-border bg-card overflow-hidden"
        style={{ position: "sticky", top: "144px", maxHeight: "calc(100vh - 164px)", boxShadow: "var(--shadow-glass-full)" }}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-xs font-semibold text-foreground">🔖 Saved Ideas</div>
          {saved.length > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{saved.length}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/50">
          {saved.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="text-2xl mb-2">🔖</div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                No saved ideas yet. Click <span className="font-semibold text-foreground">🔖</span> on any idea card to save it here for later.
              </div>
            </div>
          ) : (
            saved.map((r) => (
              <div key={r.id} className="px-4 py-3 hover:bg-muted/20 transition">
                <div className="text-xs font-semibold text-foreground leading-snug truncate">{r.title}</div>
                <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{r.description}</div>
                <div className="mt-2 flex items-center gap-1.5">
                  <button onClick={() => createFrom(r)}
                    className="flex-1 rounded-full bg-gold-gradient px-2.5 py-1 text-[10px] font-semibold text-background shadow-[var(--shadow-gold)] hover:opacity-90 transition">
                    Create →
                  </button>
                  <button onClick={() => unsave(r.id)}
                    className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary transition"
                    title="Move back to pending">
                    ↩
                  </button>
                  <button onClick={() => dismissSaved(r.id)}
                    className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-destructive/40 hover:text-destructive transition"
                    title="Dismiss">
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


// ── Quick Spark Tab ──────────────────────────────────────────────────────────
// User describes an idea → AI generates 4-5 ad draft recommendations
// (same card shape as Website Spark) → "Create this ad" pre-fills the wizard.

type SparkDraft = {
  id: string;
  title: string;
  description: string;
  audience: string;
  suggested_tone: string;
  goal: string;
};

function QuickSparkTab() {
  const [idea, setIdea] = useState("");
  const [count, setCount] = useState(4);
  const [drafts, setDrafts] = useState<SparkDraft[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  async function generate() {
    if (!idea.trim()) return;
    setGenerating(true); setErr(""); setDrafts(null);
    try {
      const systemPrompt = `You are an expert marketing strategist. Given a user's ad idea, generate ${count} distinct, creative ad draft concepts. Each should have a different angle, tone, or target audience slice to give the user real choice.

Return ONLY a JSON array — no markdown, no prose, no backticks — with exactly this shape:
[
  {
    "id": "1",
    "title": "Short punchy ad concept title (max 8 words)",
    "description": "What this ad communicates and why it works (2-3 sentences)",
    "audience": "Who this speaks to (1 sentence)",
    "suggested_tone": "Professional | Fun | Luxury | Minimal | Bold | Emotional",
    "goal": "Drive sales | Product launch | Brand awareness | Get signups"
  }
]
Make each concept meaningfully different. Be specific and actionable.`;

      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"}/agent/quick-spark`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionStorage.getItem("nivaad_tokens") ? JSON.parse(sessionStorage.getItem("nivaad_tokens")!).access_token : ""}`,
        },
        body: JSON.stringify({ idea: idea.trim(), count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "AI error");
      const parsed: SparkDraft[] = data.drafts;
      setDrafts(parsed);
    } catch (e: any) {
      setErr(e.message || "Could not generate drafts");
    }
    setGenerating(false);
  }

  function createFrom(draft: SparkDraft) {
    sessionStorage.setItem("nivaad_prefill_product", JSON.stringify({
      name: draft.title,
      description: draft.description,
      audience: draft.audience,
      goal: draft.goal,
      tone: draft.suggested_tone,
    }));
    navigate({ to: "/app" });
  }

  return (
    <div className="space-y-6">
      {/* Input card */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-glass)]">
        <div className="text-sm font-semibold text-foreground mb-1">Describe your idea, get instant ad drafts <NovaHint hintKey="page:quick-spark" /></div>
        <p className="text-xs text-muted-foreground mb-4">
          Tell Niva your ad concept in plain words — she'll turn it into {count} distinct draft angles you can launch with one click.
        </p>

        <div className="mb-3">
          <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Your idea</label>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. An ad for our new eco-friendly water bottle targeting gym-goers who care about sustainability…"
            rows={3}
            maxLength={600}
            className="w-full rounded-xl border border-border bg-input/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition resize-none"
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">{idea.length}/600</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}
            className="rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition">
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} drafts</option>)}
          </select>
          <div className="flex-1 min-w-[180px]">
            <RequirementChecklist items={[{ label: "Describe your idea", met: idea.trim().length > 10 }]} />
          </div>
          <button
            onClick={generate}
            disabled={idea.trim().length <= 10 || generating}
            className="rounded-full bg-gold-gradient px-5 py-2.5 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50 transition"
          >
            {generating ? "Generating drafts…" : "Spark drafts · 0.25 cr →"}
          </button>
        </div>

        {/* Generating state */}
        {generating && (
          <div className="mt-4 flex items-center gap-2 text-xs text-primary animate-pulse">
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Niva is crafting your ad angles…
          </div>
        )}
      </div>

      {err && <div className="text-xs text-destructive">{err}</div>}

      {/* Draft results */}
      {drafts !== null && (
        <div>
          <div className="text-sm font-semibold text-foreground mb-3">
            {drafts.length} draft{drafts.length !== 1 ? "s" : ""} ready — pick one to build your ad
          </div>
          {drafts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/30 px-6 py-12 text-center">
              <div className="text-2xl mb-2">💡</div>
              <div className="text-xs text-muted-foreground">No drafts generated. Try describing your idea in more detail.</div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {drafts.map((draft) => (
                <div key={draft.id} className="group flex flex-col rounded-2xl border border-border bg-card shadow-[var(--shadow-glass)] overflow-hidden transition hover:border-primary/40 hover:shadow-[var(--shadow-glass-hover)]">
                  {/* Accent bar — cyan tint to distinguish from Website Spark */}
                  <div className="h-1 w-full bg-gradient-to-r from-cyan-500/60 via-primary/30 to-transparent" />
                  <div className="flex flex-col flex-1 p-4">
                    <div className="text-sm font-bold text-foreground leading-snug">{draft.title}</div>
                    <div className="mt-2 text-xs text-muted-foreground leading-relaxed flex-1">{draft.description}</div>
                    {draft.audience && (
                      <div className="mt-3 flex items-start gap-1.5">
                        <span className="mt-px shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Audience</span>
                        <span className="text-xs text-foreground/80 leading-snug">{draft.audience}</span>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {draft.goal && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary">{draft.goal}</span>
                      )}
                      {draft.suggested_tone && (
                        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">{draft.suggested_tone}</span>
                      )}
                    </div>
                    <div className="mt-4">
                      <button
                        onClick={() => createFrom(draft)}
                        className="w-full rounded-full bg-gold-gradient px-3.5 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] hover:opacity-90 transition"
                      >
                        Create this ad →
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state — before first generation */}
      {drafts === null && !generating && (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 px-6 py-12 text-center">
          <div className="text-2xl mb-2">💡</div>
          <div className="text-xs text-muted-foreground">Describe your idea above and Niva will generate ready-to-use ad drafts for you.</div>
        </div>
      )}
    </div>
  );
}

// ── RSS Feeds Tab ───────────────────────────────────────────────────────

type RssFeed = { id: string; name: string; url: string; category: string; description: string; enabled: boolean };
type RssFeedSub = {
  id: string; company_id: string; rss_feed_id: string | null; custom_url: string | null;
  label: string; content_type: string; image_model_id: string | null; video_model_id: string | null;
  platforms: string[]; posting_mode: string; frequency: string;
  day_of_week: number | null; day_of_month: number | null; posts_per_run: number;
  article_selection: string; tone_style: string; enabled: boolean;
  last_run_at: string | null; next_run_at: string | null; created_at: string;
  feed_name: string | null; feed_category: string | null;
};
type RssDraft = {
  id: string; subscription_id: string; article_url: string; article_title: string;
  article_summary: string; ad_id: string | null; status: string;
  expires_at: string; created_at: string;
  subscription_label: string | null; feed_name: string | null;
};

const SELECTION_OPTIONS = [
  { value: "most_relevant",     label: "Most relevant to my business" },
  { value: "most_trending",     label: "Most trending / viral" },
  { value: "most_recent",       label: "Most recent" },
  { value: "most_educational",  label: "Most educational" },
  { value: "most_controversial",label: "Most controversial" },
  { value: "positive_only",     label: "Positive news only" },
];
const TONE_OPTIONS = [
  {
    value: "we",
    label: "We / Our",
    desc: "Company voice — \"We believe…\", \"Our team…\", \"We're excited to share…\"",
    voiceKey: "we",
    adTone: "Professional",
    direction: "Write using 'We' and 'Our' to refer to the company throughout the post.",
  },
  {
    value: "i",
    label: "I / My",
    desc: "Founder voice — \"I think…\", \"In my view…\", \"I've been following this…\"",
    voiceKey: "i",
    adTone: "Professional",
    direction: "Write in first-person using 'I' and 'My' — founder or personal brand voice.",
  },
  {
    value: "you",
    label: "You / Your",
    desc: "Customer-facing — \"You need to know…\", \"Your business can…\", \"Have you seen…\"",
    voiceKey: "you",
    adTone: "Fun",
    direction: "Address the reader directly using 'You' and 'Your' throughout the post.",
  },
  {
    value: "they",
    label: "They / The brand",
    desc: "Third-person — \"The study shows…\", \"Researchers found…\", \"The company announced…\"",
    voiceKey: "neutral",
    adTone: "Minimal",
    direction: "Write in third-person neutral voice — refer to companies, researchers, or subjects by name or as 'they'.",
  },
  {
    value: "lets",
    label: "Let's / Together",
    desc: "Inclusive voice — \"Let's explore…\", \"Together we can…\", \"Join us in…\"",
    voiceKey: "we",
    adTone: "Fun",
    direction: "Use an inclusive, collaborative voice — 'Let's', 'Together', 'Join us' — to bring the reader into the conversation.",
  },
];
const FREQ_OPTIONS = [
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];
const DAYS_OF_WEEK = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CONTENT_TYPE_OPTIONS = [
  { value: "text",       label: "Text only",    cost: "0.25 cr" },
  { value: "text_image", label: "Text + Image", cost: "0.25 + image model" },
];

type SubFormState = {
  rss_feed_id: string; custom_url: string; label: string;
  content_type: string; image_model_id: string; video_model_id: string;
  platforms: string[]; posting_mode: string; frequency: string;
  post_hour: number; day_of_week: number; day_of_month: number; posts_per_run: number;
  article_selection: string; tone_style: string; enabled: boolean;
};

function defaultForm(feed_id = ""): SubFormState {
  return {
    rss_feed_id: feed_id, custom_url: "", label: "", content_type: "text",
    image_model_id: "", video_model_id: "",
    platforms: ["facebook", "instagram"], posting_mode: "manual",
    frequency: "daily", post_hour: 9, day_of_week: 0, day_of_month: 1,
    posts_per_run: 1, article_selection: "most_recent", tone_style: "curator", enabled: true,
  };
}

function SubModal({
  initialForm, title, availableModels, connectedPlatformIds, availPlatforms,
  onSave, onClose,
}: {
  initialForm: SubFormState; title: string;
  availableModels: { image: any[]; video: any[] };
  connectedPlatformIds: Set<string>;
  availPlatforms: Platform[];
  onSave: (form: SubFormState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SubFormState>(initialForm);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function set(key: keyof SubFormState, val: any) {
    setForm(f => ({ ...f, [key]: val }));
  }
  function togglePlatform(id: string) {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(id) ? f.platforms.filter(p => p !== id) : [...f.platforms, id],
    }));
  }

  async function handleSave() {
    if (!form.platforms.length) { setErr("Select at least one platform."); return; }
    setSaving(true); setErr("");
    try { await onSave(form); }
    catch (e: any) { setErr(e.message || "Could not save"); setSaving(false); }
  }

  const sel = (label: string, key: keyof SubFormState, opts: { value: string; label: string }[]) => (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
      <select value={form[key] as string} onChange={e => set(key, e.target.value)}
        className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
        </div>

        {/* Label */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Label (optional)</label>
          <input value={form.label} onChange={e => set("label", e.target.value)} placeholder="My Tech Feed"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        </div>

        {/* Custom URL (only shown if no rss_feed_id) */}
        {!form.rss_feed_id && (
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">RSS Feed URL <span className="text-primary">(Pro)</span></label>
            <input value={form.custom_url} onChange={e => set("custom_url", e.target.value)} placeholder="https://feeds.example.com/rss"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
        )}

        {/* Content type */}
        {sel("Content type", "content_type", CONTENT_TYPE_OPTIONS)}

        {/* Image model (text_image) */}
        {form.content_type === "text_image" && availableModels.image.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Image model</label>
            <select value={form.image_model_id} onChange={e => set("image_model_id", e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
              {availableModels.image.filter((m: any) => m.enabled !== false).map((m: any) => (
                <option key={m.id} value={m.id}>{m.label} ({m.credits} cr)</option>
              ))}
            </select>
          </div>
        )}

        {/* Video model selector removed — text_video not supported for RSS feeds */}

        {/* Platforms */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1.5">Platforms</label>
          <PlatformChips selected={form.platforms} onToggle={togglePlatform} platforms={availPlatforms} connectedPlatformIds={connectedPlatformIds} />
        </div>

        {/* Posting mode */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Posting mode</label>
          <div className="flex gap-2">
            {[{ v: "manual", l: "Manual approval" }, { v: "auto_post", l: "Auto-post" }].map(({ v, l }) => (
              <button key={v} type="button" onClick={() => set("posting_mode", v)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-all ${form.posting_mode === v ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/40"}`}>
                {l}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {form.posting_mode === "manual" ? "Drafts expire after 24 h — you'll be notified to approve." : "Posts go live automatically on your connected platforms."}
          </p>
        </div>

        {/* Frequency */}
        <div className="grid grid-cols-2 gap-3">
          {sel("Frequency", "frequency", FREQ_OPTIONS)}
          {form.frequency === "weekly" && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Day of week</label>
              <select value={form.day_of_week} onChange={e => set("day_of_week", Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
                {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}
          {form.frequency === "monthly" && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Day of month</label>
              <input type="number" min={1} max={28} value={form.day_of_month} onChange={e => set("day_of_month", Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
            </div>
          )}
        </div>

        {/* Post time (UTC hour) */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">
            Post time <span className="text-muted-foreground font-normal">(UTC)</span>
          </label>
          <select value={form.post_hour} onChange={e => set("post_hour", Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
            {Array.from({ length: 24 }, (_, i) => {
              const label = i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`;
              return <option key={i} value={i}>{label} UTC</option>;
            })}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">The beat runs every hour — posts go out at the selected UTC hour.</p>
        </div>

        {/* Posts per run */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Posts per run</label>
          <div className="flex gap-2">
            {[1, 2, 3].map(n => (
              <button key={n} type="button" onClick={() => set("posts_per_run", n)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-all ${form.posts_per_run === n ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/40"}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Article selection + tone */}
        <div className="grid grid-cols-2 gap-3">
          {sel("Article selection", "article_selection", SELECTION_OPTIONS)}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Tone / style</label>
            <select value={form.tone_style} onChange={e => set("tone_style", e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
              {TONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {TONE_OPTIONS.find(o => o.value === form.tone_style)?.desc && (
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                {TONE_OPTIONS.find(o => o.value === form.tone_style)!.desc}
              </p>
            )}
          </div>
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-full bg-gold-gradient px-4 py-1.5 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const RSS_PAGE_SIZE = 8;

// ── Audience inference ─────────────────────────────────────────────────────
// Derives a target audience string from the article + tone without an API call.
// Used to pre-fill the "Target audience" field in Create Ad.

function deriveAudience(idea: RssIdea, toneStyle: string): string {
  const title = (idea.title || "").toLowerCase();
  const summary = (idea.summary || "").toLowerCase();
  const goal = (idea.goal || "").toLowerCase();
  const text = `${title} ${summary}`;

  // ── Topic signals → audience descriptor ──────────────────────────
  const topicMap: [RegExp, string][] = [
    [/\b(ai|artificial intelligence|machine learning|llm|gpt|chatbot|automation)\b/,   "tech-savvy professionals and business leaders interested in AI"],
    [/\b(startup|venture|funding|seed|series [a-c]|investor|vc|founder)\b/,             "startup founders, entrepreneurs and early-stage investors"],
    [/\b(cybersecurity|data breach|ransomware|hacker|zero.day|vulnerability)\b/,        "IT security professionals and business owners managing digital risk"],
    [/\b(marketing|seo|brand|content strategy|social media|advertising|campaign)\b/,    "marketing managers and brand strategists"],
    [/\b(finance|stock|investment|portfolio|interest rate|inflation|economy|banking)\b/, "finance professionals and investment-minded adults"],
    [/\b(health|medical|clinical|patient|treatment|drug|pharma|biotech|hospital)\b/,    "healthcare professionals and health-conscious consumers"],
    [/\b(legal|law|regulation|compliance|court|ruling|litigation|attorney)\b/,          "legal professionals, compliance officers and business executives"],
    [/\b(real estate|property|housing|mortgage|rent|commercial|cre|reit)\b/,            "property investors, real estate professionals and home buyers"],
    [/\b(manufacturing|supply chain|logistics|warehouse|production|factory|automation)\b/, "operations managers and manufacturing industry professionals"],
    [/\b(agriculture|farming|crop|livestock|agri|food production|harvest)\b/,           "agricultural professionals and agribusiness decision-makers"],
    [/\b(education|school|university|learning|edtech|student|teacher|curriculum)\b/,    "educators, parents and education technology adopters"],
    [/\b(retail|e-commerce|consumer|shopping|brand|product launch|dtc)\b/,              "retail professionals, brand managers and online shoppers"],
    [/\b(energy|solar|renewable|sustainability|climate|esg|green|carbon)\b/,            "sustainability-focused business leaders and clean energy professionals"],
    [/\b(hr|human resources|talent|recruitment|workforce|employee|hiring)\b/,           "HR managers, recruiters and people operations leaders"],
    [/\b(travel|hospitality|hotel|tourism|airline|destination)\b/,                      "travel industry professionals and frequent travellers"],
    [/\b(food|beverage|restaurant|dining|nutrition|ingredient|chef)\b/,                 "food and beverage industry professionals and culinary enthusiasts"],
    [/\b(science|research|study|discovery|innovation|breakthrough|lab)\b/,              "research professionals, academics and innovation-driven business leaders"],
    [/\b(government|policy|regulation|public sector|federal|legislation)\b/,            "policy professionals, government affairs teams and compliance officers"],
  ];

  let audienceBase = "business professionals and decision-makers"; // fallback
  for (const [pattern, audience] of topicMap) {
    if (pattern.test(text)) {
      audienceBase = audience;
      break;
    }
  }

  // ── Tone modifier — add seniority/context flavour ────────────────
  const toneModifier: Record<string, string> = {
    thought_leader:  ", particularly senior leaders and C-suite executives",
    promoter:        " looking to stay ahead of industry trends",
    curator:         " who value curated, high-quality content",
    educator:        " eager to deepen their knowledge and skills",
    conversational:  " interested in fresh perspectives and open discussion",
  };

  return audienceBase + (toneModifier[toneStyle] ?? "");
}

// ── Image scene inference ─────────────────────────────────────────────────
// Generates a default image scene description from the article content.
// Pre-fills the "Image description" textarea in Create Ad.

function deriveImageScene(idea: RssIdea): string {
  const title = (idea.title || "").toLowerCase();
  const summary = (idea.summary || "").toLowerCase();
  const text = `${title} ${summary}`;

  // Topic → visual scene
  const sceneMap: [RegExp, string][] = [
    [/\b(ai|artificial intelligence|machine learning|robot|automation|algorithm)\b/, "Futuristic digital interface with glowing neural network visualisation, dark tech background"],
    [/\b(startup|founder|venture|funding|pitch|investor)\b/,                         "Modern open-plan office with entrepreneurs collaborating at a standing desk"],
    [/\b(cybersecurity|hacker|data breach|ransomware|firewall|encryption)\b/,        "Abstract digital lock and shield over a dark background with glowing circuit lines"],
    [/\b(health|medical|doctor|hospital|patient|clinical|wellness)\b/,               "Clean medical environment with soft lighting, healthcare professional in the background"],
    [/\b(pharma|drug|biotech|molecule|lab|research|genomics)\b/,                     "Modern laboratory setting with scientific equipment and soft blue lighting"],
    [/\b(legal|law|court|attorney|compliance|regulation|ruling)\b/,                  "Professional law office with books and polished wooden desk, natural window light"],
    [/\b(finance|banking|stock|investment|market|economy|trading)\b/,                "Modern city financial district skyline at dusk with upward trending graph overlay"],
    [/\b(real estate|property|housing|building|architecture|construction)\b/,        "Contemporary building exterior with clean lines, blue sky and greenery"],
    [/\b(manufacturing|factory|production|industrial|supply chain|logistics)\b/,     "Modern factory floor with automated machinery and clean industrial aesthetic"],
    [/\b(agriculture|farm|crop|harvest|food production|sustainable farming)\b/,      "Wide aerial shot of green farmland at golden hour with clear skies"],
    [/\b(energy|solar|renewable|wind|sustainability|climate|green)\b/,               "Solar panels and wind turbines on a clean landscape under a bright blue sky"],
    [/\b(retail|ecommerce|shopping|consumer|brand|product)\b/,                       "Bright minimalist retail display with clean product arrangement and soft shadows"],
    [/\b(marketing|advertising|brand|campaign|social media|digital)\b/,              "Creative agency workspace with mood boards, laptops and natural light"],
    [/\b(education|school|university|learning|student|classroom)\b/,                 "Bright modern classroom or library with students engaged, warm natural lighting"],
    [/\b(travel|hotel|tourism|destination|airline|hospitality)\b/,                   "Stunning travel destination at golden hour, wide open landscape with clear sky"],
    [/\b(food|restaurant|dining|nutrition|cuisine|beverage|chef)\b/,                 "Beautifully plated dish on a clean surface with soft studio lighting"],
    [/\b(science|discovery|research|space|nature|biology|physics)\b/,                "Stunning macro or space photography with dramatic lighting and vibrant colours"],
    [/\b(hr|workforce|hiring|talent|team|employee|workplace)\b/,                     "Diverse professional team collaborating in a bright modern office"],
  ];

  for (const [pattern, scene] of sceneMap) {
    if (pattern.test(text)) return scene;
  }
  // Generic fallback — uses the article title as a natural language prompt
  return `Professional editorial image representing: ${idea.title}. Clean background, high quality, photorealistic`;
}



type RssIdea = {
  index: number; title: string; url: string; summary: string;
  ad_concept: string; suggested_tone: string; goal: string;
  image_prompt?: string;  // AI-generated image scene prompt from get-ideas endpoint
};

// Map RSS tone value → Create Ad prefill fields — derived from TONE_OPTIONS itself
function getToneAdFields(toneValue: string) {
  const opt = TONE_OPTIONS.find(o => o.value === toneValue) ?? TONE_OPTIONS[0];
  return { adTone: opt.adTone, direction: opt.direction, voiceKey: opt.voiceKey };
}


// ── Saved RSS ideas (localStorage, 24h TTL) ─────────────────────────────────

type SavedIdea = RssIdea & {
  savedAt: number;        // Date.now() when stored
  feedId: string;
  feedName: string;
  toneStyle: string;
  includeLink: boolean;
  imageScene: string;
};

function loadSavedIdeas(): SavedIdea[] {
  try {
    const raw = localStorage.getItem('nivaspark_rss_ideas');
    if (!raw) return [];
    const all: SavedIdea[] = JSON.parse(raw);
    // Purge expired (>24h old)
    const fresh = all.filter(i => Date.now() - i.savedAt < 86400000);
    if (fresh.length !== all.length) localStorage.setItem('nivaspark_rss_ideas', JSON.stringify(fresh));
    return fresh;
  } catch { return []; }
}

function saveSavedIdeas(ideas: SavedIdea[]) {
  try { localStorage.setItem('nivaspark_rss_ideas', JSON.stringify(ideas)); } catch {}
}

function RssFeedsTab() {
  const { me } = useAuth();
  const isPro = me?.tier === "pro";
  const { platforms: availPlatforms, connected: connectedPlatformIds } = useConnectedPlatforms();
  const navigate = useNavigate();

  const [catalogue, setCatalogue] = useState<Record<string, RssFeed[]>>({});
  const [subs, setSubs] = useState<RssFeedSub[]>([]);
  const [drafts, setDrafts] = useState<RssDraft[]>([]);
  const [availableModels, setAvailableModels] = useState<{ image: any[]; video: any[] }>({ image: [], video: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Filters + pagination
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [page, setPage] = useState(0);

  // Right-column tab: "subscriptions" | "ideas"
  const [rightTab, setRightTab] = useState<"subscriptions" | "ideas">("subscriptions");

  // Saved ideas (persisted in localStorage)
  const [savedIdeas, setSavedIdeas] = useState<SavedIdea[]>(() => loadSavedIdeas());

  // Inline ideas generation state
  const [ideasFeed, setIdeasFeed] = useState<RssFeed | null>(null);  // which feed is being queried
  const [articleSelection, setArticleSelection] = useState("most_recent");
  const [ideaCount, setIdeaCount] = useState(4);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasErr, setIdeasErr] = useState("");
  // Per-idea settings (ephemeral, just for the current generate session)
  const [ideaSettings, setIdeaSettings] = useState<Record<number, { toneStyle: string; includeLink: boolean; imageScene: string }>>({});

  function getIdeaSettings(i: number) {
    return ideaSettings[i] ?? { toneStyle: "we", includeLink: true, imageScene: "" };
  }
  function setIdeaSetting(i: number, key: "toneStyle" | "includeLink" | "imageScene", val: any) {
    setIdeaSettings(prev => ({ ...prev, [i]: { ...getIdeaSettings(i), [key]: val } }));
  }

  // Modal state
  const [subscribeModal, setSubscribeModal] = useState<{ feedId: string } | null>(null);
  const [customModal, setCustomModal] = useState(false);
  const [editModal, setEditModal] = useState<RssFeedSub | null>(null);

  // Article scraping popup state
  const [scrapingPopup, setScrapingPopup] = useState<{ title: string; url: string } | null>(null);
  const [scrapingError, setScrapingError] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      const [cat, s, d, models] = await Promise.all([
        api("/agent/rss/feeds/catalogue"),
        api("/agent/rss/subscriptions"),
        api("/agent/rss/drafts"),
        api("/ads/available-models").catch(() => ({ image: [], video: [] })),
      ]);
      setCatalogue(cat);
      setSubs(s);
      setDrafts(d);
      setAvailableModels({ image: models.image || [], video: models.video || [] });
    } catch (e: any) {
      setErr(e.message || "Could not load RSS feeds");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(0); }, [categoryFilter]);

  // ── Idea generation ────────────────────────────────────────────────
  async function generateIdeas() {
    if (!ideasFeed) return;
    setIdeasLoading(true); setIdeasErr("");
    try {
      const res = await api("/agent/rss/get-ideas", {
        method: "POST",
        body: { rss_feed_id: ideasFeed.id, article_selection: articleSelection, count: ideaCount },
      });
      const incoming: RssIdea[] = res.ideas || [];

      // Derive per-idea settings defaults
      const defaults: Record<number, { toneStyle: string; includeLink: boolean; imageScene: string }> = {};
      incoming.forEach((idea, i) => {
        defaults[i] = { toneStyle: "we", includeLink: true, imageScene: idea.image_prompt || deriveImageScene(idea) };
      });
      setIdeaSettings(defaults);

      // Save to localStorage with TTL
      const newSaved: SavedIdea[] = incoming.map((idea, i) => ({
        ...idea,
        savedAt: Date.now(),
        feedId: ideasFeed.id,
        feedName: ideasFeed.name,
        toneStyle: "we",
        includeLink: true,
        imageScene: idea.image_prompt || deriveImageScene(idea),
      }));
      const merged = [...loadSavedIdeas(), ...newSaved];
      saveSavedIdeas(merged);
      setSavedIdeas(merged);
      setRightTab("ideas");
    } catch (e: any) {
      setIdeasErr(e.message || "Could not generate ideas");
    }
    setIdeasLoading(false);
  }

  // ── Idea management ────────────────────────────────────────────────
  function dismissIdea(idea: SavedIdea) {
    const updated = savedIdeas.filter(x => x.savedAt !== idea.savedAt || x.url !== idea.url);
    setSavedIdeas(updated);
    saveSavedIdeas(updated);
  }

  function clearAllIdeas() {
    setSavedIdeas([]);
    saveSavedIdeas([]);
  }

  function expiresIn(idea: SavedIdea) {
    const ms = idea.savedAt + 86400000 - Date.now();
    const h = Math.max(0, Math.floor(ms / 3600000));
    const m = Math.max(0, Math.floor((ms % 3600000) / 60000));
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ── Create Ad from saved idea (with article scraping) ─────────────
  async function createAdFromIdea(idea: SavedIdea) {
    const { adTone, direction, voiceKey } = getToneAdFields(idea.toneStyle);

    // Show scraping popup
    setScrapingError("");
    setScrapingPopup({ title: idea.title, url: idea.url });

    let copyDirections = direction;

    // Try to scrape and summarise the article
    if (idea.url) {
      try {
        const result = await api("/agent/rss/scrape-article", {
          method: "POST",
          body: { url: idea.url, title: idea.title },
        });
        if (result?.summary) {
          // Build copy directions: voice direction + article summary
          const parts: string[] = [];
          if (direction) parts.push(direction);
          parts.push(result.summary);
          // Explicit URL instruction — separate from the summary so the LLM
          // treats it as a hard requirement, not just background context
          if (idea.includeLink && idea.url) {
            parts.push(`IMPORTANT: You MUST end the post with the source URL on its own line: ${idea.url}`);
          }
          copyDirections = parts.join("\n\n");
        } else {
          // Fallback: no summary, just voice + URL instruction
          if (idea.includeLink && idea.url) {
            copyDirections = `${direction}\n\nEnd the post with the source link on its own line: ${idea.url}`;
          }
        }
      } catch (e: any) {
        // Non-fatal — fall back to basic copy directions without summary
        setScrapingError(e?.message || "Could not retrieve article content.");
        if (idea.includeLink && idea.url) {
          copyDirections = `${direction}\n\nEnd the post with the source link on its own line: ${idea.url}`;
        }
        // Wait briefly so user sees the error before navigating
        await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      if (idea.includeLink && idea.url) {
        copyDirections += ` End the post with the source link on its own line: ${idea.url}`;
      }
    }

    setScrapingPopup(null);

    sessionStorage.setItem("nivaad_prefill_product", JSON.stringify({
      name: idea.title,
      description: idea.summary,
      audience: deriveAudience(idea, idea.toneStyle),
      goal: idea.goal,
      tone: adTone,
      voice: voiceKey,
      copy_directions: copyDirections,
      source_url: idea.url,
      image_scene: idea.imageScene || deriveImageScene(idea),
    }));
    navigate({ to: "/app" });
  }

  // ── Subscription handlers ──────────────────────────────────────────
  async function handleSubscribe(form: SubFormState) {
    const payload: any = {
      rss_feed_id: form.rss_feed_id || undefined, custom_url: form.custom_url || undefined,
      label: form.label, content_type: form.content_type,
      image_model_id: form.image_model_id || undefined, video_model_id: form.video_model_id || undefined,
      platforms: form.platforms, posting_mode: form.posting_mode, frequency: form.frequency,
      post_hour: form.post_hour,
      day_of_week: form.frequency === "weekly" ? form.day_of_week : undefined,
      day_of_month: form.frequency === "monthly" ? form.day_of_month : undefined,
      posts_per_run: form.posts_per_run, article_selection: form.article_selection,
      tone_style: form.tone_style, enabled: true,
    };
    await api("/agent/rss/subscriptions", { method: "POST", body: payload });
    setSubscribeModal(null); setCustomModal(false); load();
  }

  async function handleUpdate(subId: string, form: SubFormState) {
    const payload: any = {
      label: form.label, content_type: form.content_type,
      image_model_id: form.image_model_id || undefined, video_model_id: form.video_model_id || undefined,
      platforms: form.platforms, posting_mode: form.posting_mode, frequency: form.frequency,
      post_hour: form.post_hour,
      day_of_week: form.frequency === "weekly" ? form.day_of_week : undefined,
      day_of_month: form.frequency === "monthly" ? form.day_of_month : undefined,
      posts_per_run: form.posts_per_run, article_selection: form.article_selection,
      tone_style: form.tone_style, enabled: form.enabled,
    };
    await api(`/agent/rss/subscriptions/${subId}`, { method: "PATCH", body: payload });
    setEditModal(null); load();
  }

  async function handleToggle(sub: RssFeedSub) {
    await api(`/agent/rss/subscriptions/${sub.id}`, { method: "PATCH", body: { enabled: !sub.enabled } });
    load();
  }

  async function handleDelete(sub: RssFeedSub) {
    if (!confirm(`Delete subscription "${sub.label || sub.feed_name || "this feed"}"? This can't be undone.`)) return;
    await api(`/agent/rss/subscriptions/${sub.id}`, { method: "DELETE" });
    load();
  }

  async function handleApproveDraft(draft: RssDraft) { await api(`/agent/rss/drafts/${draft.id}/approve`, { method: "POST" }); load(); }
  async function handleDismissDraft(draft: RssDraft) { await api(`/agent/rss/drafts/${draft.id}`, { method: "DELETE" }); load(); }

  // ── Computed ──────────────────────────────────────────────────────
  const subscribedFeedIds = new Set(subs.map(s => s.rss_feed_id).filter(Boolean) as string[]);
  const allFeeds: RssFeed[] = Object.entries(catalogue).flatMap(([, feeds]) => feeds);
  const uniqueCategories = Object.keys(catalogue).sort();
  const filteredFeeds = categoryFilter === "__all__" ? allFeeds : allFeeds.filter(f => f.category === categoryFilter);
  const totalPages = Math.ceil(filteredFeeds.length / RSS_PAGE_SIZE);
  const pageFeeds = filteredFeeds.slice(page * RSS_PAGE_SIZE, (page + 1) * RSS_PAGE_SIZE);

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  const fmtNextRun = (s: RssFeedSub) => {
    if (!s.next_run_at) return "—";
    const d = new Date(s.next_run_at);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };
  const fmtLastRun = (s: RssFeedSub) => s.last_run_at ? new Date(s.last_run_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Never";
  const expiresInDraft = (d: RssDraft) => {
    const ms = new Date(d.expires_at).getTime() - Date.now();
    const h = Math.max(0, Math.floor(ms / 3600000));
    const m = Math.max(0, Math.floor((ms % 3600000) / 60000));
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading) return <div className="text-xs text-muted-foreground py-6">Loading…</div>;
  if (err) return <div className="text-xs text-destructive py-4">{err}</div>;

  const hasDrafts = drafts.length > 0;
  const hasSubs = subs.length > 0;
  const hasCatalogue = Object.keys(catalogue).length > 0;
  const hasIdeas = savedIdeas.length > 0;

  const miniSelCls = "rounded-lg border border-border bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none";

  return (
    <div className="space-y-6">

      {/* ── Article Scraping Popup ── */}
      {scrapingPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[oklch(0.18_0.02_260)] p-6 shadow-2xl text-center">
            {scrapingError ? (
              <>
                <div className="mb-3 text-2xl">⚠️</div>
                <div className="text-sm font-semibold text-foreground mb-1">Couldn't retrieve article</div>
                <div className="text-xs text-muted-foreground mb-4">{scrapingError}</div>
                <div className="text-xs text-muted-foreground">Continuing to Create Ad with basic info…</div>
              </>
            ) : (
              <>
                <div className="mb-4 flex justify-center">
                  <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
                <div className="text-sm font-semibold text-foreground mb-1">Retrieving article content</div>
                <div className="mt-1 text-xs text-muted-foreground line-clamp-2 px-2">{scrapingPopup.title}</div>
                <div className="mt-3 text-[11px] text-muted-foreground/60">Summarising blog for your ad…</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Pending Drafts ── */}
      {hasDrafts && (
        <section>
          <h3 className="text-xs font-bold text-foreground mb-3 flex items-center gap-2">
            📬 Pending approvals
            <span className="rounded-full bg-amber-500/20 border border-amber-400/30 px-2 py-0.5 text-[11px] text-amber-300">{drafts.length}</span>
          </h3>
          <div className="space-y-2">
            {drafts.map(draft => (
              <div key={draft.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-foreground line-clamp-1">{draft.article_title || "Untitled article"}</div>
                    {draft.article_summary && <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{draft.article_summary}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span>{draft.feed_name || draft.subscription_label || "Feed"}</span>
                      <span>·</span>
                      <span className="text-amber-400">Expires in {expiresInDraft(draft)}</span>
                      {draft.article_url && <a href={draft.article_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View ↗</a>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleDismissDraft(draft)} className="rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-all">Dismiss</button>
                    <button onClick={() => handleApproveDraft(draft)} className="rounded-full bg-gold-gradient px-3 py-1.5 text-[11px] font-semibold text-background shadow-[var(--shadow-gold)]">Approve & Post</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Main two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* ── LEFT: Feed Catalogue + Get Ideas ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xs font-bold text-foreground">Browse feeds</h3>
            {isPro && (
              <button onClick={() => setCustomModal(true)}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-primary/30 bg-primary/5 px-3 py-1 text-[11px] text-primary hover:border-primary/50 hover:bg-primary/10 transition-all">
                <span>+</span> Add custom URL
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">Pro</span>
              </button>
            )}
          </div>

          {/* Category filter */}
          {uniqueCategories.length > 0 && (
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
              <option value="__all__">All categories ({allFeeds.length} feeds)</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c} ({catalogue[c]?.length ?? 0})</option>)}
            </select>
          )}

          {/* Inline Get Ideas panel — shown when a feed is selected */}
          {ideasFeed && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-foreground">💡 Get ideas from feed</div>
                  <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">{ideasFeed.name}</div>
                </div>
                <button onClick={() => { setIdeasFeed(null); setIdeasErr(""); }} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
              </div>

              {/* Step 1 indicator */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-background text-[9px] font-bold">1</span>
                Choose articles to surface
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-1">Article selection</label>
                  <select value={articleSelection} onChange={e => setArticleSelection(e.target.value)}
                    className="w-full rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none">
                    {SELECTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-1">Number of ideas</label>
                  <div className="flex gap-1">
                    {[2, 3, 4, 5, 6].map(n => (
                      <button key={n} type="button" onClick={() => setIdeaCount(n)}
                        className={`flex-1 rounded-lg border py-1.5 text-[11px] transition-all ${ideaCount === n ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/40"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {ideasErr && <p className="text-[11px] text-destructive">{ideasErr}</p>}

              <button onClick={generateIdeas} disabled={ideasLoading}
                className="w-full rounded-full bg-gold-gradient py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
                {ideasLoading ? "Fetching feed…" : "Generate ideas · 0.25 cr →"}
              </button>

              {ideasLoading && (
                <div className="flex items-center gap-2 text-[11px] text-primary animate-pulse justify-center">
                  <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Reading {ideasFeed.name}…
                </div>
              )}
            </div>
          )}

          {/* Feed list */}
          {!hasCatalogue ? (
            <div className="rounded-xl border border-dashed border-border/40 p-6 text-center">
              <div className="text-2xl mb-2">📰</div>
              <p className="text-[11px] text-muted-foreground">No feeds in the catalogue yet.</p>
            </div>
          ) : pageFeeds.length === 0 ? (
            <div className="text-[11px] text-muted-foreground py-4 text-center">No feeds match this filter.</div>
          ) : (
            <div className="space-y-2">
              {pageFeeds.map((feed: RssFeed) => {
                const alreadySubscribed = subscribedFeedIds.has(feed.id);
                const checkedDate = (feed as any).last_checked_at ? fmtDate((feed as any).last_checked_at) : null;
                const status = (feed as any).last_status as string | null;
                const isActive = ideasFeed?.id === feed.id;
                return (
                  <div key={feed.id} className={`rounded-xl border p-3 transition-all ${isActive ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/50"}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-foreground truncate">{feed.name}</div>
                        {feed.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{feed.description}</p>}
                      </div>
                    </div>
                    <div className="mb-2 flex items-center gap-1.5 text-[11px]">
                      {!status ? <span className="text-muted-foreground/50">⚪ Not yet verified</span>
                        : status === "ok" ? <span className="text-emerald-400">🟢 Active{(feed as any).last_article_count != null ? ` · ${(feed as any).last_article_count} articles` : ""}</span>
                        : <span className="text-red-400">🔴 Error</span>}
                      {checkedDate && <span className="text-muted-foreground/40">· {checkedDate}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setIdeasFeed(isActive ? null : feed); setIdeasErr(""); }}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-all ${isActive ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"}`}>
                        {isActive ? "✕ Cancel" : "💡 Get ideas"}
                      </button>
                      {alreadySubscribed ? (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-1 text-[11px] text-emerald-300">✓ Subscribed</span>
                      ) : (
                        <button onClick={() => setSubscribeModal({ feedId: feed.id })}
                          className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/15 transition-all">
                          Subscribe
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="rounded-full border border-border/40 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all">← Prev</button>
              <span className="text-[11px] text-muted-foreground">Page {page + 1} of {totalPages} · {filteredFeeds.length} feeds</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="rounded-full border border-border/40 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all">Next →</button>
            </div>
          )}
        </section>

        {/* ── RIGHT: Tabbed panel — Subscriptions | Ideas ── */}
        <section className="space-y-3">
          {/* Tab bar */}
          <div className="flex items-center gap-1">
            <button onClick={() => setRightTab("subscriptions")}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-all ${rightTab === "subscriptions" ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:text-foreground"}`}>
              📡 Subscriptions {hasSubs ? `(${subs.length})` : ""}
            </button>
            <button onClick={() => setRightTab("ideas")}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-all ${rightTab === "ideas" ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:text-foreground"}`}>
              💡 Ideas {hasIdeas ? `(${savedIdeas.length})` : ""}
            </button>
          </div>

          {/* ── Subscriptions tab ── */}
          {rightTab === "subscriptions" && (
            !hasSubs ? (
              <div className="rounded-xl border border-dashed border-border/40 p-6 text-center">
                <div className="text-2xl mb-2">📡</div>
                <p className="text-[11px] text-muted-foreground">Subscribe to a feed on the left to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {subs.map(sub => (
                  <div key={sub.id} className={`rounded-xl border p-3.5 transition-all ${sub.enabled ? "border-border/50 bg-card" : "border-border/20 bg-muted/10 opacity-60"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground truncate">{sub.label || sub.feed_name || sub.custom_url || "Unnamed feed"}</span>
                          {sub.feed_category && <span className="rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] text-primary">{sub.feed_category}</span>}
                          {sub.custom_url && !sub.rss_feed_id && <span className="rounded-full bg-violet-500/10 border border-violet-400/20 px-1.5 py-0.5 text-[10px] text-violet-300">Custom</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>{CONTENT_TYPE_OPTIONS.find(o => o.value === sub.content_type)?.label ?? sub.content_type}</span>
                          <span>{sub.posting_mode === "auto_post" ? "⚡ Auto-post" : "✋ Manual"}</span>
                          <span>{sub.frequency === "daily" ? "Daily" : sub.frequency === "weekly" ? `Weekly (${DAYS_OF_WEEK[sub.day_of_week ?? 0]})` : `Monthly (day ${sub.day_of_month ?? 1})`}{" · "}{sub.posts_per_run} post{sub.posts_per_run > 1 ? "s" : ""}/run</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground/60">Last run: {fmtLastRun(sub)} · Next: {fmtNextRun(sub)}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => handleToggle(sub)} title={sub.enabled ? "Disable" : "Enable"}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${sub.enabled ? "bg-primary border-primary" : "bg-muted border-border"}`}>
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${sub.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                        <button onClick={() => setEditModal(sub)} className="rounded-full border border-border/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-all">Edit</button>
                        <button onClick={() => handleDelete(sub)} className="rounded-full border border-border/30 px-2.5 py-1 text-[11px] text-destructive/70 hover:text-destructive hover:border-destructive/30 transition-all">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ── Ideas tab ── */}
          {rightTab === "ideas" && (
            !hasIdeas ? (
              <div className="rounded-xl border border-dashed border-border/40 p-6 text-center">
                <div className="text-2xl mb-2">💡</div>
                <p className="text-[11px] text-muted-foreground">Click "Get ideas" on any feed to generate article ideas here.</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Ideas are saved for 24 hours.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">{savedIdeas.length} idea{savedIdeas.length !== 1 ? "s" : ""} saved · expire within 24h</p>
                  <button onClick={clearAllIdeas} className="text-[11px] text-destructive/70 hover:text-destructive">Clear all</button>
                </div>
                {savedIdeas.map((idea, idx) => (
                  <div key={`${idea.savedAt}-${idx}`} className="rounded-xl border border-border/50 bg-card/60 p-3.5 space-y-2.5">
                    {/* Article info */}
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold text-foreground line-clamp-2 flex-1">{idea.title}</div>
                        <button onClick={() => dismissIdea(idea)} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0 text-sm">✕</button>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{idea.summary}</p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/60">
                        <span>{idea.feedName}</span>
                        <span>·</span>
                        <span className="text-amber-400/80">expires in {expiresIn(idea)}</span>
                        {idea.url && <a href={idea.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto">Read ↗</a>}
                      </div>
                    </div>

                    {/* Per-idea settings */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[11px] text-muted-foreground whitespace-nowrap">Voice:</label>
                        <select value={idea.toneStyle}
                          onChange={e => {
                            const updated = savedIdeas.map((x, i) => i === idx ? { ...x, toneStyle: e.target.value } : x);
                            setSavedIdeas(updated); saveSavedIdeas(updated);
                          }}
                          className={miniSelCls}>
                          {TONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={idea.includeLink}
                          onChange={e => {
                            const updated = savedIdeas.map((x, i) => i === idx ? { ...x, includeLink: e.target.checked } : x);
                            setSavedIdeas(updated); saveSavedIdeas(updated);
                          }}
                          className="accent-primary h-3.5 w-3.5" />
                        <span className="text-[11px] text-muted-foreground">Include link</span>
                      </label>
                    </div>

                    {/* Tone description */}
                    {TONE_OPTIONS.find(o => o.value === idea.toneStyle)?.desc && (
                      <p className="text-[11px] text-muted-foreground/60 leading-snug">{TONE_OPTIONS.find(o => o.value === idea.toneStyle)!.desc}</p>
                    )}

                    {/* Image scene */}
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">🖼 Image scene</label>
                      <textarea value={idea.imageScene} rows={2}
                        onChange={e => {
                          const updated = savedIdeas.map((x, i) => i === idx ? { ...x, imageScene: e.target.value } : x);
                          setSavedIdeas(updated); saveSavedIdeas(updated);
                        }}
                        className="w-full rounded-lg border border-border/40 bg-input/30 px-2.5 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none resize-none"
                        placeholder="Describe the image background…"
                      />
                    </div>

                    <button onClick={() => createAdFromIdea(idea)}
                      className="w-full rounded-full bg-gold-gradient py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)]">
                      Create ad →
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </section>
      </div>

      {/* ── Modals ── */}
      {subscribeModal && (
        <SubModal title="Subscribe to feed" initialForm={defaultForm(subscribeModal.feedId)}
          availableModels={availableModels} connectedPlatformIds={connectedPlatformIds} availPlatforms={availPlatforms}
          onSave={handleSubscribe} onClose={() => setSubscribeModal(null)} />
      )}
      {customModal && (
        <SubModal title="Add custom RSS feed" initialForm={defaultForm("")}
          availableModels={availableModels} connectedPlatformIds={connectedPlatformIds} availPlatforms={availPlatforms}
          onSave={handleSubscribe} onClose={() => setCustomModal(false)} />
      )}
      {editModal && (
        <SubModal title="Edit subscription"
          initialForm={{
            rss_feed_id: editModal.rss_feed_id || "", custom_url: editModal.custom_url || "",
            label: editModal.label, content_type: editModal.content_type,
            image_model_id: editModal.image_model_id || "", video_model_id: editModal.video_model_id || "",
            platforms: editModal.platforms || [], posting_mode: editModal.posting_mode,
            frequency: editModal.frequency, post_hour: editModal.post_hour ?? 9,
            day_of_week: editModal.day_of_week ?? 0,
            day_of_month: editModal.day_of_month ?? 1, posts_per_run: editModal.posts_per_run,
            article_selection: editModal.article_selection, tone_style: editModal.tone_style,
            enabled: editModal.enabled,
          }}
          availableModels={availableModels} connectedPlatformIds={connectedPlatformIds} availPlatforms={availPlatforms}
          onSave={(form) => handleUpdate(editModal.id, form)} onClose={() => setEditModal(null)} />
      )}
    </div>
  );
}

// ── Brand Campaign Streak Tab ──────────────────────────────────────────────

type StreakType = "one_month" | "two_months" | "three_months" | "custom";

const STREAK_OPTIONS: { value: StreakType; label: string; ads: number; cadence: string }[] = [
  { value: "one_month",    label: "1 Month",   ads: 30, cadence: "1 ad/day" },
  { value: "two_months",   label: "2 Months",  ads: 24, cadence: "3 ads/week" },
  { value: "three_months", label: "3 Months",  ads: 36, cadence: "3 ads/week" },
  { value: "custom",       label: "Custom",    ads: 0,  cadence: "You choose" },
];

interface StreakIdeaCard {
  sort_order: number;
  title: string;
  description: string;
  ad_copy: string;
  image_prompt: string;
  audience: string;
  voice: string;
  platforms: string[];
  scheduled_date: string | null;
  scheduled_time: string;
  timezone: string;
  status: "idea" | "scheduled" | "cancelled";
  // set after saving to DB
  id?: string;
  streak_id?: string;
}

interface ScheduledStreak {
  id: string;
  url: string;
  site_name: string;
  streak_type: string;
  total_ads: number;
  status: string;
  created_at: string;
  ads: ScheduledAd[];
}

interface ScheduledAd {
  id: string;
  sort_order: number;
  title: string;
  ad_copy: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string;
  platforms: string[];
  failure_reason?: string;
}

const STATUS_COLORS: Record<string, string> = {
  idea: "text-muted-foreground",
  scheduled: "text-blue-400",
  generating: "text-amber-400",
  generated: "text-emerald-400",
  posted: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-muted-foreground/40",
};

const STATUS_ICONS: Record<string, string> = {
  idea: "💡", scheduled: "📅", generating: "⚙️",
  generated: "✅", posted: "🚀", failed: "❌", cancelled: "✕",
};

function getBrowserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
}

function BrandCampaignStreakTab() {
  const tz = getBrowserTimezone();
  const { platforms: availPlatforms, connected: connectedIds } = useConnectedPlatforms();

  // ── Input state ──────────────────────────────────────────────────────
  const [url, setUrl] = useState("");
  const [streakType, setStreakType] = useState<StreakType>("one_month");
  const [customAds, setCustomAds] = useState(15);
  const [err, setErr] = useState("");

  // ── Active streak being reviewed (from DB) ───────────────────────────
  const [activeStreak, setActiveStreak] = useState<ScheduledStreak | null>(null);
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Right panel sub-tab ───────────────────────────────────────────────
  const [rightTab, setRightTab] = useState<"streaks" | "jobs">("streaks");

  // ── All streaks (scheduled panel) ────────────────────────────────────
  const [allStreaks, setAllStreaks] = useState<ScheduledStreak[]>([]);
  const [groupedByUrl, setGroupedByUrl] = useState<Record<string, ScheduledStreak[]>>({});
  const [collapsedSites, setCollapsedSites] = useState<Set<string>>(new Set());
  const [expandedStreaks, setExpandedStreaks] = useState<Set<string>>(new Set());
  const [expandedScheduledAds, setExpandedScheduledAds] = useState<Set<string>>(new Set());

  // ── Ideas editing state ───────────────────────────────────────────────
  const [expandedIdeas, setExpandedIdeas] = useState<Set<number>>(new Set());
  const [globalPlatforms, setGlobalPlatforms] = useState<string[]>([]);
  const [scheduleErr, setScheduleErr] = useState("");
  const [saving, setSaving] = useState(false);

  const totalAds = streakType === "custom" ? customAds
    : STREAK_OPTIONS.find(o => o.value === streakType)!.ads;

  // ── Load all streaks on mount ─────────────────────────────────────────
  useEffect(() => {
    loadAllStreaks();
    // Resume polling if there's a generating streak
    resumePollingIfNeeded();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  async function loadAllStreaks() {
    try {
      const data: ScheduledStreak[] = await api("/agent/streak/streaks") || [];
      setAllStreaks(data);
      const grouped: Record<string, ScheduledStreak[]> = {};
      for (const s of data) {
        if (!grouped[s.url]) grouped[s.url] = [];
        grouped[s.url].push(s);
      }
      setGroupedByUrl(grouped);
    } catch { /* silent */ }
  }

  async function resumePollingIfNeeded() {
    // Check if there's a generating streak in the DB
    try {
      const data: ScheduledStreak[] = await api("/agent/streak/streaks") || [];
      const generating = data.find(s => s.status === "generating");
      if (generating) {
        setActiveStreak(generating as any);
        setRightTab("jobs");
        startPolling(generating.id);
      }
    } catch { /* silent */ }
  }

  function startPolling(streakId: string) {
    setPolling(true);
    if (pollingRef.current) clearInterval(pollingRef.current);
    const startTime = Date.now();
    const MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes max

    pollingRef.current = setInterval(async () => {
      // Safety timeout — stop polling after 10 minutes regardless
      if (Date.now() - startTime > MAX_POLL_MS) {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
        setPolling(false);
        setActiveStreak(prev => prev ? { ...prev, status: "failed", generation_error: "Generation timed out. Please try again." } as any : prev);
        return;
      }
      try {
        const data = await api(`/agent/streak/streaks/${streakId}`);
        setActiveStreak(data);
        if (data.status !== "generating") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setPolling(false);
          await loadAllStreaks();
        }
      } catch {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
        setPolling(false);
      }
    }, 3000);
  }

  // ── Generate ──────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!url.trim()) { setErr("Enter a website URL first."); return; }
    setErr("");
    setScheduleErr("");
    setActiveStreak(null);
    setExpandedIdeas(new Set());
    setGlobalPlatforms([]);

    try {
      // API creates streak row + fires Celery task, returns immediately
      const data = await api("/agent/streak/generate-ideas", {
        method: "POST",
        body: { url: url.trim(), streak_type: streakType, total_ads: totalAds, timezone: tz },
      });
      setActiveStreak(data);
      setRightTab("jobs");
      startPolling(data.id);
      await loadAllStreaks();
    } catch (e: any) {
      setErr(e.message || "Failed to start generation.");
    }
  }

  // ── Update idea field locally ─────────────────────────────────────────
  function updateIdea(adId: string, patch: Partial<ScheduledAd>) {
    setActiveStreak(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ads: prev.ads.map(a => a.id === adId ? { ...a, ...patch } : a),
      };
    });
  }

  // ── Save edits to DB ──────────────────────────────────────────────────
  async function saveAdEdits(ad: ScheduledAd) {
    try {
      await api(`/agent/streak/ads/${ad.id}`, {
        method: "PATCH",
        body: {
          ad_copy: ad.ad_copy,
          image_prompt: (ad as any).image_prompt,
          platforms: ad.platforms,
          scheduled_date: ad.scheduled_date,
          scheduled_time: ad.scheduled_time,
        },
      });
    } catch { /* silent — will retry on schedule */ }
  }

  // ── Schedule one ad ───────────────────────────────────────────────────
  async function handleScheduleOne(ad: ScheduledAd) {
    if (!ad.platforms.length) { setScheduleErr("Select at least one platform."); return; }
    if (!ad.scheduled_date) { setScheduleErr("Set a date for this ad."); return; }
    setScheduleErr("");
    try {
      await saveAdEdits(ad);
      await api(`/agent/streak/ads/${ad.id}/schedule`, { method: "POST" });
      updateIdea(ad.id, { status: "scheduled" });
      await loadAllStreaks();
    } catch (e: any) { setScheduleErr(e.message || "Failed to schedule."); }
  }

  // ── Schedule all ─────────────────────────────────────────────────────
  async function handleScheduleAll() {
    if (!activeStreak) return;
    const toSchedule = activeStreak.ads.filter(a =>
      a.status === "idea" && a.platforms.length > 0 && a.scheduled_date
    );
    if (toSchedule.length === 0) {
      setScheduleErr("No ads ready to schedule. Make sure all have platforms and dates.");
      return;
    }
    setScheduleErr("");
    setSaving(true);
    try {
      // Save all edits first
      await Promise.all(toSchedule.map(a => saveAdEdits(a)));
      // Schedule all
      await api("/agent/streak/ads/schedule-all", {
        method: "POST",
        body: { streak_id: activeStreak.id },
      });
      // Refresh
      const updated = await api(`/agent/streak/streaks/${activeStreak.id}`);
      setActiveStreak(updated);
      await loadAllStreaks();
    } catch (e: any) {
      setScheduleErr(e.message || "Failed to schedule all.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelAd(adId: string) {
    try {
      await api(`/agent/streak/ads/${adId}/cancel`, { method: "DELETE" });
      updateIdea(adId, { status: "cancelled" });
      await loadAllStreaks();
    } catch { /* silent */ }
  }

  async function handleDeleteStreak(streakId: string) {
    try {
      await api(`/agent/streak/streaks/${streakId}`, { method: "DELETE" });
      if (activeStreak?.id === streakId) setActiveStreak(null);
      await loadAllStreaks();
    } catch { /* silent */ }
  }

  const platformLabel = (id: string) => {
    const p = availPlatforms.find(p => p.id === id);
    return p ? (p.label || p.name) : id;
  };

  const ideaAds = activeStreak?.ads?.filter(a => a.status === "idea") || [];
  const scheduledAds = activeStreak?.ads?.filter(a => a.status === "scheduled") || [];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

      {/* ── LEFT PANEL ── */}
      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-background/30 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">🚀 Brand Campaign Streak</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Enter a website URL, choose a campaign duration — we'll generate a full content calendar ready to review and schedule.
          </p>

          {/* URL */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-foreground mb-1.5">Company website URL</label>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {/* Streak type */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-foreground mb-2">Campaign streak</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STREAK_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setStreakType(opt.value)}
                  className={`rounded-xl border p-3 text-left transition-all ${streakType === opt.value ? "border-primary bg-primary/10" : "border-border/50 hover:border-primary/30"}`}>
                  <div className="text-xs font-semibold text-foreground">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {opt.value === "custom" ? `max ${customAds} ads` : `${opt.ads} ads · ${opt.cadence}`}
                  </div>
                </button>
              ))}
            </div>
            {streakType === "custom" && (
              <div className="mt-3 flex items-center gap-3">
                <label className="text-xs text-muted-foreground shrink-0">Number of ads (max 48):</label>
                <input type="number" min={1} max={48} value={customAds}
                  onChange={e => setCustomAds(Math.min(48, Math.max(1, Number(e.target.value))))}
                  className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none" />
              </div>
            )}
          </div>

          {err && <p className="mb-3 text-xs text-destructive">{err}</p>}

          <button onClick={handleGenerate}
            disabled={!url.trim() || polling}
            className="w-full rounded-full bg-gold-gradient py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
            {polling ? "⚙️ Generating in background…" : `✦ Generate ${totalAds} Ideas`}
          </button>
        </div>

        {/* Ideas list — shown when activeStreak is ideas_ready or active */}
        {activeStreak && (activeStreak.status === "ideas_ready" || activeStreak.status === "active") && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{activeStreak.ads?.length || 0} Ideas Ready</h3>
                <p className="text-[10px] text-muted-foreground">{activeStreak.site_name} · {STREAK_OPTIONS.find(o => o.value === activeStreak.streak_type)?.label || activeStreak.streak_type}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setExpandedIdeas(new Set(activeStreak.ads?.map(a => a.sort_order) || []))}
                  className="text-[11px] text-primary hover:underline">Expand all</button>
                <span className="text-muted-foreground/40">·</span>
                <button onClick={() => setExpandedIdeas(new Set())}
                  className="text-[11px] text-muted-foreground hover:underline">Collapse all</button>
              </div>
            </div>

            {scheduleErr && <p className="text-xs text-destructive">{scheduleErr}</p>}

            {/* Global platform selector */}
            <div className="rounded-xl border border-border/40 bg-background/20 p-3 space-y-2">
              <div className="text-[11px] font-medium text-foreground">Apply platforms to all ideas</div>
              <div className="flex flex-wrap gap-1.5">
                {availPlatforms.map(p => {
                  const isConn = connectedIds.has(p.id);
                  const isSel = globalPlatforms.includes(p.id);
                  return (
                    <button key={p.id} type="button" disabled={!isConn}
                      onClick={() => {
                        if (!isConn) return;
                        const next = isSel ? globalPlatforms.filter(x => x !== p.id) : [...globalPlatforms, p.id];
                        setGlobalPlatforms(next);
                        setActiveStreak(prev => prev ? {
                          ...prev, ads: prev.ads.map(a => ({ ...a, platforms: next }))
                        } : prev);
                      }}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all ${!isConn ? "border-border/20 text-muted-foreground/30 cursor-not-allowed opacity-40" : isSel ? "border-primary/60 bg-primary/15 text-primary" : "border-border/40 text-muted-foreground hover:border-primary/30"}`}>
                      {p.label || p.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Schedule All */}
            <button onClick={handleScheduleAll} disabled={saving}
              className="w-full rounded-full border border-primary/50 bg-primary/10 py-2 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-50">
              {saving ? "Scheduling…" : `📅 Schedule All ${ideaAds.length} Ideas`}
            </button>

            {/* Ideas */}
            {(activeStreak.ads || []).filter(a => a.status !== "cancelled").map(ad => {
              const isExpanded = expandedIdeas.has(ad.sort_order);
              return (
                <div key={ad.id} className={`rounded-xl border transition-all ${ad.status === "scheduled" ? "border-blue-500/30 bg-blue-500/5" : "border-border/50 bg-background/20"}`}>
                  <button onClick={() => setExpandedIdeas(prev => {
                    const next = new Set(prev);
                    next.has(ad.sort_order) ? next.delete(ad.sort_order) : next.add(ad.sort_order);
                    return next;
                  })} className="flex w-full items-start justify-between gap-3 p-3 text-left">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground shrink-0">#{ad.sort_order}</span>
                        <span className="text-xs font-semibold text-foreground truncate">{ad.title}</span>
                        {ad.status === "scheduled" && <span className="text-[10px] text-blue-400 shrink-0">✓ Scheduled</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {ad.scheduled_date || "No date"} · {(ad as any).scheduled_time || "09:00"}
                        {ad.platforms?.length > 0 && ` · ${ad.platforms.map(platformLabel).join(", ")}`}
                      </div>
                    </div>
                    <span className="text-muted-foreground text-xs">{isExpanded ? "▲" : "▼"}</span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/30 p-3 space-y-3">
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Ad copy (editable)</label>
                        <textarea rows={5} value={ad.ad_copy}
                          onChange={e => updateIdea(ad.id, { ad_copy: e.target.value })}
                          className="w-full rounded-lg border border-border bg-input/40 p-2.5 text-xs text-foreground focus:border-primary focus:outline-none resize-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Image prompt (editable)</label>
                        <textarea rows={2} value={(ad as any).image_prompt || ""}
                          onChange={e => updateIdea(ad.id, { image_prompt: e.target.value } as any)}
                          className="w-full rounded-lg border border-border bg-input/40 p-2.5 text-xs text-foreground focus:border-primary focus:outline-none resize-none" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Scheduled date</label>
                          <input type="date" value={ad.scheduled_date || ""}
                            onChange={e => updateIdea(ad.id, { scheduled_date: e.target.value })}
                            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Time (local)</label>
                          <input type="time" value={(ad as any).scheduled_time || "09:00"}
                            onChange={e => updateIdea(ad.id, { scheduled_time: e.target.value } as any)}
                            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1.5">Platforms</label>
                        <div className="flex flex-wrap gap-1.5">
                          {availPlatforms.map(p => {
                            const isConn = connectedIds.has(p.id);
                            const isSel = ad.platforms?.includes(p.id);
                            return (
                              <button key={p.id} type="button" disabled={!isConn}
                                onClick={() => {
                                  if (!isConn) return;
                                  const cur = ad.platforms || [];
                                  updateIdea(ad.id, { platforms: isSel ? cur.filter(x => x !== p.id) : [...cur, p.id] });
                                }}
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all ${!isConn ? "border-border/20 text-muted-foreground/30 cursor-not-allowed opacity-40" : isSel ? "border-primary/60 bg-primary/15 text-primary" : "border-border/40 text-muted-foreground hover:border-primary/30"}`}>
                                {p.label || p.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {ad.status === "idea" && (
                          <button onClick={() => handleScheduleOne(ad)}
                            className="flex-1 rounded-full border border-primary/50 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10">
                            📅 Schedule this idea
                          </button>
                        )}
                        {ad.status === "scheduled" && (
                          <button onClick={() => handleCancelAd(ad.id)}
                            className="flex-1 rounded-full border border-destructive/40 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                            Cancel
                          </button>
                        )}
                        {ad.status === "idea" && (
                          <button onClick={() => handleCancelAd(ad.id)}
                            className="rounded-full border border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground hover:text-destructive">
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="space-y-4">
        {/* Sub-tab switcher */}
        <div className="flex gap-2">
          {([["streaks", "📅 Scheduled Streaks"], ["jobs", "⚙️ Running Jobs"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setRightTab(k)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${rightTab === k ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:border-primary/30"}`}>
              {l}
              {k === "jobs" && polling && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {/* ── Scheduled Streaks tab ── */}
        {rightTab === "streaks" && (
          <>
            {Object.keys(groupedByUrl).length === 0 && (
              <div className="rounded-xl border border-border/30 bg-background/20 p-6 text-center">
                <p className="text-xs text-muted-foreground">No streaks scheduled yet.</p>
              </div>
            )}
            {Object.entries(groupedByUrl).map(([siteUrl, siteStreaks]) => {
              const siteName = siteStreaks[0]?.site_name || siteUrl;
              const isCollapsed = collapsedSites.has(siteUrl);
              const totalSched = siteStreaks.reduce((n, s) =>
                n + (s.ads || []).filter(a => ["scheduled","generated","posted"].includes(a.status)).length, 0);
              return (
                <div key={siteUrl} className="rounded-xl border border-border/50 bg-background/20 overflow-hidden">
                  <button onClick={() => setCollapsedSites(prev => {
                    const next = new Set(prev); next.has(siteUrl) ? next.delete(siteUrl) : next.add(siteUrl); return next;
                  })} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-white/5">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">🌐 {siteName}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{siteUrl} · {totalSched} ads scheduled</div>
                    </div>
                    <span className="text-muted-foreground text-xs">{isCollapsed ? "▼" : "▲"}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="border-t border-border/30 divide-y divide-border/20">
                      {siteStreaks.filter(s => s.status !== "generating").map(streak => {
                        const isExp = expandedStreaks.has(streak.id);
                        const sched = (streak.ads || []).filter(a => a.status !== "cancelled" && a.status !== "idea");
                        return (
                          <div key={streak.id}>
                            <button onClick={() => setExpandedStreaks(prev => {
                              const next = new Set(prev); next.has(streak.id) ? next.delete(streak.id) : next.add(streak.id); return next;
                            })} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-white/3">
                              <div className="flex-1 min-w-0">
                                <span className="text-[11px] font-medium text-foreground">
                                  {STREAK_OPTIONS.find(o => o.value === streak.streak_type)?.label || streak.streak_type} Streak
                                </span>
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  {sched.length}/{streak.total_ads} ads · {new Date(streak.created_at).toLocaleDateString()}
                                </span>
                              </div>
                              <span className="text-muted-foreground text-[10px]">{isExp ? "▲" : "▼"}</span>
                            </button>
                            {isExp && (
                              <div className="px-4 pb-3 space-y-1.5">
                                {(streak.ads || []).filter(a => a.status !== "cancelled").sort((a,b) => a.sort_order - b.sort_order).map(ad => {
                                  const isAdExp = expandedScheduledAds.has(ad.id);
                                  return (
                                    <div key={ad.id} className="rounded-lg border border-border/30 bg-background/10">
                                      <button onClick={() => setExpandedScheduledAds(prev => {
                                        const next = new Set(prev); next.has(ad.id) ? next.delete(ad.id) : next.add(ad.id); return next;
                                      })} className="flex w-full items-center gap-2 p-2 text-left">
                                        <span className="text-[10px]">{STATUS_ICONS[ad.status] || "•"}</span>
                                        <div className="flex-1 min-w-0">
                                          <span className="text-[11px] text-foreground truncate block">{ad.title}</span>
                                          <span className="text-[10px] text-muted-foreground">
                                            {ad.scheduled_date || "No date"} · <span className={STATUS_COLORS[ad.status] || ""}>{ad.status}</span>
                                          </span>
                                        </div>
                                        <span className="text-[9px] text-muted-foreground">{isAdExp ? "▲" : "▼"}</span>
                                      </button>
                                      {isAdExp && (
                                        <div className="border-t border-border/20 p-2 space-y-2">
                                          <p className="text-[10px] text-muted-foreground line-clamp-3">{ad.ad_copy}</p>
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-[10px] text-muted-foreground">{(ad.platforms || []).map(platformLabel).join(", ")}</span>
                                            {ad.status === "scheduled" && (
                                              <button onClick={() => handleCancelAd(ad.id)}
                                                className="text-[10px] text-destructive hover:underline">Cancel</button>
                                            )}
                                          </div>
                                          {ad.failure_reason && <p className="text-[10px] text-red-400">{ad.failure_reason}</p>}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ── Running Jobs tab ── */}
        {rightTab === "jobs" && (
          <div className="space-y-3">
            {!activeStreak && (
              <div className="rounded-xl border border-border/30 bg-background/20 p-6 text-center">
                <p className="text-xs text-muted-foreground">No active generation job. Generate ideas to see progress here.</p>
              </div>
            )}

            {activeStreak && (
              <div className="rounded-xl border border-border/50 bg-background/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-foreground">{activeStreak.site_name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{activeStreak.url}</div>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    activeStreak.status === "generating" ? "border-amber-500/40 bg-amber-500/10 text-amber-400" :
                    activeStreak.status === "ideas_ready" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" :
                    activeStreak.status === "failed" ? "border-red-500/40 bg-red-500/10 text-red-400" :
                    "border-border/40 text-muted-foreground"
                  }`}>
                    {activeStreak.status === "generating" ? "⚙️ Generating…" :
                     activeStreak.status === "ideas_ready" ? "✅ Ideas ready" :
                     activeStreak.status === "failed" ? "❌ Failed" :
                     activeStreak.status}
                  </span>
                </div>

                {/* Progress bar */}
                {activeStreak.status === "generating" && (
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-border/30 overflow-hidden">
                      <div className="h-full rounded-full bg-primary animate-pulse" style={{ width: `${Math.min(90, ((activeStreak.ads?.length || 0) / activeStreak.total_ads) * 100)}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {activeStreak.ads?.length || 0} of {activeStreak.total_ads} ideas generated…
                    </p>
                  </div>
                )}

                {activeStreak.status === "generating" && (
                  <p className="text-[10px] text-amber-400/80">
                    💡 You can navigate away — generation continues in the background. Come back to this tab to see results.
                  </p>
                )}

                {activeStreak.status === "ideas_ready" && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-emerald-400">
                      ✅ {activeStreak.ads?.length || 0} ideas generated successfully!
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Review and edit them in the left panel, then schedule.
                    </p>
                  </div>
                )}

                {activeStreak.status === "failed" && (
                  <p className="text-[10px] text-red-400">{activeStreak.generation_error || "Generation failed. Please try again."}</p>
                )}

                {/* Per-batch progress dots */}
                {activeStreak.status === "generating" && activeStreak.total_ads > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: Math.ceil(activeStreak.total_ads / 10) }, (_, i) => {
                      const done = (activeStreak.ads?.length || 0) > i * 10;
                      return (
                        <div key={i} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] ${done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border/30 text-muted-foreground/40"}`}>
                          {done ? "✓" : "○"} Batch {i + 1}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="text-[10px] text-muted-foreground">
                  Started {new Date(activeStreak.created_at).toLocaleTimeString()} ·{" "}
                  {STREAK_OPTIONS.find(o => o.value === activeStreak.streak_type)?.label || activeStreak.streak_type} streak
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  {activeStreak.status === "failed" && (
                    <button onClick={() => handleDeleteStreak(activeStreak.id)}
                      className="text-[10px] text-destructive border border-destructive/30 rounded-full px-3 py-1 hover:bg-destructive/10">
                      🗑 Delete
                    </button>
                  )}
                  {activeStreak.status === "generating" && (
                    <button onClick={() => handleDeleteStreak(activeStreak.id)}
                      className="text-[10px] text-muted-foreground border border-border/40 rounded-full px-3 py-1 hover:text-destructive hover:border-destructive/30">
                      ✕ Cancel generation
                    </button>
                  )}
                  {(activeStreak.status === "ideas_ready" || activeStreak.status === "active") && (
                    <button onClick={() => handleDeleteStreak(activeStreak.id)}
                      className="text-[10px] text-muted-foreground border border-border/40 rounded-full px-3 py-1 hover:text-destructive hover:border-destructive/30">
                      ✕ Cancel streak
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Recent jobs from allStreaks */}
            {allStreaks.filter(s => s.id !== activeStreak?.id && ["ideas_ready","failed","active"].includes(s.status)).slice(0, 5).map(s => (
              <div key={s.id} className="rounded-lg border border-border/30 bg-background/10 px-3 py-2 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-foreground truncate">{s.site_name}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(s.created_at).toLocaleDateString()} · {s.ads?.length || 0} ideas</div>
                </div>
                <span className={`text-[10px] shrink-0 ${s.status === "ideas_ready" || s.status === "active" ? "text-emerald-400" : "text-red-400"}`}>
                  {s.status === "ideas_ready" ? "✅ Ready" : s.status === "active" ? "📅 Active" : "❌ Failed"}
                </span>
                {(s.status === "ideas_ready" || s.status === "active") && (
                  <button onClick={() => { setActiveStreak(s as any); setRightTab("jobs"); }}
                    className="text-[10px] text-primary hover:underline shrink-0">Review</button>
                )}
                {s.status === "failed" && (
                  <button onClick={() => handleDeleteStreak(s.id)}
                    className="text-[10px] text-destructive hover:underline shrink-0">🗑 Delete</button>
                )}
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
  const [tab, setTab] = useState<"streak" | "quick-spark" | "rss" | "website-spark" | "events">("quick-spark");

  return (
    <AppShell eyebrow="Library" title="Agent Niva">
      <p className="mb-6 text-xs text-muted-foreground max-w-2xl">
        Your AI marketing agent — studies your site for ad ideas, keeps seasonal ads generating and scheduling themselves, and turns RSS news into ready-to-post content.
      </p>
      <div className="flex flex-wrap gap-2 mb-6">
        {([
          ["quick-spark", "💡 Quick Spark", "page:quick-spark"],
          ["rss", "📰 RSS Feeds", ""],
          ["streak", "🚀 Brand Campaign Streak", ""],
          ["website-spark", "🌐 Website Spark", "page:quick-start"],
          ["events", "📅 Recurring Events", "page:recurring-events"],
        ] as const).map(([k, l, hk]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${tab === k ? "border-primary/50 bg-primary/10 text-primary shadow-[0_0_14px_-4px_oklch(0.78_0.12_85/0.3)]" : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"}`}>
            {l} {hk && <NovaHint hintKey={hk as any} />}
          </button>
        ))}
      </div>
      {tab === "streak" ? <BrandCampaignStreakTab />
        : tab === "website-spark" ? <WebsiteSparkTab />
        : tab === "quick-spark" ? <QuickSparkTab />
        : tab === "events" ? <EventsTab />
        : <RssFeedsTab />}
    </AppShell>
  );
}
