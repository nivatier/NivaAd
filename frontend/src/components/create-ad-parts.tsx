import { useState, useCallback } from "react";
import type React from "react";

export type Platform = { id: string; name: string; color: string; tag: string; ratio: string };

export const PLATFORMS: Platform[] = [
  { id: "instagram",  name: "Instagram",   color: "#E1306C", tag: "IG", ratio: "Square 1:1" },
  { id: "facebook",   name: "Facebook",    color: "#1877F2", tag: "FB", ratio: "Landscape 1.91:1" },
  { id: "linkedin",   name: "LinkedIn",    color: "#0A66C2", tag: "IN", ratio: "Landscape 1.91:1" },
  { id: "x",          name: "X (Twitter)", color: "#e7e9ea", tag: "𝕏",  ratio: "Landscape 16:9" },
  { id: "tiktok",     name: "TikTok",      color: "#25F4EE", tag: "TT", ratio: "Vertical 9:16" },
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

export function estimateCost(outputs: { text: boolean; image: boolean; video: boolean }, format: string, variations: number, carouselCount: number = 1, textCredits: number = 0.25, imageCredits: number = 1, videoCredits: number = 5) {
  // Variations do NOT multiply cost:
  // - Text: one API call returning all 3 variants in one response
  // - Image: one generation shared across all variants
  // - Video: one generation shared across all variants
  // Only carousel scales (N slides = N real image calls).
  let cost = 0;
  if (outputs.text) cost += textCredits;
  if (outputs.image) cost += format === "carousel" ? imageCredits * Math.max(1, carouselCount) : imageCredits;
  if (outputs.video) cost += videoCredits;
  cost = Math.max(0.25, cost);
  // Round to nearest 0.25 to match backend
  return Math.ceil(cost * 4 - 1e-9) / 4;
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

export function CarouselMedia({
  items,
  altPrefix,
  onVideoDimensions,
}: {
  items: MediaItem[];
  altPrefix: string;
  onVideoDimensions?: (w: number, h: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  if (items.length === 0) {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">No media generated</div>;
  }
  const current = items[idx];
  return (
    <div className="relative h-full w-full">
      {current.type === "video" ? (
        <video
          key={current.url}
          src={current.url}
          controls
          playsInline
          className="h-full w-full object-contain"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight && onVideoDimensions) {
              onVideoDimensions(v.videoWidth, v.videoHeight);
            }
          }}
        />
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
  // Detected from the video's real pixel dimensions once metadata loads.
  // Falls back to the platform-based default so images keep their expected ratio.
  const [detectedRatio, setDetectedRatio] = useState<string | null>(null);
  const handleVideoDimensions = useCallback((w: number, h: number) => {
    setDetectedRatio(`${w}/${h}`);
  }, []);

  // Parse the platform's ratio string (e.g. "Landscape 1.91:1", "Vertical 9:16", "Square 1:1")
  // into a CSS aspect-ratio value (e.g. "1.91/1", "9/16", "1/1").
  // For videos, the real pixel dimensions override this once metadata loads.
  const platformRatioCss = (() => {
    // Extract the numeric ratio from strings like "Landscape 1.91:1" or "9:16"
    const match = platform.ratio.match(/([\d.]+):([\d.]+)/);
    if (match) return `${match[1]}/${match[2]}`;
    return "1/1";
  })();
  const defaultRatio = platformRatioCss;
  const containerRatio = detectedRatio ?? defaultRatio;

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
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60" style={{ aspectRatio: containerRatio }}>
          <CarouselMedia items={media} altPrefix={platform.name} onVideoDimensions={handleVideoDimensions} />
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

/** Brand kit shape — just the fields we need for the posted view overlay. */
export type BrandKitPreview = {
  logo_url: string | null;
  logo_placement: string;  // "top-left" | "top-right" | "bottom-left" | "bottom-right"
  primary_color: string;
};

/** Maps a placement string to CSS positioning on the overlay container. */
function placementStyle(placement: string): React.CSSProperties {
  const base: React.CSSProperties = { position: "absolute", margin: "8px" };
  if (placement === "top-left")     return { ...base, top: 0, left: 0 };
  if (placement === "top-right")    return { ...base, top: 0, right: 0 };
  if (placement === "bottom-left")  return { ...base, bottom: 0, left: 0 };
  return { ...base, bottom: 0, right: 0 }; // bottom-right default
}

/**
 * "Posted view" modal — shows the platform-specific reframed image/video
 * (platform_image_urls / platform_video_urls from the variant) with the
 * brand logo composited at its configured placement position, exactly as
 * it will look when posted. Falls back to the master image/video when no
 * platform-specific version was generated (e.g. brand kit wasn't set up
 * at generation time or the model doesn't produce per-platform crops).
 */
export function PostedViewModal({
  platform,
  variant,
  brandKit,
  onClose,
}: {
  platform: Platform;
  variant: Record<string, any>;
  brandKit: BrandKitPreview | null;
  onClose: () => void;
}) {
  const [detectedRatio, setDetectedRatio] = useState<string | null>(null);

  // Prefer the platform-specific reframed media; fall back to master
  const postedImageUrl: string | undefined =
    variant?.platform_image_urls?.[platform.id] ?? variant?.image_url;
  const postedVideoUrl: string | undefined =
    variant?.platform_video_urls?.[platform.id] ?? variant?.video_url;
  const hasMedia = !!(postedImageUrl || postedVideoUrl);

  const containerRatio = detectedRatio ?? (platform.id === "tiktok" ? "9/16" : "1/1");
  const isPerPlatform =
    !!(variant?.platform_image_urls?.[platform.id] || variant?.platform_video_urls?.[platform.id]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-950" style={{ background: platform.color }}>{platform.tag}</span>
            <span className="text-sm font-semibold text-white">{platform.name} — posted view</span>
          </div>
          <button onClick={onClose} className="text-lg leading-none text-white/70 hover:text-white">✕</button>
        </div>

        {/* Media with logo overlay */}
        <div className="relative overflow-hidden rounded-2xl bg-black border border-white/10" style={{ aspectRatio: containerRatio }}>
          {hasMedia ? (
            postedVideoUrl ? (
              <video
                key={postedVideoUrl}
                src={postedVideoUrl}
                controls
                playsInline
                className="h-full w-full object-contain"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setDetectedRatio(`${v.videoWidth}/${v.videoHeight}`);
                }}
              />
            ) : (
              <img src={postedImageUrl} alt={`${platform.name} posted view`} className="h-full w-full object-contain" />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/40">No media</div>
          )}

          {/* Brand logo overlay */}
          {brandKit?.logo_url && (
            <div style={placementStyle(brandKit.logo_placement)}>
              <img
                src={brandKit.logo_url}
                alt="Brand logo"
                className="h-8 w-auto max-w-[80px] rounded object-contain"
                style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))" }}
              />
            </div>
          )}

          {/* Brand colour accent bar */}
          {brandKit?.primary_color && (
            <div
              className="absolute bottom-0 left-0 right-0 h-1"
              style={{ background: brandKit.primary_color, opacity: 0.85 }}
            />
          )}
        </div>

        {/* Info strip */}
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60 space-y-0.5">
          <div>
            {isPerPlatform
              ? <span className="text-emerald-400">✓ Platform-specific crop</span>
              : <span className="text-amber-400/80">⚠ Master image (no platform crop generated)</span>}
          </div>
          {brandKit?.logo_url
            ? <div>Logo: <span className="text-white/80">{brandKit.logo_placement}</span></div>
            : <div className="text-white/40">No brand logo configured</div>}
          {brandKit?.primary_color && (
            <div className="flex items-center gap-1.5">
              Accent:
              <span className="inline-block h-3 w-3 rounded-full border border-white/20" style={{ background: brandKit.primary_color }} />
              <span className="text-white/80">{brandKit.primary_color}</span>
            </div>
          )}
        </div>
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

/** Full-screen overlay that appears when posting to a platform —
 * shows live phase (sending → platform processing → success/error)
 * and auto-dismisses 2 s after success. */
function PostingStatusModal({
  platform,
  phase,
  error,
  onClose,
}: {
  platform: Platform;
  phase: "sending" | "waiting" | "success" | "error";
  error: string;
  onClose: () => void;
}) {
  const steps: { key: typeof phase; label: string }[] = [
    { key: "sending",  label: "Sending to server" },
    { key: "waiting",  label: `Publishing to ${platform.name}` },
    { key: "success",  label: "Posted successfully!" },
  ];
  const currentIdx = phase === "error"
    ? steps.findIndex((s) => s.key === "waiting")
    : steps.findIndex((s) => s.key === phase);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-[340px] rounded-2xl border border-border bg-card p-6 shadow-2xl"
        style={{ boxShadow: "0 0 0 1px oklch(1 0 0 / 0.08), inset 0 1px 0 oklch(1 0 0 / 0.12)" }}
      >
        {/* Platform badge */}
        <div className="flex items-center gap-3 mb-5">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-slate-950 shrink-0"
            style={{ background: platform.color }}
          >
            {platform.tag}
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {phase === "success" ? "Posted!" : phase === "error" ? "Post failed" : "Posting…"}
            </div>
            <div className="text-[11px] text-muted-foreground">{platform.name}</div>
          </div>
          {(phase === "success" || phase === "error") && (
            <button
              onClick={onClose}
              className="ml-auto text-muted-foreground hover:text-foreground text-lg leading-none"
            >✕</button>
          )}
        </div>

        {/* Step list */}
        <div className="space-y-3">
          {steps.map((step, i) => {
            const isDone = i < currentIdx || phase === "success";
            const isActive = i === currentIdx && phase !== "success" && phase !== "error";
            const isError = phase === "error" && i === currentIdx;
            return (
              <div key={step.key} className="flex items-center gap-3">
                {/* Icon */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold transition-all ${
                  isDone
                    ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-400"
                    : isError
                    ? "bg-destructive/20 border border-destructive/50 text-destructive"
                    : isActive
                    ? "bg-primary/20 border border-primary/50"
                    : "bg-muted/20 border border-border text-muted-foreground/40"
                }`}>
                  {isDone ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isError ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : isActive ? (
                    <svg className="w-3 h-3 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <span className="text-[10px]">{i + 1}</span>
                  )}
                </div>
                {/* Label */}
                <span className={`text-xs transition-all ${
                  isDone ? "text-emerald-400" :
                  isError ? "text-destructive" :
                  isActive ? "text-foreground font-medium" :
                  "text-muted-foreground/40"
                }`}>
                  {i === currentIdx && phase === "error" ? `Failed: ${error || "Unknown error"}` : step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Success tick big */}
        {phase === "success" && (
          <div className="mt-5 flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-xs text-emerald-400 font-medium">Closing in a moment…</span>
          </div>
        )}

        {/* Error retry */}
        {phase === "error" && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:border-primary/40"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
  variant,
  brandKit,
  adId,
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
  variant?: Record<string, any>;
  brandKit?: BrandKitPreview | null;
  adId?: string | null;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [detectedRatio, setDetectedRatio] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [postPhase, setPostPhase] = useState<"sending" | "waiting" | "success" | "error">("sending");
  const [postError, setPostError] = useState("");
  const handleVideoDimensions = useCallback((w: number, h: number) => {
    setDetectedRatio(`${w}/${h}`);
  }, []);
  const score = result?.score;
  const thumbStyle: React.CSSProperties = detectedRatio
    ? { aspectRatio: detectedRatio, maxHeight: "12rem" }
    : { height: "10rem" };

  async function handlePost() {
    setPosting(true);
    setPostError("");
    setPostPhase("sending");
    setPostModalOpen(true);
    onPost(); // optimistic update in parent
    if (adId) {
      try {
        const { api } = await import("@/lib/api");
        const { job_id } = await api(`/ads/${adId}/post`, { method: "POST", body: { platforms: [platform.id] } });
        setPostPhase("waiting");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const job = await api(`/ads/${adId}/post-status/${job_id}`);
          if (job.status === "done" || job.status === "failed") {
            if (job.status === "failed") {
              const errMsg = job.failed?.[platform.id] || job.error || "Post failed";
              setPostError(errMsg);
              setPostPhase("error");
            } else {
              setPostPhase("success");
              setTimeout(() => setPostModalOpen(false), 2000);
            }
            break;
          }
        }
      } catch (e: any) {
        setPostError(e.message || "Post failed");
        setPostPhase("error");
      }
    } else {
      setPostPhase("success");
      setTimeout(() => setPostModalOpen(false), 2000);
    }
    setPosting(false);
  }

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
          {variant && (imageUrl || videoUrl) && (
            <button onClick={() => setShowPreview(true)} className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary">👁 Preview</button>
          )}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-background/60 w-full" style={thumbStyle}>
        <CarouselMedia items={buildMediaItems(imageUrl, imageUrls, videoUrl)} altPrefix={platform.name} onVideoDimensions={handleVideoDimensions} />
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
        <button onClick={handlePost} disabled={posting} className="text-xs font-semibold rounded-full py-2 bg-gold-gradient text-background disabled:opacity-60">
          {posting ? "Posting…" : `Post to ${platform.name}`}
        </button>
      )}
      {showPreview && variant && (
        <PostedViewModal platform={platform} variant={variant} brandKit={brandKit ?? null} onClose={() => setShowPreview(false)} />
      )}
      {postModalOpen && (
        <PostingStatusModal
          platform={platform}
          phase={postPhase}
          error={postError}
          onClose={() => setPostModalOpen(false)}
        />
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
            {busy ? "Generating…" : `✅ Confirm & Generate (${cost} credit${cost === 1 ? "" : "s"})`}
          </button>
        </div>
      </div>
    </div>
  );
}
