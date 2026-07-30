import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { NovaHint } from "@/components/nova-hint";
import { RequirementChecklist } from "@/components/requirement-checklist";
import { PLATFORMS, type Platform } from "@/components/create-ad-parts";
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
  const [platforms, setPlatforms] = useState<string[]>(editing?.platforms ?? ["facebook", "instagram"]);
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

function WebsiteSparkTab() {
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
      <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-glass)]">
        <div className="text-sm font-semibold text-foreground mb-1">Study a website, get ad ideas <NovaHint hintKey="page:quick-start" /></div>
        <p className="text-xs text-muted-foreground mb-4">Give Agent Niva your URL — it reads the site and recommends concrete ad ideas you can turn into real ads with one click.</p>

        {/* Saved sites dropdown — shown only when there are saved sites */}
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
            className="mt-1.5 w-full rounded-xl border border-border bg-input/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none transition resize-none" />
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
                className="flex-1 min-w-[160px] rounded-lg border border-border bg-input/60 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
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
        <div className="flex items-center justify-between mb-4">
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
              <div key={r.id} className="group flex flex-col rounded-2xl border border-border bg-card shadow-[var(--shadow-glass)] overflow-hidden transition hover:border-primary/40 hover:shadow-[var(--shadow-glass-hover)]">
                {/* Card accent bar */}
                <div className="h-1 w-full bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />
                <div className="flex flex-col flex-1 p-4">
                  {/* Title */}
                  <div className="text-sm font-bold text-foreground leading-snug">{r.title}</div>
                  {/* Description */}
                  <div className="mt-2 text-xs text-muted-foreground leading-relaxed flex-1">{r.description}</div>
                  {/* Audience */}
                  {r.audience && (
                    <div className="mt-3 flex items-start gap-1.5">
                      <span className="mt-px shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Audience</span>
                      <span className="text-xs text-foreground/80 leading-snug">{r.audience}</span>
                    </div>
                  )}
                  {/* Platform tags + source */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {r.platforms.length > 0 ? r.platforms.map((p) => {
                      const meta = PLATFORMS.find((pl) => pl.id === p);
                      return (
                        <span key={p} className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <span className="h-3 w-3 rounded-full inline-flex items-center justify-center text-[7px]" style={{ background: meta?.color ?? "#6366f1", color: "#0f172a" }}>{meta?.tag ?? "📄"}</span>
                          {meta?.name ?? p}
                        </span>
                      );
                    }) : (
                      <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">All platforms</span>
                    )}
                  </div>
                  {r.source_url && (
                    <div className="mt-1.5 text-[10px] text-muted-foreground/50 truncate">🔗 {r.source_url}</div>
                  )}
                  {/* Actions */}
                  <div className="mt-4 flex items-center gap-2">
                    <button onClick={() => createFrom(r)}
                      className="flex-1 rounded-full bg-gold-gradient px-3.5 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] hover:opacity-90 transition">
                      Create this ad →
                    </button>
                    <button onClick={() => dismiss(r.id)} disabled={busyId === r.id}
                      className="rounded-full border border-border px-3.5 py-2 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50 transition">
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
            {generating ? "Generating drafts…" : "Spark drafts →"}
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

// ── Root Component ─────────────────────────────────────────────────────

function AgentNiva() {
  const [tab, setTab] = useState<"website-spark" | "quick-spark" | "events">("website-spark");
  return (
    <AppShell eyebrow="Library" title="Agent Niva">
      <p className="mb-6 text-xs text-muted-foreground max-w-2xl">
        Your AI marketing agent — studies your site for ad ideas, and keeps seasonal ads generating and scheduling themselves throughout the year.
      </p>
      <div className="flex gap-2 mb-6">
        {([ ["website-spark", "🌐 Website Spark", "page:quick-start"], ["quick-spark", "💡 Quick Spark", "page:quick-spark"], ["events", "📅 Recurring Events", "page:recurring-events"] ] as const).map(([k, l, hk]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${tab === k ? "border-primary/50 bg-primary/10 text-primary shadow-[0_0_14px_-4px_oklch(0.78_0.12_85/0.3)]" : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"}`}>
            {l} <NovaHint hintKey={hk} />
          </button>
        ))}
      </div>
      {tab === "website-spark" ? <WebsiteSparkTab /> : tab === "quick-spark" ? <QuickSparkTab /> : <EventsTab />}
    </AppShell>
  );
}
