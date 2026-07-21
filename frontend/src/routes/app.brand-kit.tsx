import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, Field, Input } from "@/components/app-shell";
import { api, type AvailableModelsOut } from "@/lib/api";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/brand-kit")({
  component: BrandKit,
  head: () => ({ meta: [{ title: "Brand Kit — NivaAd" }] }),
});

const COLORS = ["#c9a84c", "#22d3ee", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#e5e7eb", "#a855f7"];
const PLACEMENTS: { key: string; label: string }[] = [
  { key: "top-left", label: "Top left" },
  { key: "top-right", label: "Top right" },
  { key: "bottom-left", label: "Bottom left" },
  { key: "bottom-right", label: "Bottom right" },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Video and image padding are independent Brand Kit settings (see
// services/reframe.py) with parallel but differently-named fields on the
// backend — image's are simply "image_"-prefixed. This maps each media
// type to its own field names once, so the actual editor UI below can be
// written a single time and reused for both instead of duplicated.
type PaddingFieldNames = {
  verticalMode: string; horizontalMode: string;
  padTopImage: string; padBottomImage: string; padLeftImage: string; padRightImage: string;
  verticalColor: string; horizontalColor: string;
};
const VIDEO_PADDING_FIELDS: PaddingFieldNames = {
  verticalMode: "vertical_pad_mode", horizontalMode: "horizontal_pad_mode",
  padTopImage: "pad_top_image", padBottomImage: "pad_bottom_image", padLeftImage: "pad_left_image", padRightImage: "pad_right_image",
  verticalColor: "vertical_pad_color", horizontalColor: "horizontal_pad_color",
};
const IMAGE_PADDING_FIELDS: PaddingFieldNames = {
  verticalMode: "image_vertical_pad_mode", horizontalMode: "image_horizontal_pad_mode",
  padTopImage: "image_pad_top_image", padBottomImage: "image_pad_bottom_image", padLeftImage: "image_pad_left_image", padRightImage: "image_pad_right_image",
  verticalColor: "image_vertical_pad_color", horizontalColor: "image_horizontal_pad_color",
};

function PaddingEditor({ title, description, verticalHint, horizontalHint, fields, kit, onSaving, onError }: {
  title: string;
  description: string;
  verticalHint: string;
  horizontalHint: string;
  fields: PaddingFieldNames;
  kit: Record<string, any>;
  onSaving: (v: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [verticalMode, setVerticalMode] = useState(kit[fields.verticalMode] || "blurred_video");
  const [horizontalMode, setHorizontalMode] = useState(kit[fields.horizontalMode] || "blurred_video");
  const [padTopImage, setPadTopImage] = useState<string | null>(kit[`${fields.padTopImage}_url`] || null);
  const [padBottomImage, setPadBottomImage] = useState<string | null>(kit[`${fields.padBottomImage}_url`] || null);
  const [padLeftImage, setPadLeftImage] = useState<string | null>(kit[`${fields.padLeftImage}_url`] || null);
  const [padRightImage, setPadRightImage] = useState<string | null>(kit[`${fields.padRightImage}_url`] || null);
  const [verticalColor, setVerticalColor] = useState(kit[fields.verticalColor] || "#000000");
  const [horizontalColor, setHorizontalColor] = useState(kit[fields.horizontalColor] || "#000000");
  const [busy, setBusy] = useState(false);

  async function saveVerticalMode(m: string) {
    setVerticalMode(m);
    try { await api("/brand-kit", { method: "PUT", body: { [fields.verticalMode]: m } }); } catch { /* non-fatal */ }
  }
  async function saveHorizontalMode(m: string) {
    setHorizontalMode(m);
    try { await api("/brand-kit", { method: "PUT", body: { [fields.horizontalMode]: m } }); } catch { /* non-fatal */ }
  }
  async function saveVerticalColor(c: string) {
    setVerticalColor(c);
    try { await api("/brand-kit", { method: "PUT", body: { [fields.verticalColor]: c } }); } catch { /* non-fatal */ }
  }
  async function saveHorizontalColor(c: string) {
    setHorizontalColor(c);
    try { await api("/brand-kit", { method: "PUT", body: { [fields.horizontalColor]: c } }); } catch { /* non-fatal */ }
  }
  async function handlePadImage(field: string, setter: (v: string | null) => void, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setBusy(true); onSaving(true);
    try {
      const updated = await api("/brand-kit", { method: "PUT", body: { [field]: dataUrl } });
      setter(updated[`${field}_url`]);
    } catch (e: any) {
      onError(e.message || "Could not upload image");
    }
    setBusy(false); onSaving(false);
  }
  async function removePadImage(field: string, setter: (v: string | null) => void) {
    setBusy(true); onSaving(true);
    try {
      await api("/brand-kit", { method: "PUT", body: { [field]: "" } });
      setter(null);
    } catch { /* non-fatal */ }
    setBusy(false); onSaving(false);
  }

  return (
    <div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-foreground">Top / bottom padding <span className="font-normal text-muted-foreground">{verticalHint}</span></div>
          <div className="mt-2 flex gap-1.5">
            {[["blurred_video", "Blurred background"], ["image", "Image"], ["color", "Color"]].map(([k, l]) => (
              <button key={k} onClick={() => saveVerticalMode(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${verticalMode === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
          {verticalMode === "image" && (
            <div className="mt-3 space-y-3">
              {([[fields.padTopImage, padTopImage, setPadTopImage, "Top bar"], [fields.padBottomImage, padBottomImage, setPadBottomImage, "Bottom bar"]] as const).map(([field, url, setter, label]) => (
                <div key={field}>
                  <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
                  {url ? (
                    <div className="flex items-center gap-2">
                      <img src={url} alt={label} className="h-10 w-24 rounded border border-border object-cover" />
                      <button onClick={() => removePadImage(field, setter)} disabled={busy} className="rounded-full border border-destructive/40 px-2.5 py-1 text-[10px] text-destructive disabled:opacity-50">Remove</button>
                    </div>
                  ) : (
                    <label className="inline-block cursor-pointer rounded-full border border-dashed border-ring px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                      ⬆ Upload
                      <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => handlePadImage(field, setter, e)} />
                    </label>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">These scale to fit varying padding heights depending on the exact conversion — design with some tolerance for stretching, not a fixed exact height.</p>
            </div>
          )}
          {verticalMode === "color" && (
            <div className="mt-3 flex items-center gap-2">
              <input type="color" value={verticalColor} onChange={(e) => saveVerticalColor(e.target.value)} className="h-8 w-8 rounded border border-border bg-transparent cursor-pointer" />
              <span className="text-[11px] text-muted-foreground">{verticalColor}</span>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-foreground">Left / right padding <span className="font-normal text-muted-foreground">{horizontalHint}</span></div>
          <div className="mt-2 flex gap-1.5">
            {[["blurred_video", "Blurred background"], ["image", "Image"], ["color", "Color"]].map(([k, l]) => (
              <button key={k} onClick={() => saveHorizontalMode(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${horizontalMode === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
          {horizontalMode === "image" && (
            <div className="mt-3 space-y-3">
              {([[fields.padLeftImage, padLeftImage, setPadLeftImage, "Left bar"], [fields.padRightImage, padRightImage, setPadRightImage, "Right bar"]] as const).map(([field, url, setter, label]) => (
                <div key={field}>
                  <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
                  {url ? (
                    <div className="flex items-center gap-2">
                      <img src={url} alt={label} className="h-10 w-24 rounded border border-border object-cover" />
                      <button onClick={() => removePadImage(field, setter)} disabled={busy} className="rounded-full border border-destructive/40 px-2.5 py-1 text-[10px] text-destructive disabled:opacity-50">Remove</button>
                    </div>
                  ) : (
                    <label className="inline-block cursor-pointer rounded-full border border-dashed border-ring px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                      ⬆ Upload
                      <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => handlePadImage(field, setter, e)} />
                    </label>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">Same scaling tolerance note applies here.</p>
            </div>
          )}
          {horizontalMode === "color" && (
            <div className="mt-3 flex items-center gap-2">
              <input type="color" value={horizontalColor} onChange={(e) => saveHorizontalColor(e.target.value)} className="h-8 w-8 rounded border border-border bg-transparent cursor-pointer" />
              <span className="text-[11px] text-muted-foreground">{horizontalColor}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type BrandLogo = { id: string; url: string; is_active: boolean; created_at: string };
const MAX_LOGOS = 5;

type BrandVideoShot = {
  id: string; kind: string; status: string; label: string; prompt: string; duration: number; ratio: string; mute_audio: boolean; url: string | null; poster_url: string | null; error: string | null; created_at: string;
  reference_logo_id: string | null; overlay_text: string | null; overlay_font: string | null; overlay_text_color: string | null; overlay_position: string | null;
};
const MAX_SHOTS_PER_KIND = 3;
const GENERATING_STATUSES = new Set(["queued", "running"]);
const OVERLAY_FONTS: [string, string][] = [["sans", "Sans"], ["sans_bold", "Sans Bold"], ["serif", "Serif"]];
const OVERLAY_SIZES: [string, string][] = [["small", "Small"], ["medium", "Medium"], ["large", "Large"]];
// Full 3x3 grid — middle_center included specifically for text-only
// shots with no logo reference (nothing to collide with in the
// middle). When a logo IS referenced, steer toward an edge/corner
// instead — the AI tends to place a referenced logo somewhere in the
// middle of frame, and there's no way to know its exact position.
const ANCHOR_GRID: string[][] = [
  ["top_left", "top_center", "top_right"],
  ["middle_left", "middle_center", "middle_right"],
  ["bottom_left", "bottom_center", "bottom_right"],
];
const ANCHOR_LABELS: Record<string, string> = {
  top_left: "Top left", top_center: "Top center", top_right: "Top right",
  middle_left: "Middle left", middle_center: "Center", middle_right: "Middle right",
  bottom_left: "Bottom left", bottom_center: "Bottom center", bottom_right: "Bottom right",
};

function shotDisplayName(shot: BrandVideoShot) {
  return shot.label || (shot.prompt.length > 40 ? shot.prompt.slice(0, 40) + "…" : shot.prompt);
}

type GenerateShotInput = {
  kind: "intro" | "outro"; label: string; prompt: string; duration: number; ratio: string; mute_audio: boolean; model_id: string;
  reference_logo_id: string | null; overlay_text: string | null; overlay_font: string; overlay_font_size: string; overlay_text_color: string; overlay_position: string;
};

function ShotPreviewModal({ shot, onClose }: { shot: BrandVideoShot; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">{shotDisplayName(shot)}</div>
          <button onClick={onClose} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">✕ Close</button>
        </div>
        {shot.url && <video src={shot.url} controls autoPlay playsInline className="w-full rounded-lg border border-border" />}
        <div className="mt-2 text-xs text-muted-foreground">{shot.prompt}</div>
        {shot.overlay_text && <div className="mt-1 text-xs text-primary">"{shot.overlay_text}"</div>}
      </div>
    </div>
  );
}

/** Inline-editable name shown on each gallery card — click to rename,
 * Enter/blur saves, Escape cancels. */
function ShotNameLabel({ shot, onRename }: { shot: BrandVideoShot; onRename: (id: string, label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(shotDisplayName(shot));

  function save() {
    setEditing(false);
    if (value.trim() && value.trim() !== shot.label) onRename(shot.id, value.trim());
  }

  if (editing) {
    return (
      <input
        autoFocus value={value} onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setValue(shotDisplayName(shot)); setEditing(false); } }}
        className="w-full rounded border border-ring bg-input/40 px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none"
      />
    );
  }
  return (
    <button onClick={() => { setValue(shot.label || ""); setEditing(true); }} className="text-left text-[10px] font-medium text-foreground hover:underline line-clamp-1" title="Click to rename">
      {shotDisplayName(shot)} ✎
    </button>
  );
}

/** One kind's gallery (intro OR outro) — used twice below, once per
 * kind, with a shared generate-form. Polls the parent's shared shot
 * list while anything is still queued/running, same background-job
 * pattern as Create Ad's own video generation. */
function ShotGallery({
  kind, label, description, shots, models, logos, ratios, busyId, onGenerate, onRename, onDelete,
}: {
  kind: "intro" | "outro";
  label: string;
  description: string;
  shots: BrandVideoShot[];
  models: AvailableModelsOut | null;
  logos: BrandLogo[];
  ratios: string[];
  busyId: string | null;
  onGenerate: (v: GenerateShotInput) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(3);
  const [ratio, setRatio] = useState(ratios[0] || "16:9");
  const [muteAudio, setMuteAudio] = useState(true);
  const [modelId, setModelId] = useState("");
  const [referenceLogoId, setReferenceLogoId] = useState("");
  const [overlayText, setOverlayText] = useState("");
  const [overlayFont, setOverlayFont] = useState("sans");
  const [overlaySize, setOverlaySize] = useState("medium");
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlayAnchor, setOverlayAnchor] = useState("bottom_center");
  const [previewShot, setPreviewShot] = useState<BrandVideoShot | null>(null);

  const atLimit = shots.length >= MAX_SHOTS_PER_KIND;

  function submit() {
    if (!prompt.trim() || !modelId) return;
    onGenerate({
      kind, label: name.trim(), prompt: prompt.trim(), duration, ratio, mute_audio: muteAudio, model_id: modelId,
      reference_logo_id: referenceLogoId || null,
      overlay_text: overlayText.trim() || null, overlay_font: overlayFont, overlay_font_size: overlaySize, overlay_text_color: overlayColor, overlay_position: overlayAnchor,
    });
    setName(""); setPrompt(""); setOverlayText(""); setReferenceLogoId(""); setShowForm(false);
  }

  return (
    <div>
      <div className="text-sm font-medium text-foreground">{label} <span className="text-xs font-normal text-muted-foreground">({shots.length}/{MAX_SHOTS_PER_KIND})</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>

      <div className="mt-4 flex flex-wrap gap-4">
        {shots.map((shot) => (
          <div key={shot.id} className="flex w-40 flex-col gap-2 rounded-2xl border border-border p-3">
            {shot.status === "ready" && shot.url ? (
              <button onClick={() => setPreviewShot(shot)} className="group relative h-24 w-full overflow-hidden rounded-lg border border-border">
                {shot.poster_url ? (
                  <img src={shot.poster_url} alt={shot.prompt} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-background/60 text-[10px] text-muted-foreground">No thumbnail</div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                  <span className="rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">▶ Preview</span>
                </div>
              </button>
            ) : shot.status === "failed" ? (
              <div className="flex h-24 w-full items-center justify-center rounded-lg border border-destructive/40 bg-destructive/5 text-[10px] text-destructive text-center px-1">Generation failed</div>
            ) : (
              <div className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground text-center px-1 animate-pulse">Generating…</div>
            )}
            <ShotNameLabel shot={shot} onRename={onRename} />
            {shot.overlay_text && <div className="text-[10px] text-primary line-clamp-1">"{shot.overlay_text}"</div>}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{shot.ratio} · {shot.duration}s{shot.mute_audio ? " · 🔇" : ""}</span>
              <button onClick={() => onDelete(shot.id)} disabled={busyId === shot.id} className="text-[10px] text-destructive hover:underline disabled:opacity-50">Delete</button>
            </div>
          </div>
        ))}

        {!atLimit && (
          showForm ? (
            <div className="w-80 rounded-2xl border border-primary/40 bg-card/60 p-3 space-y-3">
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Name (optional)</div>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "intro" ? "e.g. Particle logo intro" : "e.g. Contact card outro"}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none" />
              </div>

              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Shot description</div>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe the scene/action — e.g. our logo assembling from glowing particles, dark background"
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground focus:border-ring focus:outline-none" />
              </div>

              <div className="flex items-center gap-2">
                <select value={modelId} onChange={(e) => setModelId(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none">
                  <option value="">{models ? "Choose a model…" : "Loading models…"}</option>
                  {models?.video.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.credits}cr</option>)}
                </select>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-16 rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none">
                  {[2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
              </div>

              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Ratio</div>
                <select value={ratio} onChange={(e) => setRatio(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none">
                  {ratios.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <div className="mt-1 text-[10px] text-muted-foreground">AI video models generate 16:9 by default — this reframes to your chosen shape afterward, same padding your Brand Kit uses everywhere else.</div>
              </div>

              <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                <input type="checkbox" checked={muteAudio} onChange={(e) => setMuteAudio(e.target.checked)} />
                🔇 Generate without audio
              </label>
              {muteAudio && <div className="-mt-2 text-[10px] text-muted-foreground">The model is asked to skip audio, and any audio it produces anyway is stripped before saving — the stored clip is guaranteed silent.</div>}

              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Reference logo (optional)</div>
                <select value={referenceLogoId} onChange={(e) => setReferenceLogoId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none">
                  <option value="">None — let the AI imagine it from the description</option>
                  {logos.map((l) => <option key={l.id} value={l.id}>{l.is_active ? "★ " : ""}Logo uploaded {new Date(l.created_at).toLocaleDateString()}</option>)}
                </select>
                <div className="mt-1 text-[10px] text-muted-foreground">Sent to the video model as the starting frame, so it generates around/animates your actual logo.</div>
              </div>

              <div className="border-t border-border pt-2.5">
                <div className="text-[10px] text-muted-foreground mb-1">Text overlay (optional — e.g. contact info or website)</div>
                <textarea value={overlayText} onChange={(e) => setOverlayText(e.target.value)} rows={2} placeholder={"hello@yourbrand.com\nwww.yourbrand.com"}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground focus:border-ring focus:outline-none" />
                <div className="mt-1 text-[10px] text-muted-foreground">Burned in exactly as typed after generation — never left to the AI to render, since video models can't reliably draw legible text.</div>
                {overlayText.trim() && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={overlayFont} onChange={(e) => setOverlayFont(e.target.value)}
                        className="rounded-lg border border-border bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none">
                        {OVERLAY_FONTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <select value={overlaySize} onChange={(e) => setOverlaySize(e.target.value)}
                        className="rounded-lg border border-border bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none">
                        {OVERLAY_SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <input type="color" value={overlayColor} onChange={(e) => setOverlayColor(e.target.value)} className="h-7 w-7 rounded border border-border bg-transparent cursor-pointer" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">
                        Position{referenceLogoId ? " — steer clear of the middle, where your logo likely appears" : ""}
                      </div>
                      <div className="grid w-32 grid-cols-3 gap-1 rounded-lg border border-border bg-background/40 p-1.5">
                        {ANCHOR_GRID.flat().map((a) => (
                          <button key={a} type="button" onClick={() => setOverlayAnchor(a)} title={ANCHOR_LABELS[a]}
                            className={`h-6 rounded ${overlayAnchor === a ? "bg-primary" : a === "middle_center" && referenceLogoId ? "bg-destructive/20 hover:bg-destructive/30" : "bg-border/60 hover:bg-border"}`} />
                        ))}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{ANCHOR_LABELS[overlayAnchor]}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button onClick={submit} disabled={!prompt.trim() || !modelId} className="rounded-full bg-slate-700 px-3 py-1 text-[11px] font-semibold text-background disabled:opacity-50">Generate</button>
                <button onClick={() => setShowForm(false)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)}
              className="flex w-40 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-ring p-3 text-center text-muted-foreground hover:text-foreground">
              <span className="text-2xl">✨</span>
              <span className="text-[11px]">Generate {kind === "intro" ? "start" : "end"} shot</span>
            </button>
          )
        )}
      </div>
      {previewShot && <ShotPreviewModal shot={previewShot} onClose={() => setPreviewShot(null)} />}
    </div>
  );
}

function VideoShotsTab() {
  const [shots, setShots] = useState<BrandVideoShot[] | null>(null);
  const [models, setModels] = useState<AvailableModelsOut | null>(null);
  const [logos, setLogos] = useState<BrandLogo[]>([]);
  const [ratios, setRatios] = useState<string[]>(["16:9"]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    try { setShots(await api("/brand-kit/video-shots")); } catch (e: any) { setErr(e.message || "Could not load shots"); }
  }
  useEffect(() => {
    load();
    api("/ads/available-models").then(setModels).catch(() => {});
    api("/brand-kit/logos").then(setLogos).catch(() => {});
    api("/connections/video-ratios").then((r) => setRatios(r.ratios?.length ? r.ratios : ["16:9"])).catch(() => {});
  }, []);

  // Poll while anything is still generating — same pattern as Create Ad's
  // own video job polling, just against this gallery list instead of a
  // single ad.
  useEffect(() => {
    if (!shots || !shots.some((s) => GENERATING_STATUSES.has(s.status))) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [shots]);

  async function generate(v: GenerateShotInput) {
    setErr("");
    try { setShots(await api("/brand-kit/video-shots", { method: "POST", body: v })); }
    catch (e: any) { setErr(e.message || "Could not start generation"); }
  }

  async function rename(id: string, label: string) {
    setErr("");
    try { setShots(await api(`/brand-kit/video-shots/${id}`, { method: "PUT", body: { label } })); }
    catch (e: any) { setErr(e.message || "Could not rename"); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this shot? Ads that already used it keep their finished video — this only removes it from future selection.")) return;
    setBusyId(id); setErr("");
    try { setShots(await api(`/brand-kit/video-shots/${id}`, { method: "DELETE" })); }
    catch (e: any) { setErr(e.message || "Could not delete"); }
    setBusyId(null);
  }

  if (shots === null) return <div className="text-xs text-muted-foreground">Loading…</div>;

  const introShots = shots.filter((s) => s.kind === "intro");
  const outroShots = shots.filter((s) => s.kind === "outro");

  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground max-w-2xl">
        Generate up to 3 short (2–5s) AI clips for each: a brand intro to play before your ad video, and a credits/outro
        clip to play after. Name each one so it's easy to pick later, choose the ratio it should end up in, optionally
        reference one of your Brand Kit logos (sent to the AI as a starting frame), and/or burn in a text line — like
        contact info or your website — reliably positioned after generation. Pick which one (if any) to use per-ad in
        Create Ad's AI Video section — they're stitched onto the generated video automatically, reframed to match its
        exact shape first.
      </p>
      <ShotGallery kind="intro" label="Start shots" description="Plays before the generated video." shots={introShots} models={models} logos={logos} ratios={ratios} busyId={busyId} onGenerate={generate} onRename={rename} onDelete={remove} />
      <ShotGallery kind="outro" label="End / credit shots" description="Plays after the generated video." shots={outroShots} models={models} logos={logos} ratios={ratios} busyId={busyId} onGenerate={generate} onRename={rename} onDelete={remove} />
      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}

function BrandKit() {
  const allowed = useRequireCapability("view_brand_kit");

  const [tab, setTab] = useState<"logo" | "image" | "video" | "shots">("logo");
  const [logos, setLogos] = useState<BrandLogo[] | null>(null);
  const [logoBusy, setLogoBusy] = useState<string | null>(null); // "upload" | a logo id currently being activated/deleted
  const [color, setColor] = useState(COLORS[0]);
  const [tagline, setTagline] = useState("");
  const [placement, setPlacement] = useState("bottom-right");
  const [kit, setKit] = useState<Record<string, any> | null>(null); // raw brand-kit response — PaddingEditor reads its own fields straight from this
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    try {
      const [kit, logoList] = await Promise.all([api("/brand-kit"), api("/brand-kit/logos")]);
      setKit(kit);
      setLogos(logoList);
      setColor(kit.primary_color || COLORS[0]);
      setTagline(kit.tagline || "");
      setPlacement(kit.logo_placement || "bottom-right");
    } catch (e: any) {
      setErr(e.message || "Could not load brand kit");
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveColor(c: string) {
    setColor(c);
    try { await api("/brand-kit", { method: "PUT", body: { primary_color: c } }); } catch { /* non-fatal */ }
  }

  async function savePlacement(p: string) {
    setPlacement(p);
    try { await api("/brand-kit", { method: "PUT", body: { logo_placement: p } }); } catch { /* non-fatal */ }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = ""; // allow re-selecting the same file later
    const dataUrl = await fileToDataUrl(f);
    setLogoBusy("upload"); setErr("");
    try {
      setLogos(await api("/brand-kit/logos", { method: "POST", body: { logo: dataUrl } }));
    } catch (e: any) {
      setErr(e.message || "Could not upload logo");
    }
    setLogoBusy(null);
  }

  async function activateLogo(id: string) {
    setLogoBusy(id); setErr("");
    try {
      setLogos(await api(`/brand-kit/logos/${id}/activate`, { method: "PUT" }));
    } catch (e: any) {
      setErr(e.message || "Could not set active logo");
    }
    setLogoBusy(null);
  }

  async function deleteLogo(id: string) {
    if (!confirm("Delete this logo? If it's currently active, another one (or none) takes its place.")) return;
    setLogoBusy(id); setErr("");
    try {
      setLogos(await api(`/brand-kit/logos/${id}`, { method: "DELETE" }));
    } catch (e: any) {
      setErr(e.message || "Could not delete logo");
    }
    setLogoBusy(null);
  }

  async function saveTagline() {
    setSaving(true); setSavedMsg("");
    try {
      await api("/brand-kit", { method: "PUT", body: { tagline } });
      setSavedMsg("✓ Saved");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e: any) {
      setSavedMsg(e.message || "Could not save");
    }
    setSaving(false);
  }

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  if (loading) {
    return (
      <AppShell eyebrow="Setup" title="Brand Kit">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell eyebrow="Setup" title="Brand Kit">
      <Panel className="max-w-3xl">
        {err && <div className="mb-4 text-xs text-destructive">{err}</div>}

        <div className="mb-6 flex gap-2 border-b border-border pb-3">
          {([["logo", "Logo & Brand"], ["image", "Image padding"], ["video", "Video padding"], ["shots", "Video Intro (Start) and Credit (End) shots"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-full px-4 py-2 text-xs font-semibold ${tab === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {l}
            </button>
          ))}
        </div>

        {tab === "logo" && (
          <>
            <div className="text-sm font-medium text-foreground">Logos <span className="text-xs font-normal text-muted-foreground">({logos?.length ?? 0}/{MAX_LOGOS})</span></div>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload up to {MAX_LOGOS} logos and switch between them any time — whichever is marked <span className="font-medium text-foreground">Active</span> is the one actually composited onto generated ads when you tick "Include logo".
            </p>

            {logos === null ? (
              <div className="mt-4 text-xs text-muted-foreground">Loading…</div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-4">
                {logos.map((logo) => (
                  <div key={logo.id} className={`flex w-32 flex-col items-center gap-2 rounded-2xl border p-3 ${logo.is_active ? "border-primary bg-primary/5" : "border-border"}`}>
                    <img src={logo.url} alt="logo" className="h-16 w-16 rounded-xl object-cover border border-border" />
                    {logo.is_active ? (
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">✓ Active</span>
                    ) : (
                      <button onClick={() => activateLogo(logo.id)} disabled={logoBusy === logo.id}
                        className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50">
                        {logoBusy === logo.id ? "…" : "Set active"}
                      </button>
                    )}
                    <button onClick={() => deleteLogo(logo.id)} disabled={logoBusy === logo.id}
                      className="text-[10px] text-destructive hover:underline disabled:opacity-50">Delete</button>
                  </div>
                ))}

                {logos.length < MAX_LOGOS && (
                  <label className={`flex w-32 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed p-3 text-center ${logoBusy === "upload" ? "border-border text-muted-foreground" : "cursor-pointer border-ring text-muted-foreground hover:text-foreground"}`}>
                    <span className="text-2xl">⬆</span>
                    <span className="text-[11px]">{logoBusy === "upload" ? "Uploading…" : "Upload logo"}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={uploadLogo} disabled={logoBusy === "upload"} />
                  </label>
                )}
              </div>
            )}

            {logos && logos.length > 0 && (
              <div className="mt-6">
                <div className="text-sm font-medium text-foreground">Logo placement on generated ads</div>
                <p className="mt-1 text-xs text-muted-foreground">Where your logo appears on the ad image when you tick "Include logo" while creating an ad.</p>
                <div className="mt-3 grid w-56 grid-cols-2 gap-2 rounded-xl border border-border bg-background/40 p-3">
                  {PLACEMENTS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => savePlacement(p.key)}
                      className={`rounded-lg border px-3 py-4 text-[11px] font-medium transition ${placement === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8">
              <div className="text-sm font-medium text-foreground">Primary brand color <span className="text-xs text-muted-foreground">(buttons & accents)</span></div>
              <div className="mt-3 flex flex-wrap gap-3">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => saveColor(c)} style={{ background: c }}
                    className={`h-10 w-10 rounded-lg ring-offset-2 ring-offset-background transition ${color === c ? "ring-2 ring-primary" : "ring-1 ring-border"}`} />
                ))}
                <input type="color" value={color} onChange={(e) => saveColor(e.target.value)} className="h-10 w-10 rounded-lg border border-border bg-transparent cursor-pointer" />
              </div>
            </div>

            <div className="mt-8 max-w-md">
              <Field label="Tagline" hint="Short and memorable — woven into copy and shown on the ad image.">
                <Input placeholder='e.g. "Hydration, reinvented."' value={tagline} onChange={(e) => setTagline(e.target.value)} />
              </Field>
              <div className="mt-2 flex items-center gap-3">
                <button onClick={saveTagline} disabled={saving} className="rounded-full border border-primary/50 px-4 py-1.5 text-xs text-primary disabled:opacity-50">
                  {saving ? "Saving…" : "Save tagline"}
                </button>
                {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
              </div>
            </div>

            <div className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
              These items appear as optional tick-boxes in every new ad — the logo is genuinely composited onto the generated image, not just shown in the preview.
            </div>
          </>
        )}

        {tab === "image" && (
          kit ? (
            <PaddingEditor
              title="Image padding"
              description="When a generated image's shape doesn't match a platform's required ratio, it's scaled to fit and the leftover space is padded — never cropped, so nothing is ever cut off. Choose what fills that space, separately for each direction."
              verticalHint="(when a wide image fits into a taller space)"
              horizontalHint="(when a tall image fits into a wider space)"
              fields={IMAGE_PADDING_FIELDS}
              kit={kit}
              onSaving={setSaving}
              onError={setErr}
            />
          ) : (
            <div className="text-xs text-muted-foreground">Loading…</div>
          )
        )}

        {tab === "video" && (
          kit ? (
            <PaddingEditor
              title="Video padding"
              description="Same idea, independently configurable for video — a company might want a blurred background for video but a branded color or image bar for static image posts."
              verticalHint="(when a wide video fits into a taller space)"
              horizontalHint="(when a tall video fits into a wider space)"
              fields={VIDEO_PADDING_FIELDS}
              kit={kit}
              onSaving={setSaving}
              onError={setErr}
            />
          ) : (
            <div className="text-xs text-muted-foreground">Loading…</div>
          )
        )}

        {tab === "shots" && <VideoShotsTab />}
      </Panel>
    </AppShell>
  );
}
