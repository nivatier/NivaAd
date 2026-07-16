import { useState } from "react";

export type Platform = { id: string; name: string; color: string; tag: string; ratio: string };

export const PLATFORMS: Platform[] = [
  { id: "instagram", name: "Instagram", color: "#E1306C", tag: "IG", ratio: "Square 1:1" },
  { id: "facebook", name: "Facebook", color: "#1877F2", tag: "FB", ratio: "Landscape 1.91:1" },
  { id: "linkedin", name: "LinkedIn", color: "#0A66C2", tag: "IN", ratio: "Landscape 1.91:1" },
  { id: "x", name: "X (Twitter)", color: "#e7e9ea", tag: "𝕏", ratio: "Landscape 16:9" },
  { id: "tiktok", name: "TikTok", color: "#25F4EE", tag: "TT", ratio: "Vertical 9:16" },
];

// Mirrors the backend's default model tiers (services/billing.py / services/credits.py)
// purely to show an estimated cost before generating — the backend always computes
// and enforces the REAL cost server-side, so a mismatch here can't cause overcharging.
export function RetentionWarning({ retentionMonths, postRetentionMonths, className = "" }: { retentionMonths: number | null; postRetentionMonths: number | null; className?: string }) {
  if (retentionMonths == null && postRetentionMonths == null) return null;
  return (
    <div className={`rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive ${className}`}>
      ⚠ {retentionMonths != null && (
        <>This ad's media (image/video) is stored for {retentionMonths} month{retentionMonths !== 1 ? "s" : ""} from generation, then automatically removed as per platform policy. </>
      )}
      {postRetentionMonths != null && (
        <>The full post record is kept for up to {postRetentionMonths} month{postRetentionMonths !== 1 ? "s" : ""} ({Math.round(postRetentionMonths / 12 * 10) / 10} year{postRetentionMonths === 12 ? "" : "s"}), after which it's permanently deleted. </>
      )}
      Download a copy if you want to keep it longer.
    </div>
  );
}

export function estimateCost(outputs: { text: boolean; image: boolean; video: boolean }, format: string, variations: number, carouselCount: number = 1, textCredits: number = 1, imageCredits: number = 2, videoCredits: number = 5) {
  // textCredits/imageCredits/videoCredits should be the ACTUALLY
  // SELECTED model's real cost (from the dropdown) — defaults here are
  // just a fallback for before the model list has loaded, matching the
  // backend's own fallback in that same brief window.
  let cost = 0;
  if (outputs.text) cost += textCredits;
  if (outputs.image) cost += format === "carousel" ? imageCredits * Math.max(1, carouselCount) : imageCredits;
  if (outputs.video) cost += videoCredits;
  cost = Math.max(1, cost);
  if (variations === 3) cost *= 2;
  return cost;
}

export type PlatformResult = {
  caption?: string;
  hashtags?: string[];
  score?: number;
  tip?: string;
};

// The backend generates ONE shared image (or, for a carousel, a shared SET
// of images) per ad — not one per platform, to control cost — and stores
// it at the top level of the variant object, alongside each platform's own
// caption/score/tip, not nested inside them. image_url is always the first/
// primary image (for anything that only knows how to show one); image_urls
// is the full ordered carousel set when format === "carousel".
export type AdVariant = Record<string, PlatformResult> & { image_url?: string; image_urls?: string[]; video_url?: string };

const PLATFORM_ICONS: Record<string, string[]> = {
  instagram: ["♡ Like", "💬 Comment", "↗ Share", "🔖 Save"],
  facebook: ["👍 Like", "💬 Comment", "↗ Share"],
  linkedin: ["👍 Like", "💬 Comment", "🔁 Repost", "➤ Send"],
  x: ["💬 Reply", "🔁 Repost", "♡ Like", "↗ Share"],
  tiktok: ["♡ Like", "💬 Comment", "↗ Share", "🔖 Save"],
};

type MediaItem = { type: "image" | "video"; url: string };

export function CarouselMedia({ items, altPrefix }: { items: MediaItem[]; altPrefix: string }) {
  const [idx, setIdx] = useState(0);
  if (items.length === 0) {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">No media generated</div>;
  }
  const current = items[idx];
  return (
    <div className="relative h-full w-full">
      {current.type === "video" ? (
        <video key={current.url} src={current.url} controls playsInline className="h-full w-full object-cover" />
      ) : (
        <img src={current.url} alt={`${altPrefix} ${idx + 1}`} className="h-full w-full object-cover" />
      )}
      {items.length > 1 && (
        <>
          <button onClick={() => setIdx((i) => (i - 1 + items.length) % items.length)} className="absolute left-1.5 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-xs text-white hover:bg-black/70">‹</button>
          <button onClick={() => setIdx((i) => (i + 1) % items.length)} className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-xs text-white hover:bg-black/70">›</button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            {items.map((it, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === idx ? "bg-white" : "bg-white/40"} ${it.type === "video" ? "ring-1 ring-white/70" : ""}`} />)}
          </div>
          <span className="absolute top-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">{current.type === "video" ? "🎬 " : ""}{idx + 1}/{items.length}</span>
        </>
      )}
    </div>
  );
}

/** Combines an ad's image(s) and video into ONE ordered media list —
 * images first, video last — so when both were generated (image + video
 * both ticked, without carousel format), both are actually visible via
 * the same swipe navigation, instead of one silently hiding the other. */
export function buildMediaItems(imageUrl: string | undefined, imageUrls: string[] | undefined, videoUrl: string | undefined): MediaItem[] {
  const items: MediaItem[] = [];
  const imgs = imageUrls && imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : [];
  for (const u of imgs) items.push({ type: "image", url: u });
  if (videoUrl) items.push({ type: "video", url: videoUrl });
  return items;
}

export function PostPreviewCard({
  platform,
  result,
  imageUrl,
  imageUrls,
  videoUrl,
  companyName,
}: {
  platform: Platform;
  result: PlatformResult | undefined;
  imageUrl: string | undefined;
  imageUrls?: string[];
  videoUrl?: string;
  companyName: string;
}) {
  const media = buildMediaItems(imageUrl, imageUrls, videoUrl);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-950" style={{ background: platform.color }}>{platform.tag}</span>
          <span className="text-sm font-semibold text-foreground">{platform.name} preview</span>
        </div>
      </div>
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gold-gradient text-sm font-bold text-background">{(companyName || "A").charAt(0).toUpperCase()}</span>
          <div>
            <div className="text-sm font-semibold text-foreground">{companyName || "Your Company"}</div>
            <div className="text-[11px] text-muted-foreground">Sponsored · {platform.ratio}</div>
          </div>
          <span className="ml-auto text-muted-foreground">⋯</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60" style={{ aspectRatio: platform.id === "tiktok" ? "9/16" : "1/1" }}>
          <CarouselMedia items={media} altPrefix={platform.name} />
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          {(PLATFORM_ICONS[platform.id] || ["♡ Like", "💬 Comment", "↗ Share"]).map((ic) => <span key={ic}>{ic}</span>)}
        </div>
        <div className="mt-3 text-sm text-foreground"><span className="font-semibold">{companyName || "Your Company"}</span> {result?.caption}</div>
        <div className="mt-2 flex flex-wrap gap-1">{(result?.hashtags || []).map((h) => <span key={h} className="text-xs text-primary">{h}</span>)}</div>
        <div className="mt-2 text-[11px] text-muted-foreground">Just now</div>
      </div>
    </div>
  );
}

export function PostPreviewModal({
  platform,
  result,
  imageUrl,
  imageUrls,
  videoUrl,
  companyName,
  onClose,
}: {
  platform: Platform;
  result: PlatformResult | undefined;
  imageUrl: string | undefined;
  imageUrls?: string[];
  videoUrl?: string;
  companyName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} className="text-lg leading-none text-white/80 hover:text-white">✕</button>
        </div>
        <PostPreviewCard platform={platform} result={result} imageUrl={imageUrl} imageUrls={imageUrls} videoUrl={videoUrl} companyName={companyName} />
      </div>
    </div>
  );
}

/** Text-only version of PlatformPreviewCard, for the 3-column Create Ad
 * results layout (Text | Image | Video side by side, not stacked) —
 * image/video are shared across every platform (only the caption
 * differs), so showing media once per output type instead of once per
 * platform card removes real redundancy. The "Preview" button still
 * shows the full post (text + media combined via PostPreviewModal), so
 * you can always see exactly what a platform's post will actually look
 * like even though editing is now split by output type. */
export function PlatformPreviewCard({
  platform,
  result,
  imageUrl,
  imageUrls,
  videoUrl,
  companyName,
  posted,
  onPost,
  onEditCaption,
}: {
  platform: Platform;
  result: PlatformResult | undefined;
  imageUrl: string | undefined;
  imageUrls?: string[];
  videoUrl?: string;
  companyName: string;
  posted: boolean;
  onPost: () => void;
  onEditCaption: (text: string) => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const score = result?.score;
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-950" style={{ background: platform.color }}>{platform.tag}</span>
          <span className="text-sm font-semibold text-foreground">{platform.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {score != null && (
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 border ${score >= 80 ? "text-emerald-400 border-emerald-500/40" : score >= 65 ? "text-amber-400 border-amber-500/40" : "text-rose-400 border-rose-500/40"}`}>
              ◎ {score}/100
            </span>
          )}
          <button onClick={() => setShowPreview(true)} className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary">👁 Preview</button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border/60 h-40 bg-background/60">
        <CarouselMedia items={buildMediaItems(imageUrl, imageUrls, videoUrl)} altPrefix={platform.name} />
      </div>

      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full text-[10px] flex items-center justify-center bg-gold-gradient text-background font-bold">{(companyName || "A").charAt(0).toUpperCase()}</span>
        <span className="text-xs font-semibold text-foreground">{companyName || "Your company"}</span>
      </div>

      <textarea
        value={result?.caption || ""}
        onChange={(e) => onEditCaption(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-input bg-input/40 p-2.5 text-xs text-foreground resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex flex-wrap gap-1">
        {(result?.hashtags || []).map((h) => <span key={h} className="text-[10px] text-primary">{h}</span>)}
      </div>
      {result?.tip && (
        <div className="text-[10px] text-muted-foreground bg-background/60 border border-border rounded-lg px-2 py-1.5">💡 {result.tip}</div>
      )}

      {posted ? (
        <div className="text-center text-xs text-emerald-400 border border-emerald-500/40 bg-emerald-500/5 rounded-full py-2">✓ Posted to {platform.name}</div>
      ) : (
        <button onClick={onPost} className="text-xs font-semibold rounded-full py-2 bg-gold-gradient text-background">Post to {platform.name}</button>
      )}
      {showPreview && (
        <PostPreviewModal platform={platform} result={result} imageUrl={imageUrl} imageUrls={imageUrls} videoUrl={videoUrl} companyName={companyName} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}

export function PromptConfirmModal({
  textPrompt,
  setTextPrompt,
  imagePrompt,
  setImagePrompt,
  videoPrompt,
  setVideoPrompt,
  hasImage,
  isCarousel,
  hasVideo,
  isMultiShot,
  cost,
  busy,
  onBack,
  onConfirm,
  retentionMonths,
  postRetentionMonths,
}: {
  textPrompt: string;
  setTextPrompt: (v: string) => void;
  imagePrompt: string;
  setImagePrompt: (v: string) => void;
  videoPrompt?: string;
  setVideoPrompt?: (v: string) => void;
  hasImage: boolean;
  isCarousel?: boolean;
  hasVideo?: boolean;
  isMultiShot?: boolean;
  cost: number;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
  retentionMonths?: number | null;
  postRetentionMonths?: number | null;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="glow-border w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card/95 backdrop-blur-xl">
        <div className="sticky top-0 bg-card/95 backdrop-blur-xl border-b border-border px-5 py-4">
          <div className="text-sm font-semibold text-foreground">Confirm what gets sent to the AI</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">💡 This is the exact text the backend will send. Edit either box if anything looks wrong, then confirm.</div>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <label className="text-xs font-semibold text-primary">📝 Ad copy prompt</label>
            <textarea
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              className="mt-2 w-full h-40 rounded-lg border border-input bg-background/60 p-3 text-xs text-foreground font-mono resize-y focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {hasImage && (
            isCarousel ? (
              <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
                🎠 This is a carousel — each image has its own prompt, built from the per-image descriptions you set in step 2, not a single editable prompt here. Go back to change them.
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-primary">🖼️ Image generation prompt</label>
                <textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  className="mt-2 w-full h-40 rounded-lg border border-input bg-background/60 p-3 text-xs text-foreground font-mono resize-y focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )
          )}
          {hasVideo && (
            <div>
              <label className="text-xs font-semibold text-primary">🎬 Video generation prompt{isMultiShot ? " (combined, after prompt review)" : ""}</label>
              {isMultiShot && (
                <p className="mt-1 text-[11px] text-muted-foreground">This already reflects your shots being reviewed and improved (if a review model is configured) — edit freely below; going back to Step 2 to change individual shots will re-run review and replace this.</p>
              )}
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt?.(e.target.value)}
                className="mt-2 w-full h-40 rounded-lg border border-input bg-background/60 p-3 text-xs text-foreground font-mono resize-y focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
          <RetentionWarning retentionMonths={retentionMonths ?? null} postRetentionMonths={postRetentionMonths ?? null} />
        </div>
        <div className="sticky bottom-0 bg-card/95 backdrop-blur-xl border-t border-border px-5 py-4 flex items-center gap-3">
          <button onClick={onBack} disabled={busy} className="rounded-full border border-border px-5 py-2.5 text-sm text-muted-foreground hover:border-primary/40 disabled:opacity-50">← Back to edit inputs</button>
          <button onClick={onConfirm} disabled={busy} className="ml-auto rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
            {busy ? "Generating…" : `✅ Confirm & Generate (${cost} credit${cost > 1 ? "s" : ""})`}
          </button>
        </div>
      </div>
    </div>
  );
}
