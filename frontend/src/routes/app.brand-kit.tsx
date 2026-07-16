import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, Field, Input } from "@/components/app-shell";
import { api } from "@/lib/api";
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

function BrandKit() {
  const allowed = useRequireCapability("view_brand_kit");

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [tagline, setTagline] = useState("");
  const [placement, setPlacement] = useState("bottom-right");
  const [verticalPadMode, setVerticalPadMode] = useState("blurred_video");
  const [horizontalPadMode, setHorizontalPadMode] = useState("blurred_video");
  const [padTopImage, setPadTopImage] = useState<string | null>(null);
  const [padBottomImage, setPadBottomImage] = useState<string | null>(null);
  const [padLeftImage, setPadLeftImage] = useState<string | null>(null);
  const [padRightImage, setPadRightImage] = useState<string | null>(null);
  const [verticalPadColor, setVerticalPadColor] = useState("#000000");
  const [horizontalPadColor, setHorizontalPadColor] = useState("#000000");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    try {
      const kit = await api("/brand-kit");
      setLogoUrl(kit.logo_url);
      setColor(kit.primary_color || COLORS[0]);
      setTagline(kit.tagline || "");
      setPlacement(kit.logo_placement || "bottom-right");
      setVerticalPadMode(kit.vertical_pad_mode || "blurred_video");
      setHorizontalPadMode(kit.horizontal_pad_mode || "blurred_video");
      setPadTopImage(kit.pad_top_image_url || null);
      setPadBottomImage(kit.pad_bottom_image_url || null);
      setPadLeftImage(kit.pad_left_image_url || null);
      setPadRightImage(kit.pad_right_image_url || null);
      setVerticalPadColor(kit.vertical_pad_color || "#000000");
      setHorizontalPadColor(kit.horizontal_pad_color || "#000000");
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

  async function saveVerticalPadMode(m: string) {
    setVerticalPadMode(m);
    try { await api("/brand-kit", { method: "PUT", body: { vertical_pad_mode: m } }); } catch { /* non-fatal */ }
  }

  async function saveHorizontalPadMode(m: string) {
    setHorizontalPadMode(m);
    try { await api("/brand-kit", { method: "PUT", body: { horizontal_pad_mode: m } }); } catch { /* non-fatal */ }
  }

  async function saveVerticalPadColor(c: string) {
    setVerticalPadColor(c);
    try { await api("/brand-kit", { method: "PUT", body: { vertical_pad_color: c } }); } catch { /* non-fatal */ }
  }

  async function saveHorizontalPadColor(c: string) {
    setHorizontalPadColor(c);
    try { await api("/brand-kit", { method: "PUT", body: { horizontal_pad_color: c } }); } catch { /* non-fatal */ }
  }

  async function handlePadImage(field: string, setter: (v: string | null) => void, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setSaving(true);
    try {
      const kit = await api("/brand-kit", { method: "PUT", body: { [field]: dataUrl } });
      setter(kit[`${field}_url`]);
    } catch (e: any) {
      setErr(e.message || "Could not upload image");
    }
    setSaving(false);
  }

  async function removePadImage(field: string, setter: (v: string | null) => void) {
    setSaving(true);
    try {
      await api("/brand-kit", { method: "PUT", body: { [field]: "" } });
      setter(null);
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setSaving(true);
    try {
      const kit = await api("/brand-kit", { method: "PUT", body: { logo: dataUrl } });
      setLogoUrl(kit.logo_url);
    } catch (e: any) {
      setErr(e.message || "Could not upload logo");
    }
    setSaving(false);
  }

  async function removeLogo() {
    setSaving(true);
    try {
      const kit = await api("/brand-kit", { method: "PUT", body: { logo: "" } });
      setLogoUrl(kit.logo_url);
    } catch { /* non-fatal */ }
    setSaving(false);
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

        <div className="text-sm font-medium text-foreground">Logo</div>
        <div className="mt-3 flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="h-20 w-20 rounded-2xl object-cover border border-border" />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gold-gradient font-display text-3xl font-bold text-background">N</div>
          )}
          <div className="flex flex-col gap-2">
            <label className="cursor-pointer rounded-full bg-gold-gradient px-4 py-2 text-center text-sm font-semibold text-background shadow-[var(--shadow-gold)]">
              ⬆ Upload logo
              <input type="file" accept="image/*" className="hidden" onChange={handleLogo} disabled={saving} />
            </label>
            {logoUrl && (
              <button onClick={removeLogo} disabled={saving} className="rounded-full border border-destructive/40 px-4 py-1.5 text-xs text-destructive disabled:opacity-50">Remove</button>
            )}
          </div>
        </div>

        {logoUrl && (
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

        <div className="mt-8 border-t border-border pt-6">
          <div className="text-sm font-medium text-foreground">Video padding</div>
          <p className="mt-1 text-xs text-muted-foreground">
            When a generated video's shape doesn't match a platform's required ratio, it's scaled to fit and the leftover space is padded — never cropped, so nothing in the video is ever cut off. Choose what fills that space, separately for each direction.
          </p>

          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-foreground">Top / bottom padding <span className="font-normal text-muted-foreground">(when a wide video fits into a taller space)</span></div>
              <div className="mt-2 flex gap-1.5">
                {[["blurred_video", "Blurred video"], ["image", "Image"], ["color", "Color"]].map(([k, l]) => (
                  <button key={k} onClick={() => saveVerticalPadMode(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${verticalPadMode === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
                ))}
              </div>
              {verticalPadMode === "image" && (
                <div className="mt-3 space-y-3">
                  {([["pad_top_image", padTopImage, setPadTopImage, "Top bar"], ["pad_bottom_image", padBottomImage, setPadBottomImage, "Bottom bar"]] as const).map(([field, url, setter, label]) => (
                    <div key={field}>
                      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
                      {url ? (
                        <div className="flex items-center gap-2">
                          <img src={url} alt={label} className="h-10 w-24 rounded border border-border object-cover" />
                          <button onClick={() => removePadImage(field, setter)} disabled={saving} className="rounded-full border border-destructive/40 px-2.5 py-1 text-[10px] text-destructive">Remove</button>
                        </div>
                      ) : (
                        <label className="inline-block cursor-pointer rounded-full border border-dashed border-slate-500 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                          ⬆ Upload
                          <input type="file" accept="image/*" className="hidden" disabled={saving} onChange={(e) => handlePadImage(field, setter, e)} />
                        </label>
                      )}
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground">These scale to fit varying padding heights depending on the exact conversion — design with some tolerance for stretching, not a fixed exact height.</p>
                </div>
              )}
              {verticalPadMode === "color" && (
                <div className="mt-3 flex items-center gap-2">
                  <input type="color" value={verticalPadColor} onChange={(e) => saveVerticalPadColor(e.target.value)} className="h-8 w-8 rounded border border-border bg-transparent cursor-pointer" />
                  <span className="text-[11px] text-muted-foreground">{verticalPadColor}</span>
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold text-foreground">Left / right padding <span className="font-normal text-muted-foreground">(when a tall video fits into a wider space)</span></div>
              <div className="mt-2 flex gap-1.5">
                {[["blurred_video", "Blurred video"], ["image", "Image"], ["color", "Color"]].map(([k, l]) => (
                  <button key={k} onClick={() => saveHorizontalPadMode(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${horizontalPadMode === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
                ))}
              </div>
              {horizontalPadMode === "image" && (
                <div className="mt-3 space-y-3">
                  {([["pad_left_image", padLeftImage, setPadLeftImage, "Left bar"], ["pad_right_image", padRightImage, setPadRightImage, "Right bar"]] as const).map(([field, url, setter, label]) => (
                    <div key={field}>
                      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
                      {url ? (
                        <div className="flex items-center gap-2">
                          <img src={url} alt={label} className="h-10 w-24 rounded border border-border object-cover" />
                          <button onClick={() => removePadImage(field, setter)} disabled={saving} className="rounded-full border border-destructive/40 px-2.5 py-1 text-[10px] text-destructive">Remove</button>
                        </div>
                      ) : (
                        <label className="inline-block cursor-pointer rounded-full border border-dashed border-slate-500 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                          ⬆ Upload
                          <input type="file" accept="image/*" className="hidden" disabled={saving} onChange={(e) => handlePadImage(field, setter, e)} />
                        </label>
                      )}
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground">Same scaling tolerance note applies here.</p>
                </div>
              )}
              {horizontalPadMode === "color" && (
                <div className="mt-3 flex items-center gap-2">
                  <input type="color" value={horizontalPadColor} onChange={(e) => saveHorizontalPadColor(e.target.value)} className="h-8 w-8 rounded border border-border bg-transparent cursor-pointer" />
                  <span className="text-[11px] text-muted-foreground">{horizontalPadColor}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
          These items appear as optional tick-boxes in every new ad — the logo is genuinely composited onto the generated image, not just shown in the preview.
        </div>
      </Panel>
    </AppShell>
  );
}
