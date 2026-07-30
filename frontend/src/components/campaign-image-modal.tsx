import { useState, useEffect } from "react";
import { PLATFORMS, PostPreviewCard } from "@/components/create-ad-parts";
import { api, type AdOut, type AvailableModel } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { ImageThemeGrid, mapImageTheme, type ImageTheme, type ImageThemeField } from "@/components/theme-gallery-grid";

const POSITION_OPTIONS = [
  "top-left","top-center","top-right",
  "middle-left","center","middle-right",
  "bottom-left","bottom-center","bottom-right",
];

const STANDARD_TEXT_FIELDS: ImageThemeField[] = [
  { key: "headline", label: "Headline", placeholder: "e.g. MEGA SALE", defaultPosition: "top-left", styleHint: "large bold advertising headline typography" },
  { key: "badge", label: "Discount badge", placeholder: "e.g. UP TO 50% OFF", defaultPosition: "middle-right", styleHint: "styled like a real promotional discount sticker/badge" },
  { key: "body", label: "Body / about text", placeholder: "e.g. short brand or offer description", defaultPosition: "bottom-left", styleHint: "smaller clean sans-serif supporting text" },
];

function buildOverlayText(fields: ImageThemeField[], fieldValues: Record<string, string>, positions: Record<string, string>): string | null {
  const filled = fields.filter((f) => fieldValues[f.key]?.trim());
  if (filled.length === 0) return null;
  return filled.map((f) => `${f.label}: "${fieldValues[f.key].trim()}" (${positions[f.key] || f.defaultPosition}, ${f.styleHint})`).join(". ") + ".";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function CampaignImageModal({
  campaignId, phaseKey, phaseLabel, ad, onClose, onUpdated,
}: {
  campaignId: string; phaseKey: string; phaseLabel: string; ad: AdOut;
  onClose: () => void; onUpdated: () => void;
}) {
  const { me, refresh } = useAuth();
  const [productImage, setProductImage] = useState<string | null>(null);
  const [sceneText, setSceneText] = useState("");
  const [useBrandKit, setUseBrandKit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState<"idle" | "generating" | "ready" | "failed">("idle");
  const [currentAd, setCurrentAd] = useState(ad);

  // New: model + aspect ratio
  const [availableModels, setAvailableModels] = useState<AvailableModel[] | null>(null);
  const [imageModelId, setImageModelId] = useState<string | null>(null);
  const [imageAspectRatio, setImageAspectRatio] = useState<string | null>(null);

  // New: theme reference
  const [refMode, setRefMode] = useState<"text" | "image">("text");
  const [imageThemes, setImageThemes] = useState<ImageTheme[]>([]);
  const [textTheme, setTextTheme] = useState<{ styleTags: string[]; categoryTags: string[]; stylePrompts: Record<string, string>; categoryPrompts: Record<string, string> }>({ styleTags: [], categoryTags: [], stylePrompts: {}, categoryPrompts: {} });
  const [selectedImageTheme, setSelectedImageTheme] = useState<string | null>(null);
  const [selectedTextStyle, setSelectedTextStyle] = useState<string | null>(null);
  const [selectedTextCategory, setSelectedTextCategory] = useState<string | null>(null);
  const [themeFieldValues, setThemeFieldValues] = useState<Record<string, string>>({});
  const [themePositions, setThemePositions] = useState<Record<string, string>>({});
  const [imageTextOverlay, setImageTextOverlay] = useState<string | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [imagePromptOverride, setImagePromptOverride] = useState("");

  const variant = currentAd.results?.variants?.[0];
  const imageUrl: string | undefined = variant?.image_url;
  const previewPlatform = PLATFORMS.find((p) => p.id === currentAd.platforms[0]);

  useEffect(() => {
    api("/ads/available-models").then((models) => {
      setAvailableModels(models.image);
      if (models.image.length > 0) {
        setImageModelId(models.image[0].id);
        setImageAspectRatio(models.image[0].aspect_ratios?.[0] ?? null);
      }
    }).catch(() => {});
    api("/ads/themes").then((r) => {
      const t = r.themes || {};
      setImageThemes((t.image_themes || []).map(mapImageTheme));
    }).catch(() => {});
    api("/ads/text-theme").then((r) => {
      setTextTheme({ styleTags: r.style_tags || [], categoryTags: r.category_tags || [], stylePrompts: r.style_prompts || {}, categoryPrompts: r.category_prompts || {} });
    }).catch(() => {});
  }, []);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setProductImage(await fileToDataUrl(f));
  }

  async function generate() {
    setBusy(true); setErr(""); setStatus("generating");
    try {
      const res = await api(`/campaigns/${campaignId}/image`, {
        method: "POST",
        body: {
          phase: phaseKey,
          env: productImage ? sceneText || null : null,
          image_scene: !productImage ? sceneText || null : null,
          product_image: productImage || null,
          use_brand_logo: useBrandKit,
          image_model_id: imageModelId,
          image_aspect_ratio: imageAspectRatio,
          text_overlay: imageTextOverlay,
          image_prompt_override: imagePromptOverride.trim() || null,
        },
      });
      let a: AdOut = await api(`/ads/${res.ad_id}`);
      setCurrentAd(a);
      for (let i = 0; i < 60; i++) {
        if (a.status === "ready" || a.status === "posted" || a.status === "scheduled") { setStatus(a.error ? "failed" : "ready"); break; }
        if (a.status === "failed") { setStatus("failed"); break; }
        await new Promise((r) => setTimeout(r, 1500));
        a = await api(`/ads/${res.ad_id}`);
        setCurrentAd(a);
      }
      onUpdated();
    } catch (e: any) {
      setErr(e.message || "Could not generate the image");
      setStatus("failed");
    }
    refresh();
    setBusy(false);
  }

  const selectedModel = availableModels?.find((m) => m.id === imageModelId);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card/95 backdrop-blur-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur-xl">
          <div className="text-sm font-semibold text-foreground">{phaseLabel} — image</div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {imageUrl && previewPlatform && (
            <PostPreviewCard platform={previewPlatform} result={variant?.[currentAd.platforms[0]]} imageUrl={imageUrl} companyName={me?.company_name || ""} />
          )}

          {/* Model + aspect ratio */}
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1">Image model</label>
            <select value={imageModelId || ""} onChange={(e) => {
              const m = availableModels?.find((x) => x.id === e.target.value);
              setImageModelId(e.target.value);
              setImageAspectRatio(m?.aspect_ratios?.[0] ?? null);
            }} className="w-full rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
              {!availableModels && <option value="">Loading…</option>}
              {availableModels?.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.credits}cr</option>
              ))}
            </select>
            {selectedModel?.aspect_ratios && selectedModel.aspect_ratios.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-muted-foreground">Aspect ratio:</span>
                {selectedModel.aspect_ratios.map((r: string) => (
                  <button key={r} type="button" onClick={() => setImageAspectRatio(r)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${imageAspectRatio === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>{r}</button>
                ))}
              </div>
            )}
          </div>

          {/* Reference photo */}
          <div>
            <label className="text-xs font-semibold text-foreground">Product photo (optional)</label>
            {productImage ? (
              <div className="mt-2 flex items-center gap-3">
                <img src={productImage} alt="product" className="h-14 w-14 rounded-lg object-cover border border-border" />
                <button onClick={() => setProductImage(null)} className="text-xs text-destructive border border-destructive/40 rounded-full px-3 py-1">Remove</button>
              </div>
            ) : (
              <label className="mt-2 inline-block cursor-pointer rounded-full bg-gold-gradient px-4 py-1.5 text-xs font-semibold text-background">
                ⬆ Upload photo
                <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              </label>
            )}
          </div>

          {/* Theme reference */}
          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <label className="text-xs font-semibold text-foreground block mb-2">
              {productImage ? "Placement & surroundings" : "Describe how the AI image should look"}
            </label>
            <div className="flex gap-1.5 mb-2">
              {(["text", "image"] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setRefMode(m); setSelectedImageTheme(null); setSelectedTextStyle(null); setSelectedTextCategory(null); setImageTextOverlay(null); }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${refMode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                  {m === "text" ? "✏️ Text Theme" : "🖼 Image Theme"}
                </button>
              ))}
            </div>

            {refMode === "text" ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-muted-foreground block mb-0.5">Style</label>
                    <select value={selectedTextStyle ?? ""} onChange={(e) => {
                      const s = e.target.value || null;
                      setSelectedTextStyle(s);
                      const styleP = s ? textTheme.stylePrompts[s] || "" : "";
                      const catP = selectedTextCategory ? textTheme.categoryPrompts[selectedTextCategory] || "" : "";
                      const combined = [styleP, catP].filter(Boolean).join(" ");
                      if (combined) setSceneText(combined);
                    }} className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                      <option value="">None</option>
                      {textTheme.styleTags.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-muted-foreground block mb-0.5">Category</label>
                    <select value={selectedTextCategory ?? ""} onChange={(e) => {
                      const c = e.target.value || null;
                      setSelectedTextCategory(c);
                      const styleP = selectedTextStyle ? textTheme.stylePrompts[selectedTextStyle] || "" : "";
                      const catP = c ? textTheme.categoryPrompts[c] || "" : "";
                      const combined = [styleP, catP].filter(Boolean).join(" ");
                      if (combined) setSceneText(combined);
                    }} className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                      <option value="">None</option>
                      {textTheme.categoryTags.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {/* Text overlay fields */}
                <div className="space-y-1.5">
                  {STANDARD_TEXT_FIELDS.map((f) => (
                    <div key={f.key} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-[11px] text-muted-foreground">{f.label}</label>
                        <input value={themeFieldValues[f.key] ?? ""} onChange={(e) => {
                          const fv = { ...themeFieldValues, [f.key]: e.target.value };
                          setThemeFieldValues(fv);
                          setImageTextOverlay(buildOverlayText(STANDARD_TEXT_FIELDS, fv, themePositions));
                        }} placeholder={f.placeholder}
                          className="w-full rounded-lg border border-input bg-input/40 p-2 text-[11px] text-foreground focus:border-primary focus:outline-none" />
                      </div>
                      <div className="w-32">
                        <label className="text-[11px] text-muted-foreground">Position</label>
                        <select value={themePositions[f.key] ?? f.defaultPosition} onChange={(e) => {
                          const tp = { ...themePositions, [f.key]: e.target.value };
                          setThemePositions(tp);
                          setImageTextOverlay(buildOverlayText(STANDARD_TEXT_FIELDS, themeFieldValues, tp));
                        }} className="w-full rounded-lg border border-input bg-input/40 p-2 text-[11px] text-foreground focus:border-primary focus:outline-none">
                          {POSITION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                {selectedImageTheme ? (() => {
                  const theme = imageThemes.find((t) => t.id === selectedImageTheme)!;
                  return (
                    <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 mb-2">
                      <img src={theme.thumbnail} alt={theme.label} className="h-10 w-10 rounded object-cover shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold text-foreground">{theme.label}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{[...theme.styleTags, ...theme.categoryTags].join(" · ")}</div>
                      </div>
                      <button type="button" onClick={() => setShowThemeModal(true)} className="shrink-0 rounded-full border border-primary/50 px-2 py-1 text-[11px] text-primary">Change</button>
                    </div>
                  );
                })() : (
                  <button type="button" onClick={() => setShowThemeModal(true)}
                    className="w-full mb-2 rounded-lg border border-dashed border-primary/50 px-3 py-3 text-[11px] text-primary hover:bg-primary/5 flex items-center justify-center gap-1">
                    🖼 Browse image themes
                  </button>
                )}
                {selectedImageTheme && (() => {
                  const theme = imageThemes.find((t) => t.id === selectedImageTheme)!;
                  return theme.textFields.length > 0 ? (
                    <div className="space-y-1.5">
                      {theme.textFields.map((f) => (
                        <div key={f.key} className="flex gap-2 items-end">
                          <div className="flex-1">
                            <label className="text-[11px] text-muted-foreground">{f.label}</label>
                            <input value={themeFieldValues[f.key] ?? ""} onChange={(e) => {
                              const fv = { ...themeFieldValues, [f.key]: e.target.value };
                              setThemeFieldValues(fv);
                              setImageTextOverlay(buildOverlayText(theme.textFields, fv, themePositions));
                            }} placeholder={f.placeholder}
                              className="w-full rounded-lg border border-input bg-input/40 p-2 text-[11px] text-foreground focus:border-primary focus:outline-none" />
                          </div>
                          <div className="w-32">
                            <label className="text-[11px] text-muted-foreground">Position</label>
                            <select value={themePositions[f.key] ?? f.defaultPosition} onChange={(e) => {
                              const tp = { ...themePositions, [f.key]: e.target.value };
                              setThemePositions(tp);
                              setImageTextOverlay(buildOverlayText(theme.textFields, themeFieldValues, tp));
                            }} className="w-full rounded-lg border border-input bg-input/40 p-2 text-[11px] text-foreground focus:border-primary focus:outline-none">
                              {POSITION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-[11px] text-muted-foreground">No text overlay for this theme.</div>;
                })()}
              </div>
            )}

            <textarea value={sceneText} onChange={(e) => setSceneText(e.target.value)} rows={2}
              placeholder={productImage ? 'e.g. "on a wooden desk, morning light"' : 'e.g. "minimalist studio, soft top lighting"'}
              className="mt-2 w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
            {imageTextOverlay && (
              <div className="mt-1.5 text-[11px] text-muted-foreground bg-background/60 border border-border/60 rounded-lg p-2">
                <span className="font-semibold text-foreground">Text overlay: </span>{imageTextOverlay}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={useBrandKit} onChange={(e) => setUseBrandKit(e.target.checked)} />
            🎨 Include brand kit (logo + tagline)
          </label>

          <div>
            <label className="text-xs font-semibold text-foreground block mb-1">Image prompt override <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input value={imagePromptOverride} onChange={(e) => setImagePromptOverride(e.target.value)}
              placeholder="Override the AI's image prompt entirely…"
              className="w-full rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
          </div>

          {status === "generating" && <div className="text-xs text-amber-400">Generating…</div>}
          {status === "failed" && currentAd.error && <div className="text-xs text-amber-400">⚠ {currentAd.error}</div>}
          {err && <div className="text-xs text-destructive">{err}</div>}
        </div>

        <div className="sticky bottom-0 border-t border-border bg-card/95 px-5 py-4 backdrop-blur-xl">
          <button disabled={busy} onClick={generate} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
            {busy ? "Generating…" : imageUrl ? "Regenerate image" : "Generate image"}
          </button>
        </div>
      </div>

      {showThemeModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowThemeModal(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-foreground">Choose an image theme</div>
              <button type="button" onClick={() => setShowThemeModal(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
            </div>
            <ImageThemeGrid themes={imageThemes} selectedId={selectedImageTheme}
              onSelect={(t) => {
                setSelectedImageTheme(t.id);
                setSceneText(t.basePrompt);
                setThemeFieldValues({});
                setThemePositions({});
                setImageTextOverlay(null);
                setShowThemeModal(false);
              }} />
          </div>
        </div>
      )}
    </div>
  );
}
