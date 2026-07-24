import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell, Panel, Field, Input, Chip } from "@/components/app-shell";
import { PLATFORMS, estimateCost, PlatformPreviewCard, PromptConfirmModal, type AdVariant } from "@/components/create-ad-parts";

/** Shown in the preview when no platform is connected/selected. */
const DEFAULT_PLATFORM = { id: "default", name: "Default", tag: "📄", color: "#6366f1" };
import { useConnectedPlatforms } from "@/hooks/use-connected-platforms";
import { CAROUSEL_MAX_IMAGES, CAROUSEL_MIN_IMAGES, MAX_VIDEO_SHOTS } from "@/lib/constants";
import { TimezoneSelect } from "@/components/timezone-picker";
import { detectedTimeZone, zonedWallTimeToUtcNaiveIso } from "@/lib/timezone";
import { api, type AvailableModelsOut } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { NovaHint } from "@/components/nova-hint";
import { RequirementChecklist } from "@/components/requirement-checklist";
import { ImageThemeGrid, VideoThemeGrid, mapImageTheme, type ImageTheme, type ImageThemeField, type VideoTheme } from "@/components/theme-gallery-grid";

export const Route = createFileRoute("/app/")({
  component: CreateAd,
  head: () => ({ meta: [{ title: "Create Ad — NivaSpark" }] }),
});

const STEPS = ["Setup", "Generate", "Preview & Post"];
const GOALS = ["Drive sales", "Product launch", "Brand awareness", "Get signups"];
const TONES = ["Professional", "Fun", "Luxury", "Minimal"];
const POSITION_OPTIONS = [
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];

// Same three fields the backend now guarantees on every Image Theme
// Reference gallery entry (services/themes.py STANDARD_TEXT_FIELDS) —
// Text Theme Reference doesn't have a gallery entry to carry these, so
// they're defined here directly and shared by both modes.
const STANDARD_TEXT_FIELDS: ImageThemeField[] = [
  {
    key: "headline", label: "Headline", placeholder: "e.g. MEGA SALE", defaultPosition: "top-left",
    styleHint: "large bold advertising headline typography, thick sans-serif or bold script font as commonly used on ad banners, strong color contrast against the background so it pops, clean crisp edges, no clutter behind it",
  },
  {
    key: "badge", label: "Discount badge", placeholder: "e.g. UP TO 50% OFF", defaultPosition: "middle-right",
    styleHint: "styled like a real promotional discount sticker/badge — bold circular or starburst badge shape with a solid contrasting fill color, bold white or dark numerals, sized to grab attention like a sale-tag callout",
  },
  {
    key: "body", label: "Body / about text", placeholder: "e.g. short brand or offer description", defaultPosition: "bottom-left",
    styleHint: "smaller clean sans-serif supporting/caption text, standard ad-copy weight (not bold), legible against the background, laid out like a short marketing tagline under a headline",
  },
];

type TextStylePreset = { id: string; label: string; fontStyle: string; textColor: string; accentColor: string; size: string };

const SIZE_DESCRIPTIONS: Record<string, string> = { small: "small, subtle", medium: "medium-sized, clearly legible", large: "large, attention-grabbing", xlarge: "extra-large, dominant" };

/** Mirrors the backend's build_style_phrase (services/themes.py) — turns a
 * developer-defined preset into the descriptive phrase folded into the
 * field's overlay instruction. Empty/"standard" preset returns "" so the
 * field's own built-in styleHint is used unchanged (original behavior). */
function buildStylePhrase(preset: TextStylePreset | undefined): string {
  if (!preset || (!preset.fontStyle && !preset.textColor)) return "";
  const parts: string[] = [];
  const size = SIZE_DESCRIPTIONS[preset.size] || "";
  if (size) parts.push(size);
  if (preset.fontStyle) parts.push(preset.fontStyle.toLowerCase());
  const phrase = parts.join(" ") || "styled";
  const colorBits: string[] = [];
  if (preset.textColor) colorBits.push(`text color ${preset.textColor}`);
  if (preset.accentColor) colorBits.push(`accent/outline/background color ${preset.accentColor} for contrast`);
  const colorPhrase = colorBits.length ? `, ${colorBits.join(", ")}` : "";
  return `rendered in a ${phrase} font${colorPhrase}`;
}

function buildOverlayText(
  fields: ImageThemeField[],
  fieldValues: Record<string, string>,
  positions: Record<string, string>,
  stylePresets?: Record<string, string>,
  presetList?: TextStylePreset[]
): string | null {
  const filled = fields.filter((f) => fieldValues[f.key]?.trim());
  if (filled.length === 0) return null;
  return filled
    .map((f) => {
      const presetId = stylePresets?.[f.key];
      const preset = presetId ? presetList?.find((p) => p.id === presetId) : undefined;
      const stylePhrase = buildStylePhrase(preset) || f.styleHint;
      return `${f.label}: "${fieldValues[f.key].trim()}" (${positions[f.key] || f.defaultPosition}, ${stylePhrase})`;
    })
    .join(". ") + ".";
}
type TextThemeData = {
  styleTags: string[];
  categoryTags: string[];
  stylePrompts: Record<string, string>;
  categoryPrompts: Record<string, string>;
};

/** Returns the scene/style prompt and the text-overlay instruction as two
 * SEPARATE strings — they must never be nested inside one another, or a
 * template that quotes the scene more than once (as the backend's
 * fixed-subject composite prompt does) will end up repeating the overlay
 * text too. */
function buildImageThemePrompt(
  theme: ImageTheme,
  fieldValues: Record<string, string>,
  positions: Record<string, string>,
  stylePresets?: Record<string, string>,
  presetList?: TextStylePreset[]
): { scene: string; overlay: string | null } {
  return { scene: theme.basePrompt, overlay: buildOverlayText(theme.textFields, fieldValues, positions, stylePresets, presetList) };
}


function TextOverlayFieldsEditor({
  fields, fieldValues, positions, onFieldChange, onPositionChange, stylePresets, onStyleChange, presetList,
}: {
  fields: ImageThemeField[];
  fieldValues: Record<string, string>;
  positions: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  onPositionChange: (key: string, value: string) => void;
  stylePresets: Record<string, string>;
  onStyleChange: (key: string, value: string) => void;
  presetList: TextStylePreset[];
}) {
  return (
    <div className="space-y-2 mb-2">
      {fields.map((f) => (
        <div key={f.key} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-[11px] text-muted-foreground">{f.label}</label>
            <input
              value={fieldValues[f.key] ?? ""}
              onChange={(e) => onFieldChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="w-full rounded-lg border border-input bg-input/40 p-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="w-36">
            <label className="text-[11px] text-muted-foreground">Position</label>
            <select
              value={positions[f.key] ?? f.defaultPosition}
              onChange={(e) => onPositionChange(f.key, e.target.value)}
              className="w-full rounded-lg border border-input bg-input/40 p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {POSITION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="w-40">
            <label className="text-[11px] text-muted-foreground">Style</label>
            <select
              value={stylePresets[f.key] ?? "standard"}
              onChange={(e) => onStyleChange(f.key, e.target.value)}
              className="w-full rounded-lg border border-input bg-input/40 p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {presetList.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function extractReferenceRejection(error: string | null | undefined): string | null {
  if (!error) return null;
  const marker = "REFERENCE_REJECTED::";
  const idx = error.indexOf(marker);
  if (idx === -1) return null;
  return error.slice(idx + marker.length).trim();
}

// ─── Ad Generations panel ────────────────────────────────────────────────────

type GenStatus = "generating" | "ready" | "failed";

type AdGenerationEntry = {
  adId: string;
  label: string;         // product name, falls back to "Ad"
  contentTypes: string;  // e.g. "✍️ 🖼" or "✍️ 🎬"
  status: GenStatus;
  imageUrl?: string | null;
  videoUrl?: string | null;
  createdAt: number;     // Date.now() when queued
};

/** Compact right-panel card for one tracked generation. */
/** Lightweight preview modal — shows generated image/video + first caption. */
function AdPreviewModal({ adId, onClose }: { adId: string; onClose: () => void }) {
  const [ad, setAd] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    api(`/ads/${adId}`).then((data) => {
      if (!cancelled) { setAd(data); setLoading(false); }
    }).catch((e: any) => {
      if (!cancelled) { setErr(e.message || "Could not load ad"); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [adId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const firstVariant = ad?.results?.variants?.[0];
  const imageUrl: string | null = firstVariant?.image_url ?? null;
  const videoUrl: string | null = firstVariant?.video_url ?? null;
  const platforms: string[] = ad?.platforms ?? [];
  // When no platform was selected at creation, the backend stores copy under
  // "default". Scan all variant keys to find whichever platform has a caption.
  const RESERVED_KEYS = new Set(["image_url", "image_urls", "video_url"]);
  const captionPlatform: string = (() => {
    if (!firstVariant) return "default";
    // Prefer an explicitly-connected platform if present
    for (const p of platforms) {
      if (firstVariant[p]?.caption) return p;
    }
    // Fall back to any key that has a caption (covers "default" and any other)
    for (const k of Object.keys(firstVariant)) {
      if (!RESERVED_KEYS.has(k) && firstVariant[k]?.caption) return k;
    }
    return platforms[0] ?? "default";
  })();
  const caption: string = firstVariant?.[captionPlatform]?.caption ?? "";
  const productName: string = (ad?.brief as any)?.product_name ?? "Ad";
  const displayPlatform = captionPlatform === "default" ? "Default" : captionPlatform;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card overflow-hidden shadow-[0_0_0_1px_oklch(1_0_0_/_0.07),0_24px_64px_oklch(0_0_0_/_0.6)]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{productName}</div>
            {platforms.length > 0 && <div className="text-[10px] text-muted-foreground mt-0.5">{platforms.join(" · ")}</div>}
          </div>
          <button onClick={onClose} className="ml-3 shrink-0 grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground transition leading-none">✕</button>
        </div>

        {/* Media + caption */}
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <svg className="h-6 w-6 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
        ) : err ? (
          <div className="flex h-48 items-center justify-center text-xs text-destructive px-4 text-center">{err}</div>
        ) : (
          <>
            {videoUrl ? (
              <video src={videoUrl} controls playsInline className="w-full max-h-72 object-contain bg-black" />
            ) : imageUrl ? (
              <img src={imageUrl} alt={productName} className="w-full max-h-72 object-contain bg-muted/20" />
            ) : (
              <div className="flex h-32 items-center justify-center text-2xl">✍️</div>
            )}
            {caption && (
              <div className="px-4 py-3 border-t border-border/60">
                <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Caption · {displayPlatform}</div>
                <p className="text-xs text-foreground leading-relaxed line-clamp-4">{caption}</p>
              </div>
            )}
          </>
        )}

        <div className="px-4 py-3 border-t border-border/60">
          <button onClick={onClose} className="w-full rounded-full border border-border py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AdGenCard({ entry, isActive }: { entry: AdGenerationEntry; isActive: boolean }) {
  const [showPreview, setShowPreview] = useState(false);
  const thumb = entry.imageUrl ?? entry.videoUrl;

  return (
    <>
      <div className={`relative rounded-xl border transition-colors overflow-hidden ${
        isActive ? "border-primary/60 bg-primary/5" : "border-border/60 bg-card/60"
      }`}>
        <div className="flex items-stretch">
          {/* Thumbnail */}
          <div className="w-[60px] shrink-0 relative bg-muted/20 flex items-center justify-center" style={{ minHeight: 60 }}>
            {thumb ? (
              entry.videoUrl && !entry.imageUrl ? (
                <video src={thumb} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
              ) : (
                <img src={thumb} alt={entry.label} className="absolute inset-0 w-full h-full object-cover" />
              )
            ) : (
              entry.status === "generating" ? (
                <svg className="h-4 w-4 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : entry.status === "failed" ? (
                <span className="text-sm">❌</span>
              ) : (
                <span className="text-sm">✨</span>
              )
            )}
            <span className={`absolute bottom-1 right-1 h-2 w-2 rounded-full border border-background/80 ${
              entry.status === "ready" ? "bg-emerald-400" :
              entry.status === "failed" ? "bg-destructive" :
              "bg-primary animate-pulse"
            }`} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 px-2 py-1.5 flex flex-col justify-between">
            <div className="text-[11px] font-semibold text-foreground truncate leading-tight">{entry.label}</div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground">{entry.contentTypes}</span>
              <span className={`ml-auto text-[9px] font-medium shrink-0 ${
                entry.status === "ready" ? "text-emerald-400" :
                entry.status === "failed" ? "text-destructive" :
                "text-primary"
              }`}>
                {entry.status === "ready" ? "✓ Ready" : entry.status === "failed" ? "Failed" : "Working…"}
              </span>
            </div>
            <div>
              {isActive && entry.status === "generating" ? (
                <span className="text-[9px] text-primary/70 italic">← creating now</span>
              ) : entry.status === "ready" ? (
                <button onClick={() => setShowPreview(true)} className="text-[9px] font-semibold text-primary hover:underline">
                  Preview →
                </button>
              ) : entry.status === "failed" ? (
                <span className="text-[9px] text-destructive">Failed</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {showPreview && <AdPreviewModal adId={entry.adId} onClose={() => setShowPreview(false)} />}
    </>
  );
}

/** The sticky right-panel column shown on xl+ screens on the Create Ad page.
 *  Shows currently-generating ads (session state) + the 7 most recent ads
 *  fetched from the backend, so the panel is always populated even on first load. */
function AdGenerationsPanel({
  entries, activeAdId,
}: {
  entries: AdGenerationEntry[];
  activeAdId: string | null;
}) {
  const generatingCount = entries.filter((e) => e.status === "generating").length;

  // Fetch the 7 most-recent ads from the backend on mount, then poll every
  // 8 s so newly-finished jobs from this session show up even if the user
  // navigated away and came back without a page reload.
  const [recentAds, setRecentAds] = useState<AdGenerationEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api("/ads?page_size=7&page=1");
        if (cancelled) return;
        const mapped: AdGenerationEntry[] = (data.items ?? []).map((ad: any) => {
          const firstVariant = ad.results?.variants?.[0];
          const contentTypes = [
            ad.outputs?.text ? "✍️" : null,
            ad.outputs?.image ? "🖼" : null,
            ad.outputs?.video ? "🎬" : null,
          ].filter(Boolean).join(" ") || "✍️";
          const genStatus: GenStatus =
            ad.status === "failed" ? "failed" :
            (ad.status === "ready" || ad.status === "approved" || ad.status === "scheduled" ||
             ad.status === "posted" || ad.status === "partially_posted" || ad.status === "pending_approval") ? "ready" :
            "generating";
          return {
            adId: ad.id,
            label: (ad.brief?.product_name as string) || "Ad",
            contentTypes,
            status: genStatus,
            imageUrl: firstVariant?.image_url ?? null,
            videoUrl: firstVariant?.video_url ?? null,
            createdAt: new Date(ad.created_at).getTime(),
          };
        });
        setRecentAds(mapped);
      } catch { /* non-fatal */ }
    }
    load();
    const t = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Merge: session entries take priority (they have live status); recent ads
  // fill in the rest. Deduplicate by adId, sort newest-first, cap at 10.
  const sessionIds = new Set(entries.map((e) => e.adId));
  const combined = [
    ...entries,
    ...recentAds.filter((r) => !sessionIds.has(r.adId)),
  ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);

  return (
    <div className="flex flex-col w-full h-full">
      {/* ── Fixed header — My Ads CTA, always visible ── */}
      <div className="px-3 pt-3 pb-2.5 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ad Generations</span>
          {generatingCount > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[8px] font-bold text-primary animate-pulse">
              {generatingCount} live
            </span>
          )}
        </div>
        <Link
          to="/app/my-ads"
          className="flex items-center justify-center gap-1.5 w-full rounded-xl border border-primary/50 bg-primary/10 py-2 text-[10px] font-semibold text-primary hover:bg-primary/20 transition"
        >
          📋 View My Ads
        </Link>
        <p className="mt-1.5 text-[9px] text-muted-foreground text-center leading-snug">
          For full details &amp; history, visit My Ads
        </p>
      </div>

      {/* ── Scrollable cards — fills remaining height ── */}
      <div className="flex flex-col gap-2 p-2.5 overflow-y-auto flex-1 min-h-0">
        {combined.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-3 text-center mt-1">
            <div className="text-xl mb-1">✨</div>
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              Generated ads appear here live. Start a new ad while one is still running.
            </p>
          </div>
        ) : (
          combined.map((entry) => (
            <AdGenCard
              key={entry.adId}
              entry={entry}
              isActive={entry.adId === activeAdId}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function CreateAd() {
  const { me, refresh } = useAuth();
  const [step, setStep] = useState(1);

  // Brief
  const [productName, setProductName] = useState("");
  const [audience, setAudience] = useState("");
  const [description, setDescription] = useState("");
  const [offer, setOffer] = useState("");
  const [goal, setGoal] = useState("Drive sales");
  const [tone, setTone] = useState("Professional");
  const [videoFrameImage, setVideoFrameImage] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState<"single_reference" | "first_last_frame">("single_reference");
  const [videoEndFrameImage, setVideoEndFrameImage] = useState<string | null>(null);
  const [imageReferenceImage, setImageReferenceImage] = useState<string | null>(null);
  const [selectedTextStyle, setSelectedTextStyle] = useState<string | null>(null);
  const [selectedTextCategory, setSelectedTextCategory] = useState<string | null>(null);
  const placementTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [envDesc, setEnvDesc] = useState("");
  const [imageScene, setImageScene] = useState("");
  const [refMode, setRefMode] = useState<"text" | "image">("text");
  const [selectedImageTheme, setSelectedImageTheme] = useState<string | null>(null);
  const [themeFieldValues, setThemeFieldValues] = useState<Record<string, string>>({});
  const [themePositions, setThemePositions] = useState<Record<string, string>>({});
  const [themeStyles, setThemeStyles] = useState<Record<string, string>>({});
  const [textStylePresets, setTextStylePresets] = useState<TextStylePreset[]>([{ id: "standard", label: "Standard (fits the image)", fontStyle: "", textColor: "", accentColor: "", size: "" }]);
  const [imageTextOverlay, setImageTextOverlay] = useState<string | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);

  // --- Per-slide theme (carousel) ---
  // Single mode: the flat state above (refMode/envDesc/imageScene/...) IS
  // the whole ad's theme, same as before this existed. Carousel mode: each
  // slide gets its OWN independent Text/Image Theme Reference selection.
  // Rather than parametrizing every piece of state and JSX by slide index
  // (a much larger rewrite), the flat state above always represents
  // "whichever slide tab is currently open" — switching tabs snapshots it
  // into slideThemes[oldIndex] and loads slideThemes[newIndex] back into
  // the same flat state, so every existing effect/JSX keeps working
  // unchanged for whichever slide is active.
  type SlideTheme = {
    refMode: "text" | "image"; envDesc: string; imageScene: string;
    selectedTextStyle: string | null; selectedTextCategory: string | null; selectedImageTheme: string | null;
    themeFieldValues: Record<string, string>; themePositions: Record<string, string>; themeStyles: Record<string, string>;
    imageTextOverlay: string | null;
  };
  const emptySlideTheme = (): SlideTheme => ({
    refMode: "text", envDesc: "", imageScene: "",
    selectedTextStyle: null, selectedTextCategory: null, selectedImageTheme: null,
    themeFieldValues: {}, themePositions: {}, themeStyles: {}, imageTextOverlay: null,
  });
  const [slideThemes, setSlideThemes] = useState<SlideTheme[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);

  function captureSlideTheme(): SlideTheme {
    return { refMode, envDesc, imageScene, selectedTextStyle, selectedTextCategory, selectedImageTheme, themeFieldValues, themePositions, themeStyles, imageTextOverlay };
  }
  function applySlideTheme(t: SlideTheme) {
    setRefMode(t.refMode); setEnvDesc(t.envDesc); setImageScene(t.imageScene);
    setSelectedTextStyle(t.selectedTextStyle); setSelectedTextCategory(t.selectedTextCategory); setSelectedImageTheme(t.selectedImageTheme);
    setThemeFieldValues(t.themeFieldValues); setThemePositions(t.themePositions); setThemeStyles(t.themeStyles);
    setImageTextOverlay(t.imageTextOverlay);
  }
  function switchSlide(index: number, snapshot: SlideTheme[]) {
    const updated = [...snapshot];
    updated[activeSlide] = captureSlideTheme();
    setSlideThemes(updated);
    applySlideTheme(updated[index] ?? emptySlideTheme());
    setActiveSlide(index);
  }

  // Developer-managed theme library (Developer > Themes) — fetched once;
  // falls back to empty lists (chips/gallery just show nothing) if the
  // call fails, rather than breaking the rest of Create Ad.
  const [textTheme, setTextTheme] = useState<TextThemeData>({ styleTags: [], categoryTags: [], stylePrompts: {}, categoryPrompts: {} });
  const [imageThemes, setImageThemes] = useState<ImageTheme[]>([]);
  const [styleTagList, setStyleTagList] = useState<string[]>([]);
  const [categoryTagList, setCategoryTagList] = useState<string[]>([]);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [brandTagline, setBrandTagline] = useState("");
  const [useTagline, setUseTagline] = useState(false);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [useLogo, setUseLogo] = useState(false);

  // Outputs
  const [outputs, setOutputs] = useState({ text: true, image: true, video: false });
  const [format, setFormat] = useState("single");
  const [variations, setVariations] = useState(1);
  const [carouselCount, setCarouselCount] = useState(3);
  const [availableModels, setAvailableModels] = useState<AvailableModelsOut | null>(null);
  const [textModelId, setTextModelId] = useState<string | null>(null);
  const [imageModelId, setImageModelId] = useState<string | null>(null);
  const [videoModelId, setVideoModelId] = useState<string | null>(null);
  const [videoResolution, setVideoResolution] = useState<string | null>(null);
  const [videoAudio, setVideoAudio] = useState(true);
  const [liveImageCredits, setLiveImageCredits] = useState<number | null>(null);
  const [liveVideoCredits, setLiveVideoCredits] = useState<number | null>(null);
  const [liveTextCredits, setLiveTextCredits] = useState<number | null>(null);
  const [videoShots, setVideoShots] = useState<{
    prompt: string;
    duration: number;
    voiceoverText?: string;
    showVoiceover?: boolean;
    textOverlays?: {
      text: string;
      startTime: number;
      endTime: number | null;
      position: string;
      fontStyle: string;
      fontSize: string;
      textColor: string;
      overlayStyle: string;
    }[];
    showOverlays?: boolean;
  }[]>([{ prompt: "", duration: 6 }]);
  const [videoThemes, setVideoThemes] = useState<VideoTheme[]>([]);
  const [selectedVideoThemeId, setSelectedVideoThemeId] = useState<string | null>(null);
  const [videoRefMode, setVideoRefMode] = useState<"custom" | "theme">("custom");
  const [showVideoThemeModal, setShowVideoThemeModal] = useState(false);
  const [brandVideoShots, setBrandVideoShots] = useState<{ id: string; kind: string; status: string; label: string; prompt: string; duration: number; url: string | null; poster_url: string | null }[]>([]);
  const [videoStartShotId, setVideoStartShotId] = useState<string | null>(null);
  const [videoEndShotId, setVideoEndShotId] = useState<string | null>(null);
  const [refineVideoPrompt, setRefineVideoPrompt] = useState(false);
  const [refineVideoFrame, setRefineVideoFrame] = useState(false);
  const [openSection, setOpenSection] = useState<"text" | "image" | "video">("text");
  const [videoReferencePrompt, setVideoReferencePrompt] = useState("");
  const [showVideoReferencePrompt, setShowVideoReferencePrompt] = useState(false);
  const [videoNegativePrompt, setVideoNegativePrompt] = useState("");
  const [showVideoNegativePrompt, setShowVideoNegativePrompt] = useState(false);
  const [videoCameraStyleIds, setVideoCameraStyleIds] = useState<string[]>([]);
  const [cameraStylePresets, setCameraStylePresets] = useState<{ id: string; label: string; prompt_fragment: string }[]>([]);
  const [videoBackgroundMusicId, setVideoBackgroundMusicId] = useState<string>("none");
  const [musicPresets, setMusicPresets] = useState<{ id: string; label: string; description: string }[]>([]);
  const [videoReferencePromptDefault, setVideoReferencePromptDefault] = useState<string>("");

  // Platforms
  const [selected, setSelected] = useState<Record<string, boolean>>({ instagram: true, facebook: true, linkedin: false, x: false, tiktok: false });

  // Generation state
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [warning, setWarning] = useState("");
  const [referenceRejectedMsg, setReferenceRejectedMsg] = useState("");
  const [retentionMonths, setRetentionMonths] = useState<number | null>(null);
  const [postRetentionMonths, setPostRetentionMonths] = useState<number | null>(null);
  const [retryingWithoutRef, setRetryingWithoutRef] = useState(false);
  const [adId, setAdId] = useState<string | null>(null);
  // Generations panel — tracks every ad started this session
  const [genEntries, setGenEntries] = useState<AdGenerationEntry[]>([]);
  const [variants, setVariants] = useState<AdVariant[] | null>(null);
  const [activeVariant, setActiveVariant] = useState(0);
  const [postedMap, setPostedMap] = useState<Record<string, boolean>>({});
  const [refineText, setRefineText] = useState("");
  const [imageEditText, setImageEditText] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [scheduleTime, setScheduleTime] = useState("10:00");
  const [timeZone, setTimeZone] = useState(detectedTimeZone());
  const [schedulePlatforms, setSchedulePlatforms] = useState<Record<string, boolean>>({});
  const [scheduling, setScheduling] = useState(false);
  const [scheduledMsg, setScheduledMsg] = useState("");

  // Prompt confirmation popup
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [textPrompt, setTextPrompt] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");

  const connectedPlatformIds = useConnectedPlatforms();
  // Only show platforms the company has connected; fall back to all while loading
  const availablePlatforms = connectedPlatformIds === null ? PLATFORMS : PLATFORMS.filter((p) => connectedPlatformIds.has(p.id));
  const chosenPlatforms = availablePlatforms.filter((p) => selected[p.id]);
  const isDataUrlVideoFrame = !!videoFrameImage && videoFrameImage.startsWith("data:");
  const isDataUrlImageReference = !!imageReferenceImage && imageReferenceImage.startsWith("data:");
  const selectedTextModel = availableModels?.text.find((m) => m.id === textModelId) || null;
  const selectedImageModel = availableModels?.image.find((m) => m.id === imageModelId) || null;
  const selectedVideoModel = availableModels?.video.find((m) => m.id === videoModelId) || null;
  const cost = estimateCost(outputs, format, variations, carouselCount, liveTextCredits ?? selectedTextModel?.credits ?? 1, liveImageCredits ?? selectedImageModel?.credits ?? 2, liveVideoCredits ?? selectedVideoModel?.credits ?? 5);
  const videoTotalDuration = videoShots.reduce((sum, s) => sum + (s.duration || 0), 0);
  const videoShotsValid = !outputs.video || (!!selectedVideoModel && (
    selectedVideoModel.duration_options
      ? selectedVideoModel.duration_options.includes(videoTotalDuration)
      : videoTotalDuration >= (selectedVideoModel.min_duration ?? 1) && videoTotalDuration <= (selectedVideoModel.max_duration ?? 60)
  ));
  const credits = me?.credits ?? 0;

  useEffect(() => {
    let cancelled = false;
    api("/ads/themes")
      .then((r) => {
        if (cancelled) return;
        const t = r.themes || {};
        setImageThemes((t.image_themes || []).map(mapImageTheme));
        setStyleTagList(t.style_tags || []);
        setCategoryTagList(t.category_tags || []);
      })
      .catch(() => { /* Create Ad still works without themes — chips/gallery just show empty */ });
    api("/ads/text-theme")
      .then((r) => {
        if (cancelled) return;
        setTextTheme({
          styleTags: r.style_tags || [], categoryTags: r.category_tags || [],
          stylePrompts: r.style_prompts || {}, categoryPrompts: r.category_prompts || {},
        });
      })
      .catch(() => { /* Text Theme Reference just shows no style/product options */ });
    api("/ads/text-style-presets")
      .then((r) => {
        if (cancelled || !Array.isArray(r) || r.length === 0) return;
        setTextStylePresets(r.map((p: any) => ({
          id: p.id, label: p.label, fontStyle: p.font_style || "", textColor: p.text_color || "",
          accentColor: p.accent_color || "", size: p.size || "",
        })));
      })
      .catch(() => { /* falls back to just the built-in "Standard" option */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (videoMode === "first_last_frame" && !selectedVideoModel?.supports_last_frame) {
      setVideoMode("single_reference");
      setVideoEndFrameImage(null);
    }
  }, [selectedVideoModel?.id, selectedVideoModel?.supports_last_frame]);

  // Live, exact pricing — recomputed server-side whenever the actual
  // selection changes, since dynamically-priced models genuinely cost
  // different amounts per resolution/audio/duration combination (see
  // services/pricing.py). Falls back to the model's flat reference
  // `credits` for models without dynamic pricing, avoiding an
  // unnecessary API call for those.
  useEffect(() => {
    if (!outputs.text || !selectedTextModel?.has_dynamic_pricing) { setLiveTextCredits(null); return; }
    let cancelled = false;
    api("/ads/preview-cost", { method: "POST", body: { kind: "text", model_id: selectedTextModel.id } })
      .then((r) => { if (!cancelled) setLiveTextCredits(r.credits); })
      .catch(() => { if (!cancelled) setLiveTextCredits(null); });
    return () => { cancelled = true; };
  }, [outputs.text, selectedTextModel?.id, selectedTextModel?.has_dynamic_pricing]);

  useEffect(() => {
    if (!outputs.image || !selectedImageModel?.has_dynamic_pricing) { setLiveImageCredits(null); return; }
    let cancelled = false;
    api("/ads/preview-cost", { method: "POST", body: { kind: "image", model_id: selectedImageModel.id } })
      .then((r) => { if (!cancelled) setLiveImageCredits(r.credits); })
      .catch(() => { if (!cancelled) setLiveImageCredits(null); });
    return () => { cancelled = true; };
  }, [outputs.image, selectedImageModel?.id, selectedImageModel?.has_dynamic_pricing]);

  useEffect(() => {
    if (!outputs.video || !selectedVideoModel?.has_dynamic_pricing || !videoShotsValid) { setLiveVideoCredits(null); return; }
    let cancelled = false;
    api("/ads/preview-cost", {
      method: "POST",
      body: { kind: "video", model_id: selectedVideoModel.id, resolution: videoResolution, audio: videoAudio, duration_seconds: videoTotalDuration, has_reference_image: !!videoFrameImage },
    })
      .then((r) => { if (!cancelled) setLiveVideoCredits(r.credits); })
      .catch(() => { if (!cancelled) setLiveVideoCredits(null); });
    return () => { cancelled = true; };
  }, [outputs.video, selectedVideoModel?.id, selectedVideoModel?.has_dynamic_pricing, videoResolution, videoAudio, videoTotalDuration, videoShotsValid, videoFrameImage]);

  // Switching between Text Theme Reference and Image Theme Reference
  // previously left the OTHER mode's composed text sitting in the
  // textbox (e.g. an Image Theme's "Product to feature: ..." line was
  // still showing after switching to Text Theme). Clear it first on any
  // switch; the compose effects below (which also depend on refMode, and
  // so re-run in the same commit, in this declared order) then refill it
  // if the new mode already has a selection.
  useEffect(() => {
    if (imageReferenceImage) setEnvDesc(""); else setImageScene("");
    setImageTextOverlay(null);
  }, [refMode]);

  useEffect(() => {
    if (refMode !== "image" || !selectedImageTheme) return;
    const theme = imageThemes.find((t) => t.id === selectedImageTheme);
    if (!theme) return;
    const { scene, overlay } = buildImageThemePrompt(theme, themeFieldValues, themePositions, themeStyles, textStylePresets);
    if (imageReferenceImage) setEnvDesc(scene); else setImageScene(scene);
    setImageTextOverlay(overlay);
  }, [refMode, selectedImageTheme, themeFieldValues, themePositions, themeStyles, textStylePresets, imageReferenceImage]);

  // Keep slideThemes sized to carouselCount whenever in carousel mode —
  // new slots start empty ("Define your own" until the user picks a
  // theme), removed slots just drop off the end. If the currently-open
  // tab got trimmed away, fall back to the last remaining slide.
  useEffect(() => {
    if (format !== "carousel") return;
    setSlideThemes((prev) => {
      const next = [...prev];
      next[activeSlide] = captureSlideTheme();
      while (next.length < carouselCount) next.push(emptySlideTheme());
      if (next.length > carouselCount) next.length = carouselCount;
      return next;
    });
    if (activeSlide >= carouselCount) setActiveSlide(carouselCount - 1);
  }, [format, carouselCount]);

  // Text Theme Reference: Style + Product Category are two independent
  // picks (either, both, or neither — "neither" just falls through to
  // "Define your own" in the textbox, so we leave it alone rather than
  // forcing it blank). Their prompts combine.
  useEffect(() => {
    if (refMode !== "text") return;
    const stylePrompt = selectedTextStyle ? textTheme.stylePrompts[selectedTextStyle] : "";
    const categoryPrompt = selectedTextCategory ? textTheme.categoryPrompts[selectedTextCategory] : "";
    const combined = [stylePrompt, categoryPrompt].filter((p) => p?.trim()).join(" ");
    if (combined) {
      if (imageReferenceImage) setEnvDesc(`Place the product into this setting: ${combined}`);
      else setImageScene(combined);
    }
    setImageTextOverlay(buildOverlayText(STANDARD_TEXT_FIELDS, themeFieldValues, themePositions, themeStyles, textStylePresets));
  }, [refMode, selectedTextStyle, selectedTextCategory, textTheme, imageReferenceImage, themeFieldValues, themePositions, themeStyles, textStylePresets]);

  const results = variants ? variants[activeVariant] : null;

  function resetWizard() {
    setStep(1); setProductName(""); setAudience(""); setDescription(""); setOffer("");
    setGoal("Drive sales"); setTone("Professional"); setVideoFrameImage(null); setImageReferenceImage(null);
    setSelectedTextStyle(null); setSelectedTextCategory(null); setEnvDesc(""); setImageScene("");
    setAdId(null); setVariants(null); setPostedMap({}); setBlocked(false); setWarning(""); setErrorMsg("");
    setSelectedProductId(null);
    setFormat("single"); setVariations(1); setCarouselCount(3);
    setSlideThemes([]); setActiveSlide(0);
    setVideoShots([{ prompt: "", duration: selectedVideoModel?.min_duration || 6 }]);
    setVideoReferencePrompt(""); setShowVideoReferencePrompt(false);
    setVideoNegativePrompt(""); setShowVideoNegativePrompt(false);
    setVideoCameraStyleIds([]); setVideoBackgroundMusicId("none");
    setOpenSection("text");
  }

  // Just clears what's typed in the brief (step 1) — stays on step 1,
  // unlike resetWizard() which abandons the whole in-progress ad.
  function clearBrief() {
    setProductName(""); setAudience(""); setDescription(""); setOffer("");
    setGoal("Drive sales"); setTone("Professional"); setVideoFrameImage(null); setImageReferenceImage(null);
    setSelectedTextStyle(null); setSelectedTextCategory(null); setEnvDesc(""); setImageScene(""); setSelectedProductId(null);
    setSlideThemes([]); setActiveSlide(0);
  }

  // Cancel buttons on steps 2-5: for steps 2-3 nothing has been sent to
  // the backend yet, so this just discards local state. Once generation
  // has actually started (adId is set), the backend job and any credits
  // already spent can't be un-spent from here — the ad will still finish
  // and appear in My Ads — so we confirm and are upfront about that.
  function cancelWizard() {
    if (adId && !window.confirm("Cancel and start over? Generation already in progress (and any credits spent) can't be undone from here — the ad will still finish and appear in My Ads. Continue?")) {
      return;
    }
    resetWizard();
  }

  useEffect(() => {
    api("/brand-kit").then((kit) => {
      setBrandTagline(kit.tagline || "");
      setBrandLogoUrl(kit.logo_url || null);
    }).catch(() => { /* non-fatal */ });
    api("/ads/retention-info").then((r) => { setRetentionMonths(r.retention_months); setPostRetentionMonths(r.post_retention_months); }).catch(() => { /* non-fatal — notice just won't show a specific number */ });
    api("/ads/available-models").then((models: AvailableModelsOut) => {
      setAvailableModels(models);
      if (models.text.length > 0) setTextModelId(models.text[0].id);
      if (models.image.length > 0) setImageModelId(models.image[0].id);
      if (models.video.length > 0) {
        setVideoModelId(models.video[0].id);
        setVideoResolution(models.video[0].resolutions?.[0] ?? null);
        setVideoShots([{ prompt: "", duration: models.video[0].min_duration ?? 6 }]);
      }
    }).catch(() => {});
    api("/ads/video-themes").then((themes: typeof videoThemes) => {
      setVideoThemes(themes);
    }).catch(() => {});
    api("/ads/camera-style-presets").then((presets: typeof cameraStylePresets) => {
      setCameraStylePresets(presets);
    }).catch(() => {});
    api("/ads/music-presets").then((presets: typeof musicPresets) => {
      setMusicPresets(presets);
    }).catch(() => {});
    api("/ads/video-reference-prompt-default").then((r: { prompt: string }) => {
      setVideoReferencePromptDefault(r.prompt);
    }).catch(() => {});
    api("/brand-kit/video-shots").then((shots: typeof brandVideoShots) => {
      setBrandVideoShots(shots);
    }).catch(() => { /* Create Ad still works without brand shots — picker just shows "None" only */ });
  }, []);

  // Pre-fill the brief when arriving from Products → "New ad" (see app.products.tsx).
  useEffect(() => {
    const raw = sessionStorage.getItem("nivaad_prefill_product");
    if (!raw) return;
    sessionStorage.removeItem("nivaad_prefill_product");
    try {
      const p = JSON.parse(raw);
      setProductName(p.name || ""); setDescription(p.description || "");
      setAudience(p.audience || ""); setOffer(p.offer || "");
      if (p.id) setSelectedProductId(p.id);
      // The product library's photo is an already-hosted URL, not base64 —
      // imageReferenceImage can hold either; submission logic below tells them apart.
      if (p.image_url) setImageReferenceImage(p.image_url);
    } catch { /* ignore malformed prefill */ }
  }, []);

  // Pre-fill when arriving from the Themes Gallery (see
  // app.themes-gallery.tsx) — a theme id plus an optional linked
  // product. Themes aren't loaded yet at mount (their own fetch is
  // still in flight), so the parsed payload is held in a ref and
  // applied once the matching theme list actually has entries, rather
  // than trying to apply it immediately against an empty array.
  const pendingThemePrefillRef = useRef<{ themeKind: "image" | "video"; themeId: string; product: any | null } | null>(null);
  useEffect(() => {
    const raw = sessionStorage.getItem("nivaad_prefill_theme");
    if (!raw) return;
    sessionStorage.removeItem("nivaad_prefill_theme");
    try {
      pendingThemePrefillRef.current = JSON.parse(raw);
    } catch { /* ignore malformed prefill */ }
  }, []);

  function applyLinkedProduct(p: any | null, { forVideo }: { forVideo: boolean }) {
    if (!p) return;
    setProductName(p.name || ""); setDescription(p.description || "");
    setAudience(p.audience || ""); setOffer(p.offer || "");
    if (p.id) setSelectedProductId(p.id);
    if (p.image_url) {
      if (forVideo) {
        // Video themes animate FROM a starting frame — the linked
        // product's photo becomes that frame, same idea as the image
        // path's reference image, just wired to the video field
        // instead since a video theme means outputs.video, not image.
        setVideoFrameImage(p.image_url);
      } else {
        setImageReferenceImage(p.image_url);
      }
    }
  }

  useEffect(() => {
    const pending = pendingThemePrefillRef.current;
    if (!pending || pending.themeKind !== "image" || imageThemes.length === 0) return;
    const theme = imageThemes.find((t) => t.id === pending.themeId);
    if (!theme) return;
    pendingThemePrefillRef.current = null;
    setOutputs((o) => ({ ...o, image: true, video: false }));
    setRefMode("image");
    setSelectedImageTheme(theme.id);
    setThemeFieldValues({}); setThemePositions({});
    applyLinkedProduct(pending.product, { forVideo: false });
  }, [imageThemes]);

  useEffect(() => {
    const pending = pendingThemePrefillRef.current;
    if (!pending || pending.themeKind !== "video" || videoThemes.length === 0) return;
    const theme = videoThemes.find((t) => t.id === pending.themeId);
    if (!theme) return;
    pendingThemePrefillRef.current = null;
    setOutputs((o) => ({ ...o, video: true, image: false }));
    setVideoRefMode("theme");
    setSelectedVideoThemeId(theme.id);
    setVideoShots(theme.shots.map((s) => ({
      prompt: s.prompt_template.replace(/\{product\}/g, pending.product?.name?.trim() || "the product"),
      duration: s.duration,
    })));
    applyLinkedProduct(pending.product, { forVideo: true });
  }, [videoThemes]);

  async function saveToLibrary() {
    if (!productName.trim()) return;
    setSavingProduct(true); setSavedMsg("");
    try {
      await api("/products", { method: "POST", body: { name: productName, description, audience, offer, image: imageReferenceImage || null } });
      setSavedMsg("✓ Saved");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e: any) {
      setSavedMsg(e.message || "Could not save");
    }
    setSavingProduct(false);
  }

  async function handleVideoFrameImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setVideoFrameImage(await fileToDataUrl(f));
  }

  async function handleVideoEndFrameImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setVideoEndFrameImage(await fileToDataUrl(f));
  }

  async function handleImageReferenceImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageReferenceImage(await fileToDataUrl(f));
  }

  function buildCarouselTheme(): { env: string | null; image_scene: string | null; text_overlay: string | null }[] {
    const flushed = [...slideThemes];
    flushed[activeSlide] = captureSlideTheme();
    return flushed.slice(0, carouselCount).map((slot) => ({
      env: imageReferenceImage ? (slot.envDesc || null) : null,
      image_scene: !imageReferenceImage && slot.imageScene ? slot.imageScene : null,
      text_overlay: slot.imageTextOverlay,
    }));
  }

  async function openPromptPreview() {
    setErrorMsg(""); setPreviewBusy(true);
    try {
      const res = await api("/ads/preview-prompt", {
        method: "POST",
        body: {
          product_name: productName, description, audience, offer, goal, tone,
          env: imageReferenceImage ? envDesc : null,
          image_scene: !imageReferenceImage && imageScene ? imageScene : null,
          text_overlay: imageTextOverlay,
          has_photo: !!imageReferenceImage,
          tagline: useTagline && brandTagline ? brandTagline : null,
          platforms: chosenPlatforms.map((p) => p.id),
          outputs,
          format, variations,
          carousel_slides: null,
          video_shots: outputs.video ? videoShots.map((s) => ({ prompt: s.prompt, duration: s.duration, voiceover_text: s.voiceoverText?.trim() || null })) : null,
          refine_video_prompt: outputs.video ? refineVideoPrompt : false,
        },
      });
      setTextPrompt(res.text_prompt);
      setImagePrompt(res.image_prompt || "");
      setVideoPrompt(res.video_prompt || "");
      if (res.reviewed_shots) setVideoShots(res.reviewed_shots); // Step 2 now shows the reviewed wording too, not just this popup
      setShowPromptModal(true);
    } catch (e: any) {
      setErrorMsg(e.message || "Could not build the prompt preview");
    }
    setPreviewBusy(false);
  }

  async function pollAd(id: string, maxIterations = 80) {
    for (let i = 0; i < maxIterations; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const ad = await api(`/ads/${id}`);
      if (ad.status === "ready") return ad;
      if (ad.status === "failed") throw new Error(ad.error || "Generation failed");
    }
    throw new Error("Generation timed out");
  }

  async function generate(feedback?: string) {
    setBusy(true); setBlocked(false); setErrorMsg("");
    try {
      let id = adId;
      if (!feedback) {
        const res = await api("/ads", {
          method: "POST",
          body: {
            product_name: productName, description, audience, offer, goal, tone,
            env: imageReferenceImage ? envDesc : null,
            image_scene: !imageReferenceImage && imageScene ? imageScene : null,
            text_overlay: imageTextOverlay,
            product_image: null,
            product_image_url: null,
            product_id: selectedProductId,
            tagline: useTagline && brandTagline ? brandTagline : null,
            use_brand_logo: useLogo,
            platforms: chosenPlatforms.map((p) => p.id),
            outputs, format, variations,
            carousel_slides: null,
            carousel_theme: format === "carousel" ? buildCarouselTheme() : null,
            video_shots: outputs.video ? videoShots.map((s) => ({
              prompt: s.prompt,
              duration: s.duration,
              voiceover_text: s.voiceoverText?.trim() || null,
              text_overlays: (s.textOverlays || []).filter((o) => o.text.trim()).map((o) => ({
                text: o.text.trim(),
                start_time: o.startTime,
                end_time: o.endTime,
                position: o.position,
                font_style: o.fontStyle,
                font_size: o.fontSize,
                text_color: o.textColor,
                overlay_style: o.overlayStyle,
              })),
            })) : null,
            refine_video_prompt: outputs.video ? refineVideoPrompt : false,
            refine_video_frame: outputs.video ? refineVideoFrame : false,
            video_frame_image: outputs.video && isDataUrlVideoFrame ? videoFrameImage : null,
            video_frame_image_url: outputs.video && !isDataUrlVideoFrame && videoFrameImage ? videoFrameImage : null,
            video_mode: outputs.video ? videoMode : "single_reference",
            video_end_frame_image: outputs.video && videoMode === "first_last_frame" ? videoEndFrameImage : null,
            image_reference_image: outputs.image && isDataUrlImageReference ? imageReferenceImage : null,
            image_reference_image_url: outputs.image && !isDataUrlImageReference && imageReferenceImage ? imageReferenceImage : null,
            text_prompt_override: textPrompt || null,
            image_prompt_override: outputs.image && format !== "carousel" ? (imagePrompt || null) : null,
            video_prompt_override: outputs.video && videoShots.length === 1 ? (videoPrompt || null) : null,
            text_model_id: outputs.text ? textModelId : null,
            image_model_id: outputs.image ? imageModelId : null,
            video_model_id: outputs.video ? videoModelId : null,
            video_resolution: outputs.video ? videoResolution : null,
            video_audio: outputs.video ? videoAudio : false,
            video_start_shot_id: outputs.video ? videoStartShotId : null,
            video_end_shot_id: outputs.video ? videoEndShotId : null,
            video_reference_prompt: outputs.video && videoFrameImage ? (videoReferencePrompt.trim() || videoReferencePromptDefault || null) : null,
            video_camera_style_ids: outputs.video ? videoCameraStyleIds : [],
            video_negative_prompt: outputs.video && videoNegativePrompt.trim() ? videoNegativePrompt.trim() : null,
            video_background_music_id: outputs.video && videoBackgroundMusicId !== "none" ? videoBackgroundMusicId : null,
          },
        });
        id = res.ad_id; setAdId(id);
        // Register a new entry in the generations panel
        if (!feedback) {
          const contentTypes = [
            outputs.text ? "✍️" : null,
            outputs.image ? "🖼" : null,
            outputs.video ? "🎬" : null,
          ].filter(Boolean).join(" ");
          setGenEntries((prev) => [
            ...prev,
            { adId: id!, label: productName.trim() || "Ad", contentTypes, status: "generating", createdAt: Date.now() },
          ]);
        }
      } else {
        await api(`/ads/${id}/refine`, { method: "POST", body: { feedback, variant: activeVariant } });
      }
      // Video generation genuinely takes minutes, not seconds (up to the
      // backend's own 8-minute bound) — poll for longer specifically
      // when video was requested, so a legitimately-still-running job
      // doesn't get reported as "timed out" to the user while it's
      // actually about to succeed.
      const ad = await pollAd(id!, !feedback && outputs.video ? 400 : 80);
      setVariants(ad.results.variants);
      setWarning(ad.error && ad.status === "ready" ? ad.error : "");
      setReferenceRejectedMsg(extractReferenceRejection(ad.error) || "");
      if (!feedback) setActiveVariant(0);
      refresh();
      setStep(3);
      // Mark entry as ready with thumbnail
      if (id) {
        const firstVariant = ad.results?.variants?.[0];
        setGenEntries((prev) => prev.map((e) =>
          e.adId === id ? { ...e, status: "ready", imageUrl: firstVariant?.image_url ?? null, videoUrl: firstVariant?.video_url ?? null } : e
        ));
      }
    } catch (e: any) {
      // Mark entry as failed
      if (adId) {
        setGenEntries((prev) => prev.map((e) => e.adId === adId ? { ...e, status: "failed" } : e));
      }
      if (e.status === 400) { setBlocked(true); setStep(1); }
      else if (e.status === 402) { setErrorMsg(e.message); setStep(1); }
      else { setErrorMsg(e.message || "Generation error"); if (!feedback) setStep(1); }
    }
    setBusy(false); setRefineText("");
  }

  async function editImage() {
    if (!adId || !imageEditText.trim()) return;
    setBusy(true); setErrorMsg("");
    try {
      await api(`/ads/${adId}/refine-image`, { method: "POST", body: { feedback: imageEditText, variant: activeVariant } });
      const ad = await pollAd(adId);
      setVariants(ad.results.variants);
      setWarning(ad.error && ad.status === "ready" ? ad.error : "");
      refresh();
      setImageEditText("");
    } catch (e: any) {
      if (e.status === 402) setErrorMsg(e.message);
      else setErrorMsg(e.message || "Image edit failed");
    }
    setBusy(false);
  }

  async function retryWithoutReference() {
    if (!adId) return;
    setRetryingWithoutRef(true); setErrorMsg("");
    try {
      await api(`/ads/${adId}/retry-without-reference`, { method: "POST" });
      setReferenceRejectedMsg("");
      const ad = await pollAd(adId, outputs.video ? 400 : 80);
      setVariants(ad.results.variants);
      setWarning(ad.error && ad.status === "ready" ? ad.error : "");
      setReferenceRejectedMsg(extractReferenceRejection(ad.error) || "");
      refresh();
    } catch (e: any) {
      setErrorMsg(e.message || "Retry failed");
    }
    setRetryingWithoutRef(false);
  }

  async function postPlatform(platformId: string) {
    setPostedMap((m) => ({ ...m, [platformId]: true }));
    if (adId) {
      try { await api(`/ads/${adId}/post`, { method: "POST", body: { platforms: [platformId] } }); } catch { /* non-fatal for the UI, already reflected locally */ }
    }
  }
  async function postAll() {
    const remaining = chosenPlatforms.filter((p) => !postedMap[p.id]).map((p) => p.id);
    remaining.forEach((id) => setPostedMap((m) => ({ ...m, [id]: true })));
    if (adId && remaining.length > 0) {
      try { await api(`/ads/${adId}/post`, { method: "POST", body: { platforms: remaining } }); } catch { /* non-fatal */ }
    }
  }

  async function scheduleSelected() {
    const chosen = chosenPlatforms.filter((p) => (schedulePlatforms[p.id] ?? !postedMap[p.id])).map((p) => p.id);
    if (!adId || chosen.length === 0 || !scheduleDate) return;
    setScheduling(true); setErrorMsg("");
    try {
      // Convert the wall-clock date/time you entered (in the selected
      // timezone) into true UTC before sending — the backend always
      // stores and fires schedules in UTC.
      const naiveUtc = zonedWallTimeToUtcNaiveIso(scheduleDate, scheduleTime, timeZone);
      await api("/schedule", { method: "POST", body: { ad_id: adId, platforms: chosen, scheduled_at: naiveUtc } });
      setScheduledMsg(`🗓 Scheduled for ${new Date(scheduleDate + "T" + scheduleTime).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${timeZone}`);
    } catch (e: any) {
      setErrorMsg(e.message || "Could not schedule");
    }
    setScheduling(false);
  }

  return (
    <AppShell
      eyebrow="Create"
      title="What is this ad for?"
      rightPanel={
        <AdGenerationsPanel
          entries={genEntries}
          activeAdId={adId}
        />
      }
    >
      <div className="mb-8 flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => { if (i + 1 < step) setStep(i + 1); }}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition ${i + 1 === step ? "border-primary bg-primary/10 text-primary" : i + 1 < step ? "border-emerald-500/40 text-emerald-400" : "border-border text-muted-foreground"}`}
            >
              {i + 1}. {s}
            </button>
            {i < STEPS.length - 1 && <span className="text-muted-foreground/40">›</span>}
          </div>
        ))}
        <button onClick={resetWizard} className="ml-auto rounded-full border border-border px-4 py-1.5 text-xs hover:border-primary/40">+ New ad</button>
      </div>

      {blocked && (
        <Panel className="mb-6 border-destructive/40 bg-destructive/5">
          <div className="text-destructive font-semibold">🛡️ Request blocked by content guardrails</div>
          <p className="text-sm text-muted-foreground mt-2">Your brief matched a prohibited term under the Acceptable Use Policy. Edit the brief and try again.</p>
          <button onClick={() => setBlocked(false)} className="mt-3 rounded-full border border-border px-4 py-1.5 text-xs">Edit brief</button>
        </Panel>
      )}
      {errorMsg && !blocked && (
        <Panel className="mb-6 border-destructive/40 bg-destructive/5">
          <div className="text-destructive text-sm">{errorMsg}</div>
        </Panel>
      )}

      {step === 1 && !blocked && (
        <Panel>
          <h2 className="font-display text-xl font-bold text-foreground">Tick what you need generated</h2>
          <p className="mt-1 text-xs text-muted-foreground">Ad Text is always included. You can also generate an AI Image OR an AI Video — not both at once.</p>

          <div className="mt-4 space-y-3">
            {/* ===== AD TEXT ===== */}
            <div className={`rounded-xl border transition-colors ${outputs.text ? "border-primary bg-primary/5" : "border-border"}`}>
              <button
                type="button"
                onClick={() => setOpenSection(openSection === "text" ? "video" : "text")}
                className="flex w-full items-center gap-4 p-4 text-left"
              >
                <span className="text-lg">✍️</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">Ad Text</div>
                  <div className="text-xs text-muted-foreground">~{liveTextCredits ?? selectedTextModel?.credits ?? 1} credit · always included</div>
                </div>
                <span className="shrink-0 rounded-full border border-primary/50 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">Always on</span>
                <svg className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${openSection === "text" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {openSection === "text" && (
                <div className="px-4 pb-4 border-t border-border/60 pt-4">
                  <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-2">
                    {/* Left column */}
                    <div className="space-y-3">
                      <Field label="Product / service name *" hint="The exact name as it should appear in the ad.">
                        <Input placeholder="e.g. AquaGlow Smart Bottle" value={productName} onChange={(e) => setProductName(e.target.value)} />
                      </Field>
                      <Field label="Target audience *" hint="Who should this ad speak to? Age, interests, lifestyle.">
                        <Input placeholder="e.g. fitness-focused professionals, 25-40, urban" value={audience} onChange={(e) => setAudience(e.target.value)} />
                      </Field>
                      <Field label="Offer / promotion (optional)" hint="Discounts and deadlines create urgency.">
                        <Input placeholder="e.g. 20% off launch week, free shipping" value={offer} onChange={(e) => setOffer(e.target.value)} />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs font-semibold text-foreground mb-1.5">Text Model <NovaHint hintKey="field:text-model" /></div>
                          <select value={textModelId || ""} onChange={(e) => setTextModelId(e.target.value)}
                            className="w-full rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                            {!availableModels && <option value="">Loading…</option>}
                            {availableModels?.text.map((m) => (
                              <option key={m.id} value={m.id}>{m.label} — {m.credits}cr</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-foreground mb-1.5">Variations <NovaHint hintKey="field:variations" /></div>
                          <div className="flex gap-1.5">
                            {[[1, "1 version"], [3, "3 ×2cr"]].map(([v, l]) => (
                              <button key={v as number} onClick={() => setVariations(v as number)}
                                className={`rounded-full border px-3 py-1.5 text-[11px] ${variations === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Right column */}
                    <div className="space-y-3">
                      <Field label="Describe the product & what makes it special *" hint="Mention 2-3 concrete features — specifics make ads convert.">
                        <textarea rows={4} placeholder="e.g. Stainless-steel smart water bottle that tracks hydration and glows to remind you to drink."
                          value={description} onChange={(e) => setDescription(e.target.value)}
                          className="w-full rounded-lg border border-input bg-input/40 p-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
                      </Field>
                      <div>
                        <div className="text-xs font-semibold text-foreground mb-1.5">Campaign goal <NovaHint hintKey="field:campaign-goal-tone" /></div>
                        <div className="flex flex-wrap gap-1.5">
                          {GOALS.map((g) => <Chip key={g} active={goal === g} onClick={() => setGoal(g)}>{g}</Chip>)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground mb-1.5">Tone</div>
                        <div className="flex flex-wrap gap-1.5">
                          {TONES.map((t) => <Chip key={t} active={tone === t} onClick={() => setTone(t)}>{t}</Chip>)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ===== AI IMAGE ===== */}
            <div className={`rounded-xl border transition-colors ${outputs.image ? "border-primary bg-primary/5" : outputs.video ? "border-border opacity-50" : "border-border"}`}>
              <button
                type="button"
                onClick={() => {
                  const enabling = !outputs.image;
                  setOutputs((o) => ({ ...o, image: enabling, video: enabling ? false : o.video }));
                  if (enabling) setOpenSection("image");
                  else if (openSection === "image") setOpenSection("text");
                }}
                className="flex w-full items-center gap-4 p-4 text-left"
              >
                <span className="text-lg">🖼️</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">AI Image</div>
                  <div className="text-xs text-muted-foreground">~{liveImageCredits ?? selectedImageModel?.credits ?? 2} credits</div>
                </div>
                <div className={`shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${outputs.image ? "border-primary bg-primary" : "border-border"}`}>
                  {outputs.image && <svg className="h-3 w-3 text-background" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </div>
                {outputs.image && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setOpenSection(openSection === "image" ? "text" : "image"); }}
                    className="shrink-0">
                    <svg className={`h-4 w-4 text-muted-foreground transition-transform ${openSection === "image" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                )}
              </button>
              {outputs.image && openSection === "image" && (
                <div className="px-4 pb-4 border-t border-border/60 pt-4">
                  <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-2">
                    {/* Left col — model, reference, format */}
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-foreground mb-1.5">Image Model <NovaHint hintKey="field:image-model" /></div>
                        <select value={imageModelId || ""} onChange={(e) => setImageModelId(e.target.value)}
                          className="w-full rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                          {!availableModels && <option value="">Loading…</option>}
                          {availableModels?.image.map((m) => (
                            <option key={m.id} value={m.id}>{m.label} — {m.credits}cr</option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                        <div className="text-xs font-semibold text-foreground mb-2">Reference image (optional) <NovaHint hintKey="field:image-reference" /></div>
                        {imageReferenceImage ? (
                          <div className="flex items-center gap-2">
                            <img src={imageReferenceImage} alt="image reference" className="h-12 w-12 rounded-lg border border-border object-cover shrink-0" />
                            <div className="text-[11px] text-emerald-400 flex-1">✓ Photo used as reference.</div>
                            <button onClick={() => setImageReferenceImage(null)} className="shrink-0 rounded-full border border-destructive/40 px-2.5 py-1 text-[11px] text-destructive">Remove</button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1.5 text-[11px] font-semibold text-background">
                              Upload reference
                              <input type="file" accept="image/*" onChange={handleImageReferenceImage} className="hidden" />
                            </label>
                            <span className="text-[11px] text-muted-foreground">No image = AI-imagined</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground mb-1.5">Format <NovaHint hintKey="field:image-format" /></div>
                        <div className="flex gap-2">
                          {[["single", "🖼 Single"], ["carousel", "🎠 Carousel"]].map(([f, l]) => (
                            <button key={f} onClick={() => setFormat(f)}
                              className={`rounded-full border px-3 py-1.5 text-xs ${format === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
                          ))}
                        </div>
                        {format === "carousel" && (
                          <div className="mt-2 flex items-center gap-2">
                            <button onClick={() => setCarouselCount((n) => Math.max(CAROUSEL_MIN_IMAGES, n - 1))} className="grid h-6 w-6 place-items-center rounded-full border border-border text-sm">−</button>
                            <span className="w-5 text-center text-sm font-semibold text-foreground">{carouselCount}</span>
                            <button onClick={() => setCarouselCount((n) => Math.min(CAROUSEL_MAX_IMAGES, n + 1))} className="grid h-6 w-6 place-items-center rounded-full border border-border text-sm">＋</button>
                            <span className="text-[11px] text-muted-foreground">slides · {2 * carouselCount}cr</span>
                          </div>
                        )}
                        {format === "carousel" && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {Array.from({ length: carouselCount }).map((_, i) => (
                              <button key={i} type="button" onClick={() => i !== activeSlide && switchSlide(i, slideThemes)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] ${activeSlide === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                                {i + 1}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Right col — theme + scene */}
                    <div className="space-y-3">
                      <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                        <label className="text-xs font-semibold text-foreground">{imageReferenceImage ? "Placement & surroundings" : "Image description"} <NovaHint hintKey="field:image-describe" /></label>
                        <div className="text-[11px] text-muted-foreground mt-1 mb-2">
                          {imageReferenceImage ? "💡 Describe how to place your product and what surrounds it." : "💡 Describe the background/environment for the AI image."}
                        </div>
                        <div className="flex gap-1.5 mb-2">
                          {([["text", "✏️ Text Theme", "field:text-theme-reference"], ["image", "🖼 Image Theme", "field:image-theme-reference"]] as const).map(([m, l, hintKey]) => (
                            <button key={m} type="button" onClick={() => setRefMode(m)}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${refMode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                              {l} <NovaHint hintKey={hintKey} />
                            </button>
                          ))}
                        </div>
                        {refMode === "text" ? (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Style</label>
                                <select value={selectedTextStyle ?? ""} onChange={(e) => setSelectedTextStyle(e.target.value || null)}
                                  className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                                  <option value="">None</option>
                                  {textTheme.styleTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                                </select>
                              </div>
                              <div className="flex-1">
                                <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Category</label>
                                <select value={selectedTextCategory ?? ""} onChange={(e) => setSelectedTextCategory(e.target.value || null)}
                                  className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                                  <option value="">None</option>
                                  {textTheme.categoryTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                                </select>
                              </div>
                            </div>
                            <TextOverlayFieldsEditor
                              fields={STANDARD_TEXT_FIELDS} fieldValues={themeFieldValues} positions={themePositions}
                              onFieldChange={(key, value) => setThemeFieldValues((prev) => ({ ...prev, [key]: value }))}
                              onPositionChange={(key, value) => setThemePositions((prev) => ({ ...prev, [key]: value }))}
                              stylePresets={themeStyles} onStyleChange={(key, value) => setThemeStyles((prev) => ({ ...prev, [key]: value }))}
                              presetList={textStylePresets}
                            />
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
                                  <button type="button" onClick={() => setShowThemeModal(true)}
                                    className="shrink-0 rounded-full border border-primary/50 px-2 py-1 text-[11px] text-primary">Change</button>
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
                                <TextOverlayFieldsEditor
                                  fields={theme.textFields} fieldValues={themeFieldValues} positions={themePositions}
                                  onFieldChange={(key, value) => setThemeFieldValues((prev) => ({ ...prev, [key]: value }))}
                                  onPositionChange={(key, value) => setThemePositions((prev) => ({ ...prev, [key]: value }))}
                                  stylePresets={themeStyles} onStyleChange={(key, value) => setThemeStyles((prev) => ({ ...prev, [key]: value }))}
                                  presetList={textStylePresets}
                                />
                              ) : (
                                <div className="text-[11px] text-muted-foreground">No text overlay for this theme.</div>
                              );
                            })()}
                          </div>
                        )}
                        <textarea ref={placementTextareaRef} rows={2}
                          value={imageReferenceImage ? envDesc : imageScene}
                          onChange={(e) => (imageReferenceImage ? setEnvDesc(e.target.value) : setImageScene(e.target.value))}
                          placeholder={imageReferenceImage ? "e.g. place bottle upright on a wooden bench, morning sunlight" : "e.g. minimalist studio background, soft top lighting"}
                          className="mt-2 w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        {refMode === "image" && imageTextOverlay && (
                          <div className="mt-1.5 text-[11px] text-muted-foreground bg-background/60 border border-border/60 rounded-lg p-2">
                            <span className="font-semibold text-foreground">Text overlay: </span>{imageTextOverlay}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ===== AI VIDEO ===== */}
            <div className={`rounded-xl border transition-colors ${outputs.video ? "border-primary bg-primary/5" : outputs.image ? "border-border opacity-50" : "border-border"}`}>
              <button
                type="button"
                onClick={() => {
                  const enabling = !outputs.video;
                  setOutputs((o) => ({ ...o, video: enabling, image: enabling ? false : o.image }));
                  if (enabling) setOpenSection("video");
                  else if (openSection === "video") setOpenSection("text");
                }}
                className="flex w-full items-center gap-4 p-4 text-left"
              >
                <span className="text-lg">🎬</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">AI Video</div>
                  <div className="text-xs text-muted-foreground">~{liveVideoCredits ?? selectedVideoModel?.credits ?? 5} credits · takes a few minutes</div>
                </div>
                <div className={`shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${outputs.video ? "border-primary bg-primary" : "border-border"}`}>
                  {outputs.video && <svg className="h-3 w-3 text-background" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </div>
                {outputs.video && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setOpenSection(openSection === "video" ? "text" : "video"); }}
                    className="shrink-0">
                    <svg className={`h-4 w-4 text-muted-foreground transition-transform ${openSection === "video" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                )}
              </button>
              {outputs.video && openSection === "video" && (
                <div className="px-4 pb-4 border-t border-border/60 pt-4">
                  <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-2">

                    {/* Left col — model + reference image */}
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-foreground mb-1.5">Video Model <NovaHint hintKey="field:video-model" /></div>
                        <select value={videoModelId || ""} onChange={(e) => {
                          const id = e.target.value; setVideoModelId(id);
                          const m = availableModels?.video.find((x) => x.id === id);
                          if (m) { setVideoShots((s) => s.length === 1 ? [{ ...s[0], duration: m.min_duration ?? s[0].duration }] : s); setVideoResolution(m.resolutions?.[0] ?? null); }
                        }} className="w-full rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                          {!availableModels && <option value="">Loading…</option>}
                          {availableModels?.video.map((m) => (
                            <option key={m.id} value={m.id}>{m.label} — {m.credits}cr · {m.duration_options ? m.duration_options.map((d) => `${d}s`).join("/") : `${m.min_duration}-${m.max_duration}s`}</option>
                          ))}
                        </select>
                        {selectedVideoModel?.resolutions && selectedVideoModel.resolutions.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="text-[11px] text-muted-foreground">Res:</span>
                            {selectedVideoModel.resolutions.map((r) => (
                              <button key={r} onClick={() => setVideoResolution(r)}
                                className={`rounded-full border px-2 py-0.5 text-[11px] ${videoResolution === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>{r}</button>
                            ))}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-3">
                          {selectedVideoModel?.supports_audio && (
                            <label className="flex items-center gap-1 text-[11px] text-foreground">
                              <input type="checkbox" checked={videoAudio} onChange={(e) => setVideoAudio(e.target.checked)} />
                              🔊 Audio {videoAudio ? "on" : "off"}
                            </label>
                          )}
                          {selectedVideoModel?.duration_options && videoShots.length === 1 && (
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-muted-foreground">Length:</span>
                              {selectedVideoModel.duration_options.map((d) => (
                                <button key={d} onClick={() => setVideoShots((s) => [{ ...s[0], duration: d }])}
                                  className={`rounded-full border px-2 py-0.5 text-[11px] ${videoTotalDuration === d ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{d}s</button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                        <div className="text-xs font-semibold text-foreground mb-2">Reference image (optional) <NovaHint hintKey="field:video-reference" /></div>
                        {selectedVideoModel?.supports_last_frame && (
                          <div className="flex gap-1.5 mb-2">
                            <button onClick={() => setVideoMode("single_reference")} className={`rounded-full border px-2.5 py-1 text-[11px] ${videoMode === "single_reference" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>Single</button>
                            <button onClick={() => setVideoMode("first_last_frame")} className={`rounded-full border px-2.5 py-1 text-[11px] ${videoMode === "first_last_frame" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>Start + end</button>
                          </div>
                        )}
                        {videoFrameImage ? (
                          <div className="flex items-center gap-2">
                            <img src={videoFrameImage} alt="video reference" className="h-12 w-12 rounded-lg border border-border object-cover shrink-0" />
                            <div className="text-[11px] text-emerald-400 flex-1">✓ {videoMode === "first_last_frame" ? "Starting frame" : "Starting frame set"}.</div>
                            <button onClick={() => { setVideoFrameImage(null); setVideoReferencePrompt(""); setShowVideoReferencePrompt(false); }} className="shrink-0 rounded-full border border-destructive/40 px-2.5 py-1 text-[11px] text-destructive">Remove</button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1.5 text-[11px] font-semibold text-background">
                              {videoMode === "first_last_frame" ? "Upload start frame" : "Upload image"}
                              <input type="file" accept="image/*" onChange={handleVideoFrameImage} className="hidden" />
                            </label>
                            {imageReferenceImage && (
                              <button onClick={() => setVideoFrameImage(imageReferenceImage)} className="rounded-full border border-border px-2.5 py-1.5 text-[11px] text-foreground hover:border-primary/40">Use image above</button>
                            )}
                            {videoMode === "single_reference" && <span className="text-[11px] text-muted-foreground">No image = text-to-video</span>}
                          </div>
                        )}
                        {videoMode === "single_reference" && videoFrameImage && (
                          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground">
                            <input type="checkbox" checked={refineVideoFrame} onChange={(e) => setRefineVideoFrame(e.target.checked)} />
                            🎨 Match background to shot 1 scene
                          </label>
                        )}
                        {videoMode === "first_last_frame" && (
                          videoEndFrameImage ? (
                            <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
                              <img src={videoEndFrameImage} alt="video end frame" className="h-12 w-12 rounded-lg border border-border object-cover shrink-0" />
                              <div className="text-[11px] text-emerald-400 flex-1">✓ Ending frame set.</div>
                              <button onClick={() => setVideoEndFrameImage(null)} className="shrink-0 rounded-full border border-destructive/40 px-2.5 py-1 text-[11px] text-destructive">Remove</button>
                            </div>
                          ) : (
                            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                              <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1.5 text-[11px] font-semibold text-background">
                                Upload ending frame
                                <input type="file" accept="image/*" onChange={handleVideoEndFrameImage} className="hidden" />
                              </label>
                              <span className="text-[11px] text-muted-foreground">Required for start + end</span>
                            </div>
                          )
                        )}
                        {videoFrameImage && (
                          <div className="mt-2 border-t border-border/60 pt-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-semibold text-foreground">🔗 Reference preservation</span>
                              <button onClick={() => setShowVideoReferencePrompt((v) => !v)} className="text-[10px] text-primary hover:underline">{showVideoReferencePrompt ? "Hide" : "Edit"}</button>
                            </div>
                            {showVideoReferencePrompt ? (
                              <textarea rows={2} value={videoReferencePrompt || videoReferencePromptDefault} onChange={(e) => setVideoReferencePrompt(e.target.value)}
                                className="w-full rounded-lg border border-input bg-input/40 p-2 text-[11px] text-foreground focus:border-primary focus:outline-none resize-y" />
                            ) : (
                              <p className="text-[11px] text-muted-foreground line-clamp-1 italic">{videoReferencePrompt || videoReferencePromptDefault}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {(() => {
                        const readyIntros = brandVideoShots.filter((s) => s.kind === "intro" && s.status === "ready");
                        const readyOutros = brandVideoShots.filter((s) => s.kind === "outro" && s.status === "ready");
                        if (readyIntros.length === 0 && readyOutros.length === 0) return null;
                        const shotName = (s: typeof readyIntros[number]) => s.label || (s.prompt.length > 30 ? s.prompt.slice(0, 30) + "…" : s.prompt);
                        return (
                          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                            <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">Brand intro / outro <NovaHint hintKey="field:video-intro-credits" /></div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <div className="text-[11px] text-muted-foreground mb-1">Start shot</div>
                                <select value={videoStartShotId || ""} onChange={(e) => setVideoStartShotId(e.target.value || null)}
                                  className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                                  <option value="">None</option>
                                  {readyIntros.map((s) => <option key={s.id} value={s.id}>{shotName(s)} ({s.duration}s)</option>)}
                                </select>
                              </div>
                              <div>
                                <div className="text-[11px] text-muted-foreground mb-1">End shot</div>
                                <select value={videoEndShotId || ""} onChange={(e) => setVideoEndShotId(e.target.value || null)}
                                  className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                                  <option value="">None</option>
                                  {readyOutros.map((s) => <option key={s.id} value={s.id}>{shotName(s)} ({s.duration}s)</option>)}
                                </select>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Right col — camera, music, shots */}
                    <div className="space-y-3">
                      {cameraStylePresets.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold text-foreground mb-1.5">🎥 Camera style <span className="font-normal text-muted-foreground">(pick any)</span></div>
                          <div className="flex flex-wrap gap-1">
                            {cameraStylePresets.map((p) => {
                              const active = videoCameraStyleIds.includes(p.id);
                              return (
                                <button key={p.id} type="button"
                                  onClick={() => setVideoCameraStyleIds((ids) => active ? ids.filter((x) => x !== p.id) : [...ids, p.id])}
                                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                                  {active ? "✓ " : ""}{p.label}
                                </button>
                              );
                            })}
                          </div>
                          {videoCameraStyleIds.length > 0 && (
                            <button onClick={() => setVideoCameraStyleIds([])} className="mt-1 text-[10px] text-muted-foreground hover:text-foreground">Clear all</button>
                          )}
                        </div>
                      )}

                      {musicPresets.length > 0 && (
                        <div>
                          <label className="text-[11px] font-semibold text-foreground mb-1 block">🎵 Background music</label>
                          <select value={videoBackgroundMusicId} onChange={(e) => setVideoBackgroundMusicId(e.target.value)}
                            className="w-full rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                            {musicPresets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                          </select>
                          {videoBackgroundMusicId !== "none" && (() => {
                            const sel = musicPresets.find((p) => p.id === videoBackgroundMusicId);
                            return sel?.description ? <p className="mt-1 text-[10px] text-muted-foreground">{sel.description}</p> : null;
                          })()}
                        </div>
                      )}

                      <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                        <div className="flex gap-1.5 mb-3">
                          {([["custom", "✏️ Custom shots"], ["theme", "🎬 Video Theme"]] as const).map(([m, l]) => (
                            <button key={m} type="button" onClick={() => setVideoRefMode(m)}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${videoRefMode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>{l}</button>
                          ))}
                          <NovaHint hintKey="field:video-theme" />
                        </div>

                        {videoRefMode === "theme" ? (
                          <div>
                            {selectedVideoThemeId ? (() => {
                              const theme = videoThemes.find((t) => t.id === selectedVideoThemeId)!;
                              return (
                                <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 mb-2">
                                  {theme.thumbnail ? (
                                    <img src={theme.thumbnail} alt={theme.label} className="h-10 w-10 rounded object-cover shrink-0" />
                                  ) : (
                                    <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center shrink-0 text-xl">🎬</div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[11px] font-semibold text-foreground">{theme.label}</div>
                                    <div className="text-[10px] text-muted-foreground">{theme.shots.length} shots · {theme.shots.reduce((s, x) => s + x.duration, 0)}s</div>
                                  </div>
                                  <button type="button" onClick={() => setShowVideoThemeModal(true)}
                                    className="shrink-0 rounded-full border border-primary/50 px-2 py-1 text-[11px] text-primary">Change</button>
                                </div>
                              );
                            })() : (
                              <button type="button" onClick={() => setShowVideoThemeModal(true)}
                                className="w-full mb-2 rounded-lg border border-dashed border-primary/50 px-3 py-3 text-[11px] text-primary hover:bg-primary/5 flex items-center justify-center gap-1">
                                🎬 Browse video themes
                              </button>
                            )}
                            {selectedVideoThemeId && (
                              <div className="space-y-1.5">
                                <div className="text-[11px] text-muted-foreground">Shot prompts — edit if needed:</div>
                                {videoShots.map((shot, i) => {
                                  const themeShot = videoThemes.find((t) => t.id === selectedVideoThemeId)?.shots[i];
                                  return (
                                    <div key={i} className="rounded-lg border border-border/60 bg-card/40 p-2 space-y-1.5">
                                      <div className="flex items-start gap-1.5">
                                        <span className="shrink-0 w-4 text-[11px] text-muted-foreground mt-0.5">#{i + 1}</span>
                                        <div className="flex-1 min-w-0">
                                          {themeShot && <div className="text-[10px] text-primary font-medium mb-0.5">{themeShot.label}</div>}
                                          <textarea rows={2} value={shot.prompt}
                                            onChange={(e) => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, prompt: e.target.value } : x))}
                                            className="w-full rounded-lg border border-input bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
                                        </div>
                                        <span className="shrink-0 text-[11px] text-muted-foreground mt-1">{shot.duration}s</span>
                                      </div>
                                      {!shot.showVoiceover ? (
                                        <button onClick={() => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, showVoiceover: true } : x))}
                                          className="ml-5 flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-secondary"><span>＋</span> Voice-over</button>
                                      ) : (
                                        <div className="pl-5 space-y-1">
                                          <div className="flex items-center justify-between"><label className="text-[10px] font-semibold text-secondary">🎙 Voice-over</label><button onClick={() => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, showVoiceover: false, voiceoverText: "" } : x))} className="text-[10px] text-muted-foreground hover:text-destructive">✕</button></div>
                                          <textarea rows={1} value={shot.voiceoverText || ""} onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, voiceoverText: e.target.value } : x))}
                                            placeholder="Narration for this shot…"
                                            className="w-full rounded-lg border border-secondary/30 bg-secondary/5 p-1.5 text-[11px] text-foreground focus:border-secondary/60 focus:outline-none resize-y" />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            {/* Global negative prompt */}
                            <div className="mb-2">
                              {showVideoNegativePrompt ? (
                                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-semibold text-amber-400">🚫 Negative prompt</span>
                                    <button onClick={() => { setShowVideoNegativePrompt(false); setVideoNegativePrompt(""); }} className="text-[10px] text-muted-foreground hover:text-destructive">✕</button>
                                  </div>
                                  <textarea rows={2} value={videoNegativePrompt} onChange={(e) => setVideoNegativePrompt(e.target.value)}
                                    placeholder="e.g. No warped geometry, no flickering, no artifacts"
                                    className="w-full rounded-lg border border-amber-500/30 bg-background/40 p-1.5 text-[11px] text-foreground focus:border-amber-500/60 focus:outline-none resize-y" />
                                </div>
                              ) : (
                                <button onClick={() => setShowVideoNegativePrompt(true)}
                                  className="flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-amber-500/50 hover:text-amber-400">
                                  <span>＋</span> Negative prompt
                                </button>
                              )}
                            </div>

                            {/* Shot controls */}
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[11px] text-muted-foreground">Shots</span>
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => setVideoShots((s) => s.length > 1 ? s.slice(0, -1) : s)} disabled={videoShots.length <= 1}
                                  className="grid h-6 w-6 place-items-center rounded-full border border-border text-sm disabled:opacity-40">−</button>
                                <span className="w-5 text-center text-sm font-semibold text-foreground">{videoShots.length}</span>
                                <button onClick={() => setVideoShots((s) => s.length < MAX_VIDEO_SHOTS ? [...s, { prompt: "", duration: 6 }] : s)} disabled={videoShots.length >= MAX_VIDEO_SHOTS}
                                  className="grid h-6 w-6 place-items-center rounded-full border border-border text-sm disabled:opacity-40">＋</button>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              {videoShots.map((shot, i) => (
                                <div key={i} className="rounded-lg border border-border/60 bg-card/40 p-2 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-4 shrink-0 text-[11px] text-muted-foreground">#{i + 1}</span>
                                    <input placeholder={videoShots.length > 1 ? `Shot ${i + 1} — angle, action` : "Describe this shot (optional)"}
                                      value={shot.prompt} onChange={(e) => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, prompt: e.target.value } : x))}
                                      className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
                                    <input type="number" value={shot.duration}
                                      disabled={!!(selectedVideoModel?.duration_options && videoShots.length === 1)}
                                      onChange={(e) => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, duration: Number(e.target.value) || 0 } : x))}
                                      className="w-12 shrink-0 rounded-lg border border-input bg-input/40 px-1.5 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none disabled:opacity-50" />
                                    <span className="shrink-0 text-[11px] text-muted-foreground">s</span>
                                  </div>

                                  {/* Per-shot extras */}
                                  <div className="flex flex-wrap gap-1.5 pl-5">
                                    {!shot.showOverlays ? (
                                      <button onClick={() => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, showOverlays: true, textOverlays: x.textOverlays || [] } : x))}
                                        className="flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary">
                                        <span>＋</span> Text overlay</button>
                                    ) : <span className="text-[10px] font-medium text-primary">💬 Overlays</span>}
                                    {!shot.showVoiceover ? (
                                      <button onClick={() => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, showVoiceover: true } : x))}
                                        className="flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-secondary/50 hover:text-secondary">
                                        <span>＋</span> Voice-over</button>
                                    ) : <span className="text-[10px] font-medium text-secondary">🎙 Voice-over</span>}
                                  </div>

                                  {/* Text overlays panel */}
                                  {shot.showOverlays && (
                                    <div className="pl-5 space-y-1.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-muted-foreground">Text overlays</span>
                                        <button onClick={() => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, textOverlays: [...(x.textOverlays || []), { text: "", startTime: 0, endTime: null, position: "bottom-center", fontStyle: "sans", fontSize: "medium", textColor: "#FFFFFF", overlayStyle: "fade" }] } : x))}
                                          className="rounded-full border border-primary/50 px-1.5 py-0.5 text-[10px] text-primary">＋ Add</button>
                                      </div>
                                      {(shot.textOverlays || []).map((ov, oi) => (
                                        <div key={oi} className="rounded-lg border border-border/60 bg-background/50 p-1.5 space-y-1.5">
                                          <div className="flex items-center gap-1.5">
                                            <input placeholder={`"The wait is almost over."`} value={ov.text}
                                              onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, text: e.target.value } : o) } : x))}
                                              className="flex-1 rounded-lg border border-input bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none" />
                                            <button onClick={() => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).filter((_, oi2) => oi2 !== oi) } : x))}
                                              className="shrink-0 rounded-full border border-destructive/40 px-1.5 py-0.5 text-[10px] text-destructive">✕</button>
                                          </div>
                                          <div className="grid grid-cols-4 gap-1">
                                            <div><label className="text-[9px] text-muted-foreground">Start s</label>
                                              <input type="number" min="0" step="0.5" value={ov.startTime}
                                                onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, startTime: Number(e.target.value) || 0 } : o) } : x))}
                                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground" /></div>
                                            <div><label className="text-[9px] text-muted-foreground">End s</label>
                                              <input type="number" min="0" step="0.5" value={ov.endTime ?? ""} placeholder="end"
                                                onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, endTime: e.target.value === "" ? null : Number(e.target.value) } : o) } : x))}
                                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground" /></div>
                                            <div><label className="text-[9px] text-muted-foreground">Position</label>
                                              <select value={ov.position} onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, position: e.target.value } : o) } : x))}
                                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                                {POSITION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
                                            <div><label className="text-[9px] text-muted-foreground">Style</label>
                                              <select value={ov.overlayStyle} onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, overlayStyle: e.target.value } : o) } : x))}
                                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                                <option value="fade">Fade</option><option value="solid">Solid</option><option value="slide_up">Slide up</option></select></div>
                                          </div>
                                          <div className="grid grid-cols-3 gap-1">
                                            <div><label className="text-[9px] text-muted-foreground">Font</label>
                                              <select value={ov.fontStyle} onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, fontStyle: e.target.value } : o) } : x))}
                                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                                <option value="sans">Sans</option><option value="sans_bold">Bold</option><option value="serif">Serif</option></select></div>
                                            <div><label className="text-[9px] text-muted-foreground">Size</label>
                                              <select value={ov.fontSize} onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, fontSize: e.target.value } : o) } : x))}
                                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                                <option value="small">Sm</option><option value="medium">Md</option><option value="large">Lg</option></select></div>
                                            <div><label className="text-[9px] text-muted-foreground">Color</label>
                                              <div className="flex items-center gap-1">
                                                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(ov.textColor) ? ov.textColor : "#FFFFFF"}
                                                  onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, textColor: e.target.value } : o) } : x))}
                                                  className="h-6 w-7 rounded border border-border bg-transparent shrink-0" />
                                                <input value={ov.textColor} onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, textColor: e.target.value } : o) } : x))}
                                                  className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[10px] text-foreground" /></div></div>
                                          </div>
                                        </div>
                                      ))}
                                      {(shot.textOverlays || []).length > 0 && (
                                        <button onClick={() => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, showOverlays: false } : x))}
                                          className="text-[10px] text-muted-foreground hover:text-foreground">↑ Hide</button>
                                      )}
                                    </div>
                                  )}

                                  {/* Voice-over panel */}
                                  {shot.showVoiceover && (
                                    <div className="pl-5 space-y-1">
                                      <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-semibold text-secondary">🎙 Voice-over</label>
                                        <button onClick={() => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, showVoiceover: false, voiceoverText: "" } : x))} className="text-[10px] text-muted-foreground hover:text-destructive">✕</button>
                                      </div>
                                      <textarea rows={1} value={shot.voiceoverText || ""} onChange={(e) => setVideoShots((s) => s.map((x, xi) => xi === i ? { ...x, voiceoverText: e.target.value } : x))}
                                        placeholder="Narration for this shot…"
                                        className="w-full rounded-lg border border-secondary/30 bg-secondary/5 p-1.5 text-[11px] text-foreground focus:border-secondary/60 focus:outline-none resize-y" />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="mt-2 flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground">Total: {videoTotalDuration}s</span>
                              {selectedVideoModel && (
                                <span className="text-muted-foreground">
                                  {selectedVideoModel.duration_options
                                    ? `Allowed: ${selectedVideoModel.duration_options.map((d) => `${d}s`).join(", ")}`
                                    : `Allowed: ${selectedVideoModel.min_duration}–${selectedVideoModel.max_duration}s`}
                                </span>
                              )}
                            </div>
                            {!videoShotsValid && selectedVideoModel && (
                              <div className="mt-1 rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                                ⚠ {videoTotalDuration}s total is outside what this model allows.
                              </div>
                            )}
                            <label className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground">
                              <input type="checkbox" checked={refineVideoPrompt} onChange={(e) => setRefineVideoPrompt(e.target.checked)} />
                              ✨ Refine shot wording with AI before generating
                            </label>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>

          </div>

          {(brandTagline || brandLogoUrl) && (
            <div className="mt-4 rounded-xl border border-border bg-background/40 p-5">
              <div className="text-sm font-medium text-foreground">🎨 Brand kit <span className="ml-2 text-xs text-muted-foreground font-normal">Tick brand elements to insert into this ad.</span></div>
              {brandLogoUrl && (
                <label className="mt-4 flex items-center gap-3 text-sm text-foreground">
                  <input type="checkbox" checked={useLogo} onChange={(e) => setUseLogo(e.target.checked)} />
                  <img src={brandLogoUrl} alt="logo" className="h-6 w-6 rounded border border-border object-cover" />
                  Include our logo on the generated image
                </label>
              )}
              {brandTagline && (
                <label className="mt-3 flex items-center gap-3 text-sm text-foreground">
                  <input type="checkbox" checked={useTagline} onChange={(e) => setUseTagline(e.target.checked)} />
                  Weave in our tagline: <span className="italic text-primary">"{brandTagline}"</span>
                </label>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">Manage your logo, placement, color, and tagline in <a href="/app/brand-kit" className="text-primary">Brand Kit</a>.</p>
            </div>
          )}

          <div className="mt-4 rounded-xl border border-border bg-background/40 p-5">
            <div className="text-sm font-medium text-foreground">📢 Target platforms</div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {availablePlatforms.map((p) => (
                <button key={p.id} onClick={() => setSelected((s) => ({ ...s, [p.id]: !s[p.id] }))}
                  className={`flex items-center gap-3 rounded-xl p-4 border ${selected[p.id] ? "border-primary bg-primary/5" : "border-border"}`}>
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
                  <div className="text-left text-sm text-foreground">{selected[p.id] ? "☑" : "☐"} {p.name}</div>
                </button>
              ))}
            </div>
          </div>

          <RequirementChecklist items={[
            { label: "Product name", met: !!productName.trim() },
            { label: "Description (min 10 characters)", met: description.trim().length >= 10 },
            { label: "Target audience", met: !!audience.trim() },
            { label: "At least one output (text / image / video)", met: !!(outputs.text || outputs.image || outputs.video) },
            { label: "Image model selected", met: !outputs.image || !!imageModelId },
            { label: "Video model selected", met: !outputs.video || !!videoModelId },
            { label: "Text model selected", met: !outputs.text || !!textModelId },
            { label: "Sufficient credits", met: credits >= cost },
          ]} />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              disabled={!productName.trim() || description.trim().length < 10 || !audience.trim() || (!outputs.text && !outputs.image && !outputs.video) || !videoShotsValid || (outputs.video && videoMode === "first_last_frame" && (!videoFrameImage || !videoEndFrameImage)) || credits < cost || previewBusy}
              onClick={openPromptPreview}
              className="rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-40"
            >
              {previewBusy ? "Building prompts…" : credits < cost ? `Needs ${cost} credits — ${credits} left` : `Review prompts & generate (${cost} credit${cost > 1 ? "s" : ""}) →`}
            </button>
            <button
              disabled={!productName.trim() || savingProduct}
              onClick={saveToLibrary}
              className="rounded-full border border-border px-4 py-2.5 text-xs text-muted-foreground hover:border-primary/40 disabled:opacity-40"
            >
              {savingProduct ? "Saving…" : "📦 Save to product library"}
            </button>
            <button
              onClick={clearBrief}
              className="rounded-full border border-border px-4 py-2.5 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            >
              Clear
            </button>
            <button onClick={cancelWizard} className="rounded-full border border-destructive/40 px-5 py-2.5 text-sm text-destructive hover:bg-destructive/5">Cancel</button>
            {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
          </div>
        </Panel>
      )}

      {step === 2 && busy && (
        <Panel className="text-center py-14">
          <div className="text-3xl animate-pulse">✦</div>
          <div className="mt-3 font-semibold text-foreground">Generating your ads…</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {outputs.video
              ? "Writing platform-specific copy · rendering your video (this genuinely takes a few minutes — hang tight) · running safety checks"
              : "Writing platform-specific copy · composing images · running safety checks"}
          </div>
          <button onClick={cancelWizard} className="mt-5 rounded-full border border-destructive/40 px-5 py-2 text-xs text-destructive hover:bg-destructive/5">Cancel</button>
        </Panel>
      )}

      {step === 3 && results && (
        <div>
          {retentionMonths != null && (
            <div className="mb-4 rounded-lg border border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
              📦 This media will be stored for {retentionMonths} month{retentionMonths !== 1 ? "s" : ""} from today, then automatically removed as per the platform policy.
              {" "}If you're scheduling this ad, it must be posted within that same {retentionMonths}-month window.
              {postRetentionMonths != null && <> The full post record is kept for up to {postRetentionMonths} months, after which it's permanently deleted.</>}
              {" "}Download a copy if you want to keep it longer.
            </div>
          )}
          {variants && variants.length > 1 && (
            <div className="mb-4 flex gap-2">
              {variants.map((_, i) => (
                <button key={i} onClick={() => setActiveVariant(i)} className={`rounded-full border px-3 py-1 text-xs ${activeVariant === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>Variant {String.fromCharCode(65 + i)}</button>
              ))}
            </div>
          )}
          {referenceRejectedMsg ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs text-amber-400">
              <div>⚠ Your reference photo was rejected by the AI provider: <span className="text-amber-300">{referenceRejectedMsg}</span></div>
              <div className="mt-1 text-amber-400/80">Nothing was generated yet — no credits were spent for this attempt. Want to try again without the reference photo (fully AI-imagined instead)? This will cost {cost} credit{cost > 1 ? "s" : ""}.</div>
              <div className="mt-2 flex items-center gap-2">
                <button disabled={retryingWithoutRef || credits < cost} onClick={retryWithoutReference} className="rounded-full bg-gold-gradient px-4 py-1.5 text-[11px] font-semibold text-background disabled:opacity-50">
                  {retryingWithoutRef ? "Retrying…" : credits < cost ? `Needs ${cost} credits — ${credits} left` : "Retry without reference photo"}
                </button>
                <button onClick={() => setReferenceRejectedMsg("")} className="rounded-full border border-amber-500/40 px-4 py-1.5 text-[11px] text-amber-400">Dismiss</button>
              </div>
            </div>
          ) : warning && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-400">⚠ Copy generated successfully, but the image had a problem: {warning}</div>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {(chosenPlatforms.length > 0 ? chosenPlatforms : [DEFAULT_PLATFORM]).map((p) => (
              <PlatformPreviewCard
                key={p.id}
                platform={p}
                result={results[p.id]}
                imageUrl={results.image_url}
                imageUrls={results.image_urls}
                videoUrl={results.video_url}
                companyName={me?.company_name || ""}
                posted={!!postedMap[p.id]}
                onPost={() => postPlatform(p.id)}
                onEditCaption={(text) => setVariants((vs) => {
                  if (!vs) return vs;
                  const copy = [...vs];
                  copy[activeVariant] = { ...copy[activeVariant], [p.id]: { ...copy[activeVariant][p.id], caption: text } };
                  return copy;
                })}
              />
            ))}
          </div>
          <Panel className="mt-6">
            <div className="text-sm font-semibold text-foreground">✏️ Edit copy</div>
            <p className="mt-1 text-[11px] text-muted-foreground">Regenerates the caption based on your feedback. Free.</p>
            <div className="mt-3 flex gap-2">
              <Input placeholder='e.g. "make it shorter and add urgency"' value={refineText} onChange={(e) => setRefineText(e.target.value)} />
              <button disabled={!refineText || busy} onClick={() => generate(refineText)} className="rounded-full border border-primary/50 text-primary px-5 text-sm disabled:opacity-40">{busy ? "Applying…" : "Regenerate"}</button>
            </div>
          </Panel>
          {outputs.image && (
            <Panel className="mt-4">
              <div className="text-sm font-semibold text-foreground">🖼️ Edit image</div>
              <p className="mt-1 text-[11px] text-muted-foreground">Describe how to change the image (e.g. "zoom out so the whole bottle is visible", "make the background brighter"). Uses the current image as the reference. Costs the same as generating a new image.</p>
              <div className="mt-3 flex gap-2">
                <Input placeholder='e.g. "zoom out so the whole product is visible"' value={imageEditText} onChange={(e) => setImageEditText(e.target.value)} />
                <button disabled={!imageEditText || busy} onClick={editImage} className="rounded-full border border-secondary/50 text-secondary px-5 text-sm disabled:opacity-40">{busy ? "Editing…" : "Edit"}</button>
              </div>
            </Panel>
          )}
          <Panel className="mt-4">
            <div className="mt-1 flex flex-wrap gap-3">
              {chosenPlatforms.length > 0 && <button onClick={postAll} className="rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)]">🚀 Post all ({chosenPlatforms.filter((p) => !postedMap[p.id]).length} remaining)</button>}
              <button onClick={() => setShowSchedule((v) => !v)} className="rounded-full border-2 border-secondary px-6 py-2.5 text-sm font-semibold text-secondary hover:bg-secondary/10">
                🗓 Schedule for later
              </button>
              <button onClick={resetWizard} className="rounded-full border border-border px-6 py-2.5 text-sm text-muted-foreground hover:border-primary/40">Create another ad</button>
              <button onClick={cancelWizard} className="rounded-full border border-destructive/40 px-6 py-2.5 text-sm text-destructive hover:bg-destructive/5">Cancel</button>
            </div>

            {showSchedule && (
              <div className="mt-4 rounded-lg border border-secondary/40 bg-secondary/5 p-4">
                <div className="mb-2 text-xs font-semibold text-foreground">Which platforms should this schedule cover?</div>
                <div className="flex flex-wrap gap-1.5">
                  {(chosenPlatforms.length > 0 ? chosenPlatforms : [DEFAULT_PLATFORM]).map((p) => {
                    const isChecked = schedulePlatforms[p.id] ?? !postedMap[p.id];
                    return (
                      <button key={p.id} onClick={() => setSchedulePlatforms((s) => ({ ...s, [p.id]: !isChecked }))}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${isChecked ? "border-secondary bg-secondary/10 text-secondary" : "border-border text-muted-foreground"}`}>
                        {isChecked ? "☑" : "☐"} {p.name}{postedMap[p.id] ? " (already posted)" : ""}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                    className="rounded-lg border border-input bg-input/40 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
                  <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                    className="rounded-lg border border-input bg-input/40 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
                  <TimezoneSelect value={timeZone} onChange={setTimeZone} />
                </div>
                {scheduledMsg ? (
                  <div className="mt-3 text-xs text-secondary">{scheduledMsg}</div>
                ) : (
                  <button disabled={scheduling || !scheduleDate || chosenPlatforms.filter((p) => (schedulePlatforms[p.id] ?? !postedMap[p.id])).length === 0} onClick={scheduleSelected}
                    className="mt-3 w-full rounded-full bg-secondary px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
                    {scheduling ? "Scheduling…" : `Confirm schedule for ${chosenPlatforms.filter((p) => (schedulePlatforms[p.id] ?? !postedMap[p.id])).length} platform(s)`}
                  </button>
                )}
              </div>
            )}
          </Panel>
        </div>
      )}

      {showThemeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowThemeModal(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-foreground">Choose an image theme</div>
              <button type="button" onClick={() => setShowThemeModal(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
            </div>
            <ImageThemeGrid
              themes={imageThemes}
              selectedId={selectedImageTheme}
              onSelect={(t) => { setSelectedImageTheme(t.id); setThemeFieldValues({}); setThemePositions({}); setShowThemeModal(false); }}
            />
          </div>
        </div>
      )}

      {showVideoThemeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowVideoThemeModal(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-foreground">Choose a video theme</div>
              <button type="button" onClick={() => setShowVideoThemeModal(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
            </div>
            <VideoThemeGrid
              themes={videoThemes}
              selectedId={selectedVideoThemeId}
              onSelect={(t) => {
                setSelectedVideoThemeId(t.id);
                const resolved = t.shots.map((s) => ({
                  prompt: s.prompt_template.replace(/\{product\}/g, productName.trim() || "the product"),
                  duration: s.duration,
                }));
                setVideoShots(resolved);
                setShowVideoThemeModal(false);
              }}
            />
          </div>
        </div>
      )}

      {showPromptModal && (
        <PromptConfirmModal
          textPrompt={textPrompt} setTextPrompt={setTextPrompt}
          imagePrompt={imagePrompt} setImagePrompt={setImagePrompt}
          videoPrompt={videoPrompt} setVideoPrompt={setVideoPrompt}
          hasImage={outputs.image} isCarousel={format === "carousel"}
          hasVideo={outputs.video} isMultiShot={videoShots.length > 1}
          cost={cost} busy={busy}
          onBack={() => setShowPromptModal(false)}
          onConfirm={() => { setShowPromptModal(false); setStep(2); generate(); }}
          retentionMonths={retentionMonths} postRetentionMonths={postRetentionMonths}
        />
      )}
    </AppShell>
  );
}
