import { useState } from "react";
import { PLATFORMS, PostPreviewCard } from "@/components/create-ad-parts";
import { api, type AdOut } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

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

  const variant = currentAd.results?.variants?.[0];
  const imageUrl: string | undefined = variant?.image_url;
  const previewPlatform = PLATFORMS.find((p) => p.id === currentAd.platforms[0]);

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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-md max-h-[88vh] overflow-y-auto rounded-2xl border border-border bg-card/95 backdrop-blur-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur-xl">
          <div className="text-sm font-semibold text-foreground">{phaseLabel} — image</div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {imageUrl && previewPlatform && (
            <PostPreviewCard platform={previewPlatform} result={variant?.[currentAd.platforms[0]]} imageUrl={imageUrl} companyName={me?.company_name || ""} />
          )}

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

          <div>
            <label className="text-xs font-semibold text-foreground">
              {productImage ? "Placement & surroundings" : "Describe how the AI image should look"}
            </label>
            <textarea
              value={sceneText} onChange={(e) => setSceneText(e.target.value)} rows={2}
              placeholder={productImage ? 'e.g. "on a wooden desk, morning light"' : 'e.g. "minimalist studio, soft top lighting"'}
              className="mt-2 w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={useBrandKit} onChange={(e) => setUseBrandKit(e.target.checked)} />
            🎨 Include brand kit (logo on the image + tagline in the caption)
          </label>

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
    </div>
  );
}
