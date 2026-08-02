import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi, type DeveloperModel, type DeveloperModelsOut, type OpenRouterCatalogModel } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/models")({
  component: DeveloperModels,
  head: () => ({ meta: [{ title: "Models — NivaSpark Developer" }] }),
});


// Mirrors backend pricing.py _round_to_quarter + _usd_to_credits
function calcCredits(costUsd: number, markup: number, creditValueUsd: number): number {
  if (!costUsd || !markup || !creditValueUsd) return 0;
  const charged = costUsd * markup;
  const raw = charged / creditValueUsd;
  const quarters = Math.ceil(raw * 4 - 1e-9);
  return Math.max(1, quarters) / 4;
}

function fmtCredits(n: number): string {
  // e.g. 1.0 → "1", 1.75 → "1.75"
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

const COMMON_RESOLUTIONS = ["480p", "720p", "1080p"];
const COMMON_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:5", "1.91:1", "4:3", "3:4"];

function AspectRatioPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState("");
  function addCustom() {
    const r = custom.trim();
    if (r && !value.includes(r)) onChange([...value, r]);
    setCustom("");
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Aspect ratios:</span>
        {COMMON_ASPECT_RATIOS.map((r) => (
          <button key={r} onClick={() => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${value.includes(r) ? "border-ring bg-foreground text-background" : "border-border text-muted-foreground"}`}>
            {value.includes(r) ? "☑" : "☐"} {r}
          </button>
        ))}
      </div>
      {/* Custom ratio entry */}
      <div className="flex items-center gap-1.5">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()}
          placeholder="Custom e.g. 2:1" className="w-28 rounded-lg border border-border bg-input/40 px-2 py-0.5 text-[11px] text-foreground focus:border-ring focus:outline-none" />
        <button onClick={addCustom} disabled={!custom.trim()} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">Add</button>
        {value.filter((r) => !COMMON_ASPECT_RATIOS.includes(r)).map((r) => (
          <span key={r} className="flex items-center gap-1 rounded-full border border-ring bg-foreground px-2 py-0.5 text-[10px] text-background">
            {r} <button onClick={() => onChange(value.filter((x) => x !== r))} className="opacity-60 hover:opacity-100">✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The "Fetch from OpenRouter" popup — browse the REAL live catalog and
 * click a model to pre-fill the Add form, instead of hand-typing a slug
 * (which is exactly how two wrong-slug bugs happened before). */
function CatalogPickerModal({ kind, onPick, onClose }: {
  kind: "text" | "image" | "video";
  onPick: (m: OpenRouterCatalogModel) => void;
  onClose: () => void;
}) {
  const handleAuthError = useDevAuthErrorHandler();
  const [catalog, setCatalog] = useState<OpenRouterCatalogModel[] | null>(null);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    devApi(`/developer/openrouter-catalog?kind=${kind}`)
      .then(setCatalog)
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not fetch OpenRouter's catalog"); });
  }, [kind]);

  const filtered = (catalog || []).filter((m) =>
    !search.trim() || m.name.toLowerCase().includes(search.toLowerCase()) || m.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col rounded-2xl border border-border bg-card/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-foreground">OpenRouter's live {kind} model catalog</div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="border-b border-border p-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or identifier…" autoFocus
            className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-xs text-foreground focus:border-ring focus:outline-none" />
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {err && <div className="text-xs text-destructive">{err}</div>}
          {!catalog && !err && <div className="text-xs text-muted-foreground">Fetching the live catalog from OpenRouter…</div>}
          {catalog && filtered.length === 0 && <div className="text-xs text-muted-foreground">{catalog.length === 0 ? `OpenRouter's catalog listed no ${kind}-output models — you can still add one manually.` : "No matches for that search."}</div>}
          {filtered.map((m) => (
            <button key={m.slug} onClick={() => onPick(m)}
              className="w-full rounded-lg border border-border bg-background/40 p-3 text-left hover:border-ring">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground">{m.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{m.slug}</div>
                  {m.description && <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground/80">{m.description}</div>}
                </div>
                <div className="shrink-0 text-right text-[10px] text-muted-foreground">
                  {m.price_per_second_usd != null && <div>${m.price_per_second_usd.toFixed(3)}/sec</div>}
                  {m.price_per_image_usd != null && <div>${m.price_per_image_usd.toFixed(3)}/image</div>}
                  {m.max_duration != null && <div>up to {m.max_duration}s</div>}
                  {m.resolutions && <div>{m.resolutions.join(" · ")}</div>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResolutionPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Resolutions offered:</span>
      {COMMON_RESOLUTIONS.map((r) => (
        <button key={r} onClick={() => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])}
          className={`rounded-full border px-2 py-0.5 text-[10px] ${value.includes(r) ? "border-ring bg-foreground text-background" : "border-border text-muted-foreground"}`}>
          {value.includes(r) ? "☑" : "☐"} {r}
        </button>
      ))}
    </div>
  );
}

function ModelRow({ kind, entry, onSave, onDelete, canDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown, markup, creditValueUsd }: {
  kind: "text" | "image" | "video"; entry: DeveloperModel;
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canDelete: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  markup: number;
  creditValueUsd: number;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(entry.label);
  const [model, setModel] = useState(entry.model);
  const [credits, setCredits] = useState(String(entry.credits ?? 0.25));
  const [minD, setMinD] = useState(String(entry.min_duration ?? ""));
  const [maxD, setMaxD] = useState(String(entry.max_duration ?? ""));
  const [durationOptions, setDurationOptions] = useState(entry.duration_options?.join(", ") ?? "");
  const [resolutions, setResolutions] = useState<string[]>(entry.resolutions || []);
  const [aspectRatios, setAspectRatios] = useState<string[]>(entry.aspect_ratios || []);
  const [supportsAudio, setSupportsAudio] = useState(entry.supports_audio ?? false);
  const [supportsLastFrame, setSupportsLastFrame] = useState(entry.supports_last_frame ?? false);
  // cost_usd: the raw OpenRouter cost per image/text generation.
  // When set, credits are auto-calculated from cost × markup ÷ creditValueUsd.
  const existingCostUsd = entry.pricing && typeof entry.pricing === "object" && "cost_usd" in entry.pricing
    ? String((entry.pricing as Record<string, unknown>).cost_usd ?? "")
    : "";
  const [costUsd, setCostUsd] = useState(existingCostUsd);
  // Video still uses raw JSON for the rates table
  const [pricingJson, setPricingJson] = useState(entry.pricing ? JSON.stringify(entry.pricing, null, 2) : "");
  const [pricingError, setPricingError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    setPricingError("");
    let pricing: unknown = null;
    if (kind === "video") {
      if (pricingJson.trim()) {
        try {
          pricing = JSON.parse(pricingJson);
        } catch {
          setPricingError("That's not valid JSON — check for a missing comma or bracket.");
          return;
        }
      }
    } else {
      // text/image: build pricing block from the cost_usd field
      const cost = parseFloat(costUsd);
      if (!isNaN(cost) && cost > 0) {
        pricing = { cost_usd: cost };
      }
    }
    // Auto-calculate credits from cost when cost is set
    let finalCredits = Math.max(0.25, Number(credits) || 0.25);
    if (kind !== "video" && pricing && (pricing as any).cost_usd) {
      finalCredits = calcCredits((pricing as any).cost_usd, markup, creditValueUsd);
    }
    const parsedDurationOptions = durationOptions.trim()
      ? durationOptions.split(",").map((s) => Number(s.trim())).filter((n) => n > 0)
      : null;
    setSaving(true);
    await onSave(entry.id, {
      label: label.trim(), model: model.trim(), credits: finalCredits,
      min_duration: kind === "video" ? (Number(minD) || null) : null,
      max_duration: kind === "video" ? (Number(maxD) || null) : null,
      duration_options: kind === "video" ? parsedDurationOptions : null,
      resolutions: kind === "video" && resolutions.length > 0 ? resolutions : null,
      supports_audio: kind === "video" ? supportsAudio : null,
      supports_last_frame: kind === "video" ? supportsLastFrame : null,
      aspect_ratios: (kind === "image" || kind === "video") && aspectRatios.length > 0 ? aspectRatios : null,
      pricing,
    });
    setSaving(false);
    setEditing(false);
  }

  async function remove() {
    if (!confirm(`Remove "${entry.label}"? Any ad already generated with it keeps working (it stored what it needed at creation time) — this just removes it from future choices.`)) return;
    setDeleting(true);
    await onDelete(entry.id);
    setDeleting(false);
  }

  const [togglingEnabled, setTogglingEnabled] = useState(false);
  async function toggleEnabled() {
    setTogglingEnabled(true);
    await onSave(entry.id, { enabled: !(entry.enabled ?? true) });
    setTogglingEnabled(false);
  }

  return (
    <div className={`rounded-lg border border-border bg-background/40 p-3 ${entry.enabled === false ? "opacity-50" : ""}`}>
      {editing ? (
        <div className="space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label shown to companies" className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model identifier" className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <div className="flex items-center gap-2">
            <input type="number" min={0.25} max={50} step={0.25} value={credits} onChange={(e) => setCredits(e.target.value)} className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
            <span className="text-[11px] text-muted-foreground">credits</span>
          </div>
          {kind === "video" && (
            <>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={60} value={minD} onChange={(e) => setMinD(e.target.value)} placeholder="min" className="w-16 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">to</span>
                <input type="number" min={1} max={60} value={maxD} onChange={(e) => setMaxD(e.target.value)} placeholder="max" className="w-16 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">seconds total (ignored if exact durations are set below)</span>
              </div>
              <input value={durationOptions} onChange={(e) => setDurationOptions(e.target.value)} placeholder="Exact durations only, e.g. 4, 6, 8 (leave blank for a normal range)" className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
              <ResolutionPicker value={resolutions} onChange={setResolutions} />
              <AspectRatioPicker value={aspectRatios} onChange={setAspectRatios} />
              <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                <input type="checkbox" checked={supportsAudio} onChange={(e) => setSupportsAudio(e.target.checked)} />
                Supports an audio on/off choice (shows a real toggle in Create Ad — independent of whether dynamic pricing is set up)
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                <input type="checkbox" checked={supportsLastFrame} onChange={(e) => setSupportsLastFrame(e.target.checked)} />
                Supports a separate start + end frame (enables "first + last frame" mode in Create Ad)
              </label>
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground mb-1">Dynamic pricing (optional — leave blank to keep the flat credits above)</div>
                <textarea
                  value={pricingJson}
                  onChange={(e) => setPricingJson(e.target.value)}
                  rows={6}
                  placeholder={kind === "video"
                    ? '{\n  "rates_usd_per_second": {\n    "720p": {"audio": 0.10, "no_audio": 0.08},\n    "1080p": {"audio": 0.12, "no_audio": 0.10}\n  },\n  "supports_audio": true\n}'
                    : '{"cost_usd": 0.03}'}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-ring focus:outline-none"
                />
                {pricingError && <div className="mt-1 text-[11px] text-destructive">{pricingError}</div>}
                <p className="mt-1 text-[10px] text-muted-foreground">When set, the real cost is computed live per generation (resolution × audio × duration for video) and marked up by the global multiplier — see the Pricing section below. Leave blank and this model just uses the flat credits number above, unchanged.</p>
              </div>
            </>
          )}
          {(kind === "image" || kind === "text") && (
            <div className="space-y-2">
              {kind === "image" && <AspectRatioPicker value={aspectRatios} onChange={setAspectRatios} />}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground mb-1">OpenRouter cost per generation (USD)</div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">$</span>
                  <input
                    type="number" min={0} step={0.001} value={costUsd}
                    onChange={(e) => {
                      setCostUsd(e.target.value);
                      const cost = parseFloat(e.target.value);
                      if (!isNaN(cost) && cost > 0 && markup && creditValueUsd) {
                        setCredits(fmtCredits(calcCredits(cost, markup, creditValueUsd)));
                      }
                    }}
                    placeholder="e.g. 0.039"
                    className="w-28 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
                  />
                  {costUsd && !isNaN(parseFloat(costUsd)) && parseFloat(costUsd) > 0 && markup && creditValueUsd && (
                    <span className="text-[11px] text-emerald-400">
                      → {fmtCredits(calcCredits(parseFloat(costUsd), markup, creditValueUsd))} credits
                      <span className="ml-1 text-muted-foreground">(${(parseFloat(costUsd) * markup).toFixed(3)} charged)</span>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Credits are auto-calculated: cost × {markup}× markup ÷ ${creditValueUsd}/credit, rounded up to nearest 0.25.
                  The credits field above updates automatically — you can still override it manually.
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button disabled={saving || !label.trim() || !model.trim()} onClick={save} className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => setEditing(false)} className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">
              {entry.label}
              {entry.enabled === false && <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 text-[9px] font-normal text-muted-foreground">DISABLED</span>}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{entry.model}</div>
            <div className="mt-0.5 text-xs font-semibold text-foreground">
              {entry.credits} credits
              {kind === "video" && entry.min_duration != null && entry.max_duration != null && <span className="ml-2 font-normal text-muted-foreground">· {entry.min_duration}-{entry.max_duration}s</span>}
              {kind === "video" && entry.resolutions && entry.resolutions.length > 0 && <span className="ml-2 font-normal text-muted-foreground">· {entry.resolutions.join("/")}</span>}
              {kind === "video" && entry.price_per_second_usd != null && <span className="ml-2 font-normal text-amber-400/80">· ${entry.price_per_second_usd.toFixed(3)}/sec provider cost</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button disabled={togglingEnabled} onClick={toggleEnabled} title={entry.enabled === false ? "Enable — show this in Create Ad again" : "Disable — hide from Create Ad without deleting"}
              className={`text-[11px] disabled:opacity-50 ${entry.enabled === false ? "text-emerald-400 hover:text-emerald-300" : "text-muted-foreground hover:text-foreground"}`}>
              {togglingEnabled ? "…" : entry.enabled === false ? "Enable" : "Disable"}
            </button>
            <div className="flex flex-col">
              <button disabled={!canMoveUp} onClick={onMoveUp} title="Move up" className="text-[10px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-20">▲</button>
              <button disabled={!canMoveDown} onClick={onMoveDown} title="Move down" className="text-[10px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-20">▼</button>
            </div>
            <button onClick={() => setEditing(true)} className="text-[11px] text-muted-foreground hover:text-foreground">Edit</button>
            <button disabled={!canDelete || deleting} onClick={remove} title={!canDelete ? "Can't remove the last option for this kind" : undefined} className="text-[11px] text-destructive hover:text-destructive/80 disabled:opacity-30">
              {deleting ? "…" : "Remove"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddModelForm({ kind, onAdd, markup, creditValueUsd }: { kind: "text" | "image" | "video"; onAdd: (body: Record<string, unknown>) => Promise<void>; markup: number; creditValueUsd: number }) {
  const [open, setOpen] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [label, setLabel] = useState("");
  const [model, setModel] = useState("");
  const [credits, setCredits] = useState("0.25");
  const [minD, setMinD] = useState("4");
  const [maxD, setMaxD] = useState("15");
  const [durationOptions, setDurationOptions] = useState("");
  const [resolutions, setResolutions] = useState<string[]>(["720p"]);
  const [aspectRatios, setAspectRatios] = useState<string[]>([]);
  const [supportsAudio, setSupportsAudio] = useState(false);
  const [supportsLastFrame, setSupportsLastFrame] = useState(false);
  const [pricePerSec, setPricePerSec] = useState<number | null>(null);
  const [costUsd, setCostUsd] = useState("");
  const [saving, setSaving] = useState(false);

  function pickFromCatalog(m: OpenRouterCatalogModel) {
    // Pre-fill everything the catalog actually exposed; the developer
    // fills in / adjusts the rest before adding.
    setModel(m.slug);
    setLabel(m.name.slice(0, 60));
    if (m.max_duration) setMaxD(String(Math.min(m.max_duration, 60)));
    if (m.resolutions && m.resolutions.length > 0) setResolutions(m.resolutions);
    setPricePerSec(m.price_per_second_usd ?? null);
    setShowCatalog(false);
    setOpen(true);
  }

  async function add() {
    const parsedDurationOptions = durationOptions.trim()
      ? durationOptions.split(",").map((s) => Number(s.trim())).filter((n) => n > 0)
      : null;
    // Build pricing block and auto-calculate credits for text/image
    let addPricing: Record<string, unknown> | null = null;
    let finalCredits = Math.max(0.25, Number(credits) || 0.25);
    if (kind !== "video") {
      const cost = parseFloat(costUsd);
      if (!isNaN(cost) && cost > 0) {
        addPricing = { cost_usd: cost };
        finalCredits = calcCredits(cost, markup, creditValueUsd);
      }
    }
    setSaving(true);
    await onAdd({
      kind, label: label.trim(), model: model.trim(), credits: finalCredits,
      min_duration: kind === "video" ? Number(minD) || 4 : null,
      max_duration: kind === "video" ? Number(maxD) || 15 : null,
      duration_options: kind === "video" ? parsedDurationOptions : null,
      resolutions: kind === "video" && resolutions.length > 0 ? resolutions : null,
      supports_audio: kind === "video" ? supportsAudio : null,
      supports_last_frame: kind === "video" ? supportsLastFrame : null,
      price_per_second_usd: kind === "video" ? pricePerSec : null,
      aspect_ratios: (kind === "image" || kind === "video") && aspectRatios.length > 0 ? aspectRatios : null,
      pricing: addPricing,
    });
    setSaving(false);
    setLabel(""); setModel(""); setCredits("0.25"); setCostUsd(""); setMinD("4"); setMaxD("15"); setDurationOptions(""); setResolutions(["720p"]); setAspectRatios([]); setSupportsAudio(false); setSupportsLastFrame(false); setPricePerSec(null);
    setOpen(false);
  }

  return (
    <>
      {showCatalog && <CatalogPickerModal kind={kind as "image" | "video"} onPick={pickFromCatalog} onClose={() => setShowCatalog(false)} />}
      {!open ? (
        <div className="flex gap-2">
          {kind !== "text" && (
            <button onClick={() => setShowCatalog(true)} className="flex-1 rounded-lg border border-dashed border-ring py-2.5 text-xs font-semibold text-muted-foreground hover:border-ring hover:text-foreground">
              ＋ Fetch from OpenRouter
            </button>
          )}
          <button onClick={() => setOpen(true)} className={`rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground hover:border-ring hover:text-foreground ${kind === "text" ? "flex-1" : ""}`}>
            {kind === "text" ? "＋ Add manually" : "Add manually"}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
          {pricePerSec != null && <div className="text-[11px] text-amber-400/80">Provider cost: ${pricePerSec.toFixed(3)}/second — use this to set a sensible credit price below.</div>}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label shown to companies" className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model identifier" className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <div className="flex items-center gap-2">
            <input type="number" min={0.25} max={50} step={0.25} value={credits} onChange={(e) => setCredits(e.target.value)} className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
            <span className="text-[11px] text-muted-foreground">credits (auto-filled from OR cost below, or set manually)</span>
          </div>
          {(kind === "image" || kind === "text") && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">OpenRouter cost per generation (USD)</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">$</span>
                <input
                  type="number" min={0} step={0.001} value={costUsd}
                  onChange={(e) => {
                    setCostUsd(e.target.value);
                    const cost = parseFloat(e.target.value);
                    if (!isNaN(cost) && cost > 0 && markup && creditValueUsd) {
                      setCredits(fmtCredits(calcCredits(cost, markup, creditValueUsd)));
                    }
                  }}
                  placeholder="e.g. 0.039"
                  className="w-28 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
                />
                {costUsd && !isNaN(parseFloat(costUsd)) && parseFloat(costUsd) > 0 && (
                  <span className="text-[11px] text-emerald-400">
                    → {fmtCredits(calcCredits(parseFloat(costUsd), markup, creditValueUsd))} credits
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Enter the OpenRouter per-image/text cost — credits auto-calculate at {markup}× markup, ${creditValueUsd}/credit.
              </p>
            </div>
          )}
          {kind === "video" && (
            <>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={60} value={minD} onChange={(e) => setMinD(e.target.value)} className="w-16 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">to</span>
                <input type="number" min={1} max={60} value={maxD} onChange={(e) => setMaxD(e.target.value)} className="w-16 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">seconds total (ignored if exact durations are set below)</span>
              </div>
              <input value={durationOptions} onChange={(e) => setDurationOptions(e.target.value)} placeholder="Exact durations only, e.g. 4, 6, 8 (leave blank for a normal range)" className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
              <ResolutionPicker value={resolutions} onChange={setResolutions} />
              <AspectRatioPicker value={aspectRatios} onChange={setAspectRatios} />
              <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                <input type="checkbox" checked={supportsAudio} onChange={(e) => setSupportsAudio(e.target.checked)} />
                Supports an audio on/off choice
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                <input type="checkbox" checked={supportsLastFrame} onChange={(e) => setSupportsLastFrame(e.target.checked)} />
                Supports a separate start + end frame
              </label>
            </>
          )}
          {kind === "image" && (
            <AspectRatioPicker value={aspectRatios} onChange={setAspectRatios} />
          )}
          <div className="flex items-center gap-2">
            <button disabled={saving || !label.trim() || !model.trim()} onClick={add} className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
            <button onClick={() => setOpen(false)} className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

function RawJsonEditor({ onSaved }: { onSaved: () => void }) {
  const handleAuthError = useDevAuthErrorHandler();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadRaw() {
    setErr("");
    try {
      const r = await devApi("/developer/models/raw");
      setText(JSON.stringify(r.models, null, 2));
      setLoaded(true);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load");
    }
  }

  async function saveRaw() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setErr("That's not valid JSON — check for a missing comma or bracket before saving.");
      return;
    }
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/models/raw", { method: "PUT", body: { models: parsed } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved(); // refreshes the form-based view above so both stay in sync
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save — check the error for which entry needs fixing");
    }
    setSaving(false);
  }

  return (
    <div className="mb-6 max-w-4xl rounded-xl border border-border bg-card/60 p-4">
      <button onClick={() => { setOpen(!open); if (!open && !loaded) loadRaw(); }} className="flex w-full items-center justify-between text-left">
        <div>
          <div className="text-sm font-semibold text-foreground">🗂️ Bulk edit as JSON</div>
          <p className="mt-1 text-[11px] text-muted-foreground">Edit and save the entire text/image/video model list in one shot — the whole structure saves atomically, so there's nothing to partially drop like a single field can in the form above.</p>
        </div>
        <span className="text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-4">
          {!loaded ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={24}
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground focus:border-ring focus:outline-none"
              />
              <div className="mt-3 flex items-center gap-3">
                <button onClick={saveRaw} disabled={saving} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
                  {saving ? "Saving…" : "Save all"}
                </button>
                <button onClick={loadRaw} className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                  Reload (discard changes)
                </button>
                {saved && <span className="text-xs text-emerald-400">✓ Saved — every model updated atomically</span>}
              </div>
              {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DeveloperModels() {
  const allowed = useRequireDeveloperPermission("models");
  const handleAuthError = useDevAuthErrorHandler();

  const [models, setModels] = useState<DeveloperModelsOut | null>(null);
  const [markup, setMarkup] = useState<number>(2.5);
  const [creditValueUsd, setCreditValueUsd] = useState<number>(0.10);
  const [err, setErr] = useState("");
  const [promptReviewModelId, setPromptReviewModelId] = useState<string>("");
  const [videoPrepImageModelId, setVideoPrepImageModelId] = useState<string>("");
  const [savingVideoPrep, setSavingVideoPrep] = useState(false);
  const [videoPrepSaved, setVideoPrepSaved] = useState(false);

  async function load() {
    try {
      setModels(await devApi("/developer/models"));
      // Fetch pricing config so the credit calculator in model forms uses
      // the live markup and credit_value_usd rather than hardcoded defaults.
      try {
        const pc = await devApi("/developer/platform-config");
        if (pc.markup_multiplier) setMarkup(Number(pc.markup_multiplier));
        if (pc.credit_value_usd) setCreditValueUsd(Number(pc.credit_value_usd));
      } catch { /* non-fatal — forms fall back to 2.5× / $0.10 */ }
      const vp = await devApi("/developer/video-prep");
      setPromptReviewModelId(vp.prompt_review_model_id || "");
      setVideoPrepImageModelId(vp.image_model_id || "");
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load models");
    }
  }
  useEffect(() => { if (allowed) load(); }, [allowed]);

  async function saveVideoPrep(promptReviewId: string, imageId: string) {
    setSavingVideoPrep(true); setVideoPrepSaved(false);
    try {
      await devApi("/developer/video-prep", { method: "PUT", body: { prompt_review_model_id: promptReviewId || null, image_model_id: imageId || null } });
      setVideoPrepSaved(true);
      setTimeout(() => setVideoPrepSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSavingVideoPrep(false);
  }

  async function handleAdd(body: Record<string, unknown>) {
    setErr("");
    try {
      setModels(await devApi("/developer/models", { method: "POST", body }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add model");
    }
  }

  async function handleSave(id: string, body: Record<string, unknown>) {
    setErr("");
    try {
      setModels(await devApi(`/developer/models/${id}`, { method: "PUT", body }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
  }

  async function handleDelete(id: string) {
    setErr("");
    try {
      setModels(await devApi(`/developer/models/${id}`, { method: "DELETE" }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not remove");
    }
  }

  async function handleReorder(kind: "text" | "image" | "video", fromIdx: number, toIdx: number) {
    if (!models || toIdx < 0 || toIdx >= models[kind].length) return;
    const reordered = [...models[kind]];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setModels({ ...models, [kind]: reordered }); // optimistic — snappy reordering, corrected below if the save fails
    setErr("");
    try {
      const updated = await devApi("/developer/models/reorder", { method: "PUT", body: { kind, ordered_ids: reordered.map((m) => m.id) } });
      setModels(updated);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save the new order");
      load(); // revert to the real server order on failure
    }
  }

  const [tab, setTab] = useState<"text" | "image" | "video" | "config">("text");
  if (!allowed) return null;

  const MODEL_TABS = [
    { key: "text",   label: "✍️ Text models" },
    { key: "image",  label: "🖼 Image models" },
    { key: "video",  label: "🎬 Video models" },
    { key: "config", label: "⚙️ Config" },
  ] as const;

  function ModelKindTab({ kind }: { kind: "text" | "image" | "video" }) {
    if (!models) return <div className="text-sm text-muted-foreground">Loading…</div>;
    return (
      <div className="space-y-4">
        {kind === "video" && (
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <div className="text-sm font-semibold text-foreground mb-1">🎬 Video prep pipeline</div>
            <p className="text-xs text-muted-foreground mb-3">These run automatically in the background on your OpenRouter balance — never charged to companies.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold text-foreground mb-1">Text prompt review <span className="font-normal text-muted-foreground">— refines shot wording before generation</span></div>
                <select value={promptReviewModelId} onChange={(e) => { setPromptReviewModelId(e.target.value); saveVideoPrep(e.target.value, videoPrepImageModelId); }}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
                  <option value="">Off — use customer wording as-is</option>
                  {models?.text.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-foreground mb-1">Image for video <span className="font-normal text-muted-foreground">— pre-renders first frame to match shot 1's scene</span></div>
                <select value={videoPrepImageModelId} onChange={(e) => { setVideoPrepImageModelId(e.target.value); saveVideoPrep(promptReviewModelId, e.target.value); }}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
                  <option value="">Off — use reference photo as starting frame</option>
                  {models?.image.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>
            {(savingVideoPrep || videoPrepSaved) && (
              <p className="mt-2 text-[10px] text-muted-foreground">{savingVideoPrep ? "Saving…" : <span className="text-emerald-400">✓ Saved</span>}</p>
            )}
          </div>
        )}
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="text-sm font-semibold capitalize text-foreground mb-3">{kind} models</div>
          <div className="space-y-2">
            {models[kind].map((entry, i) => (
              <ModelRow
                key={entry.id} kind={kind} entry={entry} onSave={handleSave} onDelete={handleDelete} canDelete={models[kind].length > 1}
                onMoveUp={() => handleReorder(kind, i, i - 1)}
                onMoveDown={() => handleReorder(kind, i, i + 1)}
                canMoveUp={i > 0}
                canMoveDown={i < models[kind].length - 1}
                markup={markup}
                creditValueUsd={creditValueUsd}
              />
            ))}
            <AddModelForm kind={kind} onAdd={handleAdd} markup={markup} creditValueUsd={creditValueUsd} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <DeveloperShell title="Models">
      {/* Tab strip */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {MODEL_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${tab === t.key
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
            {t.label}
            {t.key !== "config" && models && (
              <span className="ml-1.5 rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">
                {models[t.key as "text"|"image"|"video"].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}

      {tab === "text"  && <ModelKindTab kind="text" />}
      {tab === "image" && <ModelKindTab kind="image" />}
      {tab === "video" && <ModelKindTab kind="video" />}
      {tab === "config" && (
        <div className="space-y-6 max-w-xl">
          <div className="rounded-xl border border-border bg-card/60 p-5">
            <div className="text-sm font-semibold text-foreground mb-2">🛠 Raw JSON editor</div>
            <p className="text-xs text-muted-foreground mb-3">Edit the full model config as JSON. Use with care — invalid JSON will be rejected.</p>
            <RawJsonEditor onSaved={load} />
          </div>
        </div>
      )}
    </DeveloperShell>
  );
}
