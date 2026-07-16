import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi, type DeveloperModel, type DeveloperModelsOut, type OpenRouterCatalogModel } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/models")({
  component: DeveloperModels,
  head: () => ({ meta: [{ title: "Models — NivaAd Developer" }] }),
});

const COMMON_RESOLUTIONS = ["480p", "720p", "1080p"];

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
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col rounded-2xl border border-slate-700 bg-card/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
          <div className="text-sm font-semibold text-foreground">OpenRouter's live {kind} model catalog</div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="border-b border-slate-700/50 p-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or identifier…" autoFocus
            className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-3 py-2 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {err && <div className="text-xs text-destructive">{err}</div>}
          {!catalog && !err && <div className="text-xs text-muted-foreground">Fetching the live catalog from OpenRouter…</div>}
          {catalog && filtered.length === 0 && <div className="text-xs text-muted-foreground">{catalog.length === 0 ? `OpenRouter's catalog listed no ${kind}-output models — you can still add one manually.` : "No matches for that search."}</div>}
          {filtered.map((m) => (
            <button key={m.slug} onClick={() => onPick(m)}
              className="w-full rounded-lg border border-slate-700/50 bg-background/40 p-3 text-left hover:border-slate-500">
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
          className={`rounded-full border px-2 py-0.5 text-[10px] ${value.includes(r) ? "border-slate-400 bg-slate-700 text-slate-100" : "border-slate-700/50 text-muted-foreground"}`}>
          {value.includes(r) ? "☑" : "☐"} {r}
        </button>
      ))}
    </div>
  );
}

function ModelRow({ kind, entry, onSave, onDelete, canDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }: {
  kind: "text" | "image" | "video"; entry: DeveloperModel;
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canDelete: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(entry.label);
  const [model, setModel] = useState(entry.model);
  const [credits, setCredits] = useState(String(entry.credits));
  const [minD, setMinD] = useState(String(entry.min_duration ?? ""));
  const [maxD, setMaxD] = useState(String(entry.max_duration ?? ""));
  const [durationOptions, setDurationOptions] = useState(entry.duration_options?.join(", ") ?? "");
  const [resolutions, setResolutions] = useState<string[]>(entry.resolutions || []);
  const [supportsAudio, setSupportsAudio] = useState(entry.supports_audio ?? false);
  const [supportsLastFrame, setSupportsLastFrame] = useState(entry.supports_last_frame ?? false);
  const [pricingJson, setPricingJson] = useState(entry.pricing ? JSON.stringify(entry.pricing, null, 2) : "");
  const [pricingError, setPricingError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    setPricingError("");
    let pricing: unknown = null;
    if (pricingJson.trim()) {
      try {
        pricing = JSON.parse(pricingJson);
      } catch {
        setPricingError("That's not valid JSON — check for a missing comma or bracket.");
        return;
      }
    }
    const parsedDurationOptions = durationOptions.trim()
      ? durationOptions.split(",").map((s) => Number(s.trim())).filter((n) => n > 0)
      : null;
    setSaving(true);
    await onSave(entry.id, {
      label: label.trim(), model: model.trim(), credits: Number(credits) || 1,
      min_duration: kind === "video" ? (Number(minD) || null) : null,
      max_duration: kind === "video" ? (Number(maxD) || null) : null,
      duration_options: kind === "video" ? parsedDurationOptions : null,
      resolutions: kind === "video" && resolutions.length > 0 ? resolutions : null,
      supports_audio: kind === "video" ? supportsAudio : null,
      supports_last_frame: kind === "video" ? supportsLastFrame : null,
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
    <div className={`rounded-lg border border-slate-700/50 bg-background/40 p-3 ${entry.enabled === false ? "opacity-50" : ""}`}>
      {editing ? (
        <div className="space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label shown to companies" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model identifier" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={50} value={credits} onChange={(e) => setCredits(e.target.value)} className="w-20 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
            <span className="text-[11px] text-muted-foreground">credits</span>
          </div>
          {kind === "video" && (
            <>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={60} value={minD} onChange={(e) => setMinD(e.target.value)} placeholder="min" className="w-16 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">to</span>
                <input type="number" min={1} max={60} value={maxD} onChange={(e) => setMaxD(e.target.value)} placeholder="max" className="w-16 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">seconds total (ignored if exact durations are set below)</span>
              </div>
              <input value={durationOptions} onChange={(e) => setDurationOptions(e.target.value)} placeholder="Exact durations only, e.g. 4, 6, 8 (leave blank for a normal range)" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
              <ResolutionPicker value={resolutions} onChange={setResolutions} />
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
                  className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-slate-500 focus:outline-none"
                />
                {pricingError && <div className="mt-1 text-[11px] text-destructive">{pricingError}</div>}
                <p className="mt-1 text-[10px] text-muted-foreground">When set, the real cost is computed live per generation (resolution × audio × duration for video) and marked up by the global multiplier — see the Pricing section below. Leave blank and this model just uses the flat credits number above, unchanged.</p>
              </div>
            </>
          )}
          {(kind === "image" || kind === "text") && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Dynamic pricing (optional — leave blank to keep the flat credits above)</div>
              <textarea
                value={pricingJson}
                onChange={(e) => setPricingJson(e.target.value)}
                rows={2}
                placeholder='{"cost_usd": 0.001}'
                className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-slate-500 focus:outline-none"
              />
              {pricingError && <div className="mt-1 text-[11px] text-destructive">{pricingError}</div>}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button disabled={saving || !label.trim() || !model.trim()} onClick={save} className="rounded-full bg-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => setEditing(false)} className="rounded-full border border-slate-700/50 px-3 py-1 text-[11px] text-muted-foreground">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">
              {entry.label}
              {entry.enabled === false && <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[9px] font-normal text-slate-300">DISABLED</span>}
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
              className={`text-[11px] disabled:opacity-50 ${entry.enabled === false ? "text-emerald-400 hover:text-emerald-300" : "text-slate-400 hover:text-foreground"}`}>
              {togglingEnabled ? "…" : entry.enabled === false ? "Enable" : "Disable"}
            </button>
            <div className="flex flex-col">
              <button disabled={!canMoveUp} onClick={onMoveUp} title="Move up" className="text-[10px] leading-none text-slate-400 hover:text-foreground disabled:opacity-20">▲</button>
              <button disabled={!canMoveDown} onClick={onMoveDown} title="Move down" className="text-[10px] leading-none text-slate-400 hover:text-foreground disabled:opacity-20">▼</button>
            </div>
            <button onClick={() => setEditing(true)} className="text-[11px] text-slate-400 hover:text-foreground">Edit</button>
            <button disabled={!canDelete || deleting} onClick={remove} title={!canDelete ? "Can't remove the last option for this kind" : undefined} className="text-[11px] text-destructive hover:text-destructive/80 disabled:opacity-30">
              {deleting ? "…" : "Remove"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddModelForm({ kind, onAdd }: { kind: "text" | "image" | "video"; onAdd: (body: Record<string, unknown>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [label, setLabel] = useState("");
  const [model, setModel] = useState("");
  const [credits, setCredits] = useState("2");
  const [minD, setMinD] = useState("4");
  const [maxD, setMaxD] = useState("15");
  const [durationOptions, setDurationOptions] = useState("");
  const [resolutions, setResolutions] = useState<string[]>(["720p"]);
  const [supportsAudio, setSupportsAudio] = useState(false);
  const [supportsLastFrame, setSupportsLastFrame] = useState(false);
  const [pricePerSec, setPricePerSec] = useState<number | null>(null);
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
    setSaving(true);
    await onAdd({
      kind, label: label.trim(), model: model.trim(), credits: Number(credits) || 1,
      min_duration: kind === "video" ? Number(minD) || 4 : null,
      max_duration: kind === "video" ? Number(maxD) || 15 : null,
      duration_options: kind === "video" ? parsedDurationOptions : null,
      resolutions: kind === "video" && resolutions.length > 0 ? resolutions : null,
      supports_audio: kind === "video" ? supportsAudio : null,
      supports_last_frame: kind === "video" ? supportsLastFrame : null,
      price_per_second_usd: kind === "video" ? pricePerSec : null,
    });
    setSaving(false);
    setLabel(""); setModel(""); setCredits("2"); setMinD("4"); setMaxD("15"); setDurationOptions(""); setResolutions(["720p"]); setSupportsAudio(false); setSupportsLastFrame(false); setPricePerSec(null);
    setOpen(false);
  }

  return (
    <>
      {showCatalog && <CatalogPickerModal kind={kind as "image" | "video"} onPick={pickFromCatalog} onClose={() => setShowCatalog(false)} />}
      {!open ? (
        <div className="flex gap-2">
          {kind !== "text" && (
            <button onClick={() => setShowCatalog(true)} className="flex-1 rounded-lg border border-dashed border-slate-500 py-2.5 text-xs font-semibold text-slate-300 hover:border-slate-400 hover:text-foreground">
              ＋ Fetch from OpenRouter
            </button>
          )}
          <button onClick={() => setOpen(true)} className={`rounded-lg border border-dashed border-slate-700/60 px-3 py-2.5 text-xs text-muted-foreground hover:border-slate-500 hover:text-foreground ${kind === "text" ? "flex-1" : ""}`}>
            {kind === "text" ? "＋ Add manually" : "Add manually"}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-600 bg-background/60 p-3 space-y-2">
          {pricePerSec != null && <div className="text-[11px] text-amber-400/80">Provider cost: ${pricePerSec.toFixed(3)}/second — use this to set a sensible credit price below.</div>}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label shown to companies" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model identifier" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={50} value={credits} onChange={(e) => setCredits(e.target.value)} className="w-20 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
            <span className="text-[11px] text-muted-foreground">credits (token-to-cost mapping comes later — set a sensible number for now)</span>
          </div>
          {kind === "video" && (
            <>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={60} value={minD} onChange={(e) => setMinD(e.target.value)} className="w-16 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">to</span>
                <input type="number" min={1} max={60} value={maxD} onChange={(e) => setMaxD(e.target.value)} className="w-16 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
                <span className="text-[11px] text-muted-foreground">seconds total (ignored if exact durations are set below)</span>
              </div>
              <input value={durationOptions} onChange={(e) => setDurationOptions(e.target.value)} placeholder="Exact durations only, e.g. 4, 6, 8 (leave blank for a normal range)" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
              <ResolutionPicker value={resolutions} onChange={setResolutions} />
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
          <div className="flex items-center gap-2">
            <button disabled={saving || !label.trim() || !model.trim()} onClick={add} className="rounded-full bg-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
            <button onClick={() => setOpen(false)} className="rounded-full border border-slate-700/50 px-3 py-1 text-[11px] text-muted-foreground">Cancel</button>
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
    <div className="mb-6 max-w-4xl rounded-xl border border-slate-700/50 bg-card/60 p-4">
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
                className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground focus:border-slate-500 focus:outline-none"
              />
              <div className="mt-3 flex items-center gap-3">
                <button onClick={saveRaw} disabled={saving} className="rounded-full bg-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
                  {saving ? "Saving…" : "Save all"}
                </button>
                <button onClick={loadRaw} className="rounded-full border border-slate-700/60 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">
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
  const allowed = useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();

  const [models, setModels] = useState<DeveloperModelsOut | null>(null);
  const [err, setErr] = useState("");
  const [markup, setMarkup] = useState<string>("");
  const [markupSaved, setMarkupSaved] = useState(false);
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [promptReviewModelId, setPromptReviewModelId] = useState<string>("");
  const [videoPrepImageModelId, setVideoPrepImageModelId] = useState<string>("");
  const [savingVideoPrep, setSavingVideoPrep] = useState(false);
  const [videoPrepSaved, setVideoPrepSaved] = useState(false);

  async function load() {
    try {
      setModels(await devApi("/developer/models"));
      const m = await devApi("/developer/pricing/markup");
      setMarkup(String(m.markup_multiplier));
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

  async function saveMarkup() {
    const value = Number(markup);
    if (!value || value < 1) return;
    setSavingMarkup(true); setMarkupSaved(false);
    try {
      await devApi("/developer/pricing/markup", { method: "PUT", body: { markup_multiplier: value } });
      setMarkupSaved(true);
      setTimeout(() => setMarkupSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save the markup");
    }
    setSavingMarkup(false);
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

  if (!allowed) return null;

  return (
    <DeveloperShell title="Models">
      <p className="mb-6 text-sm text-muted-foreground">
        Add as many image and video models as you want — "Fetch from OpenRouter" browses their real live catalog so you click an actual model instead of hand-typing an identifier. For video models, set which resolutions to offer, and optionally a dynamic pricing formula (see each model's Edit view) so the price customers see reflects exactly what they picked — resolution, audio, duration — not a flat guess. Companies never see model identifiers, only your labels.
      </p>

      <RawJsonEditor onSaved={load} />

      <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-4 max-w-md">
        <div className="text-sm font-semibold text-foreground">💰 Global markup multiplier</div>
        <p className="mt-1 text-[11px] text-muted-foreground">Applied to every dynamically-priced model's real OpenRouter cost before converting to credits. Agreed target: 1.6–1.8x nets a 20% margin after infra and Stripe fees. Doesn't affect models still on flat legacy credits.</p>
        <div className="mt-3 flex items-center gap-2">
          <input type="number" step="0.05" min={1} max={10} value={markup} onChange={(e) => setMarkup(e.target.value)}
            className="w-24 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-slate-500 focus:outline-none" />
          <span className="text-xs text-muted-foreground">×</span>
          <button disabled={savingMarkup} onClick={saveMarkup} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
            {savingMarkup ? "Saving…" : "Save"}
          </button>
          {markupSaved && <span className="text-xs text-emerald-400">✓ Saved</span>}
        </div>
      </div>

      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}
      {!models ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {(["text", "image", "video"] as const).map((kind) => (
            <div key={kind} className="rounded-xl border border-slate-700/50 bg-card/60 p-4">
              <div className="text-sm font-semibold capitalize text-foreground">{kind} generation</div>
              {kind === "video" && (
                <div className="mt-3 space-y-3 rounded-lg border border-slate-700/50 bg-background/40 p-3">
                  <div>
                    <div className="text-[11px] font-semibold text-foreground">Text Prompt <span className="font-normal text-muted-foreground">— reviews and improves each shot's wording before generation</span></div>
                    <select
                      value={promptReviewModelId}
                      onChange={(e) => { setPromptReviewModelId(e.target.value); saveVideoPrep(e.target.value, videoPrepImageModelId); }}
                      className="mt-1 w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none"
                    >
                      <option value="">Off — use the customer's wording as-is</option>
                      {models?.text.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-foreground">Image for Video <span className="font-normal text-muted-foreground">— pre-renders the first frame to match shot 1's scene, fixing the "reference photo's original background shows through" problem</span></div>
                    <select
                      value={videoPrepImageModelId}
                      onChange={(e) => { setVideoPrepImageModelId(e.target.value); saveVideoPrep(promptReviewModelId, e.target.value); }}
                      className="mt-1 w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none"
                    >
                      <option value="">Off — use the reference photo as-is for the starting frame</option>
                      {models?.image.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Both run automatically in the background on your own OpenRouter balance — never shown to or charged to companies. {savingVideoPrep && "Saving…"} {videoPrepSaved && <span className="text-emerald-400">✓ Saved</span>}</p>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {models[kind].map((entry, i) => (
                  <ModelRow
                    key={entry.id} kind={kind} entry={entry} onSave={handleSave} onDelete={handleDelete} canDelete={models[kind].length > 1}
                    onMoveUp={() => handleReorder(kind, i, i - 1)}
                    onMoveDown={() => handleReorder(kind, i, i + 1)}
                    canMoveUp={i > 0}
                    canMoveDown={i < models[kind].length - 1}
                  />
                ))}
                <AddModelForm kind={kind} onAdd={handleAdd} />
              </div>
            </div>
          ))}
        </div>
      )}
    </DeveloperShell>
  );
}
