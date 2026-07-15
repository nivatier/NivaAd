import { useState } from "react";
import { PLATFORMS, PostPreviewModal } from "@/components/create-ad-parts";
import { api, type AdOut } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

type Phase = { caption: string; date: string };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function CampaignGenerateModal({
  campaignId, phaseKey, phaseLabel, phase, onClose, onScheduled,
}: {
  campaignId: string; phaseKey: string; phaseLabel: string; phase: Phase;
  onClose: () => void; onScheduled: () => void;
}) {
  const { me, refresh } = useAuth();

  // Input form state
  const [caption, setCaption] = useState(phase.caption);
  const [selected, setSelected] = useState<Record<string, boolean>>({ instagram: true, facebook: true });
  const [wantImage, setWantImage] = useState(true);
  const [useBrandKit, setUseBrandKit] = useState(false);
  const [productImage, setProductImage] = useState<string | null>(null);
  const [sceneText, setSceneText] = useState("");

  // Generation state
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [createdAd, setCreatedAd] = useState<AdOut | null>(null);
  const [imageStatus, setImageStatus] = useState<"idle" | "generating" | "ready" | "failed" | "timeout">("idle");
  const [showPreview, setShowPreview] = useState<string | null>(null);

  // Schedule state
  const [scheduleAt, setScheduleAt] = useState(`${phase.date}T10:00`);
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);

  const chosen = PLATFORMS.filter((p) => selected[p.id]);
  const variant = createdAd?.results?.variants?.[0];
  const imageUrl: string | undefined = variant?.image_url;

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setProductImage(await fileToDataUrl(f));
  }

  async function generate() {
    if (chosen.length === 0 || !caption.trim()) return;
    setBusy(true); setErr(""); setCreatedAd(null); setScheduled(false); setImageStatus("idle");
    try {
      const res = await api(`/campaigns/${campaignId}/generate-ad`, {
        method: "POST",
        body: {
          phase: phaseKey,
          platforms: chosen.map((p) => p.id),
          generate_image: wantImage,
          caption_override: caption,
          env: productImage ? sceneText || null : null,
          image_scene: !productImage ? sceneText || null : null,
          product_image: productImage || null,
          use_brand_logo: useBrandKit,
        },
      });
      let ad: AdOut = await api(`/ads/${res.ad_id}`);
      setCreatedAd(ad);
      if (wantImage && res.job_id) {
        setImageStatus("generating");
        let settled = false;
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          ad = await api(`/ads/${res.ad_id}`);
          setCreatedAd(ad);
          if (ad.status === "ready" || ad.status === "posted") {
            setImageStatus(ad.error ? "failed" : "ready");
            settled = true;
            break;
          }
          if (ad.status === "failed") { setImageStatus("failed"); settled = true; break; }
        }
        if (!settled) {
          setImageStatus("timeout");
          setErr("Image generation is taking longer than expected. Check My Ads shortly — the copy is saved either way.");
        }
      }
    } catch (e: any) {
      setErr(e.message || "Could not generate the ad");
    }
    refresh();
    setBusy(false);
  }

  async function schedule() {
    if (!createdAd) return;
    setScheduling(true); setErr("");
    try {
      await api("/schedule", { method: "POST", body: { ad_id: createdAd.id, platforms: chosen.map((p) => p.id), scheduled_at: scheduleAt } });
      setScheduled(true);
      onScheduled();
    } catch (e: any) {
      setErr(e.message || "Could not schedule");
    }
    setScheduling(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-border bg-card/95 backdrop-blur-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur-xl">
          <div>
            <div className="text-sm font-semibold text-foreground">Generate ad — {phaseLabel}</div>
            <div className="text-[11px] text-muted-foreground">Edit the copy, add a photo, and describe how the image should look — same freedom as Create Ad.</div>
          </div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {!createdAd ? (
          <div className="p-5 space-y-5">
            <div>
              <label className="text-xs font-semibold text-foreground">Ad copy</label>
              <textarea
                value={caption} onChange={(e) => setCaption(e.target.value)} rows={4}
                className="mt-2 w-full rounded-lg border border-input bg-input/40 p-3 text-sm text-foreground resize-y focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Pre-filled with the phase's original wording — edit freely, or leave as-is.</p>
            </div>

            <div>
              <div className="text-xs font-semibold text-foreground mb-2">Platforms</div>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button key={p.id} onClick={() => setSelected((s) => ({ ...s, [p.id]: !s[p.id] }))}
                    className={`rounded-full border px-3 py-1.5 text-xs ${selected[p.id] ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {selected[p.id] ? "☑" : "☐"} {p.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={wantImage} onChange={(e) => setWantImage(e.target.checked)} />
              Include AI image
            </label>

            {wantImage && (
              <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-foreground">Product photo (optional)</label>
                  {productImage ? (
                    <div className="mt-2 flex items-center gap-3">
                      <img src={productImage} alt="product" className="h-14 w-14 rounded-lg object-cover border border-border" />
                      <button onClick={() => setProductImage(null)} className="text-xs text-destructive border border-destructive/40 rounded-full px-3 py-1">Remove photo</button>
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
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {productImage ? "💡 e.g. \"on a wooden desk, morning light\"" : "💡 e.g. \"minimalist studio, soft top lighting\" — leave blank for a sensible default"}
                  </p>
                  <textarea
                    value={sceneText} onChange={(e) => setSceneText(e.target.value)} rows={2}
                    className="mt-2 w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={useBrandKit} onChange={(e) => setUseBrandKit(e.target.checked)} />
              🎨 Include brand kit (logo on the image + tagline in the caption)
            </label>

            {err && <div className="text-xs text-destructive">{err}</div>}
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-xs text-emerald-400">
                ✓ Ad created for {chosen.map((p) => p.name).join(", ")}
                {wantImage && imageStatus === "generating" && " — generating image…"}
                {wantImage && imageStatus === "ready" && " — image ready"}
                {wantImage && imageStatus === "timeout" && " — image is taking longer than expected"}
              </div>
              {wantImage && imageStatus === "failed" && createdAd.error && (
                <div className="mt-1 text-[11px] text-amber-400">⚠ {createdAd.error}</div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {chosen.map((p) => (
                  <button key={p.id} onClick={() => setShowPreview(p.id)}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary">
                    👁 Preview {p.name}
                  </button>
                ))}
              </div>
            </div>

            {!scheduled ? (
              <div className="flex flex-wrap items-center gap-2">
                <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                  className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
                <button disabled={scheduling} onClick={schedule} className="rounded-full border border-secondary/50 px-3 py-1.5 text-xs text-secondary disabled:opacity-50">
                  {scheduling ? "Scheduling…" : "🗓 Schedule this ad"}
                </button>
                <span className="text-[10px] text-muted-foreground">or find it in My Ads to post manually</span>
              </div>
            ) : (
              <div className="text-xs text-secondary">🗓 Scheduled for {new Date(scheduleAt).toLocaleString()}</div>
            )}
          </div>
        )}

        <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-card/95 px-5 py-4 backdrop-blur-xl">
          {!createdAd ? (
            <button disabled={busy || chosen.length === 0 || !caption.trim()} onClick={generate}
              className="ml-auto rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
              {busy ? "Generating…" : "Generate ad"}
            </button>
          ) : (
            <button onClick={onClose} className="ml-auto rounded-full border border-border px-6 py-2.5 text-sm text-muted-foreground hover:border-primary/40">
              Done
            </button>
          )}
        </div>
      </div>

      {showPreview && variant && (
        <PostPreviewModal
          platform={PLATFORMS.find((p) => p.id === showPreview)!}
          result={variant[showPreview]}
          imageUrl={imageUrl}
          companyName={me?.company_name || ""}
          onClose={() => setShowPreview(null)}
        />
      )}
    </div>
  );
}
