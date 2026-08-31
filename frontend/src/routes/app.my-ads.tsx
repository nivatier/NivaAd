import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell, EmptyState, Input } from "@/components/app-shell";
import { RepostModal } from "@/components/repost-modal";
import { PLATFORMS, RetentionWarning } from "@/components/create-ad-parts";
import { useConnectedPlatforms } from "@/hooks/use-connected-platforms";
import { detectedTimeZone, formatInTimeZone } from "@/lib/timezone";
import { api, type AdListOut, type AdOut, type ProductOut } from "@/lib/api";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/my-ads")({
  component: MyAds,
  head: () => ({ meta: [{ title: "My Ads — NivaSpark" }] }),
});

const PAGE_SIZE = 10;
const PHASE_LABEL: Record<string, string> = { teaser: "Teaser", launch: "Launch", followup: "Follow-up" };

type CampaignLite = { id: string; name: string };

const STATUS_COLOR: Record<string, string> = {
  posted: "text-primary",
  scheduled: "text-secondary",
  pending_approval: "text-amber-400",
  ready: "text-muted-foreground",
  generating: "text-amber-400",
  failed: "text-destructive",
  draft: "text-muted-foreground",
};

function briefTitle(ad: AdOut) {
  const b = ad.brief as any;
  return b?.product_name ? `${b.product_name} — ${b.description || ""}` : ad.id;
}

function contentTypeTag(ad: AdOut): { label: string; icon: string } {
  const o = ad.outputs as any;
  const hasText  = !!o?.text;
  const hasImage = !!o?.image;
  const hasVideo = !!o?.video;
  if (hasText && hasVideo)  return { icon: "🎬", label: "Text + Video" };
  if (hasText && hasImage)  return { icon: "🖼", label: "Text + Image" };
  if (hasText)              return { icon: "✍️", label: "Text only" };
  if (hasVideo)             return { icon: "🎬", label: "Video only" };
  if (hasImage)             return { icon: "🖼", label: "Image only" };
  return                           { icon: "📄", label: "Ad" };
}

// ── Posting Status Modal ──────────────────────────────────────────────────────
function PostingStatusModal({ ad, onClose }: { ad: AdOut; onClose: () => void }) {
  const { platforms: allPlatforms } = useConnectedPlatforms();

  // All platforms this ad was created for
  const adPlatforms = ad.platforms.filter((p) => p !== "default");

  // Posted platforms — could have been posted to platforms not in original creation
  // (via "Add Platform" feature), so union both sets
  const allInvolvedIds = Array.from(new Set([...adPlatforms, ...ad.posted_platforms]));

  function getPlatform(id: string) {
    return allPlatforms.find((p) => p.id === id) ?? PLATFORMS.find((p) => p.id === id) ?? { id, name: id, tag: "?", color: "#6366f1", ratio: "1:1" };
  }

  const scheduledByPlatform: Record<string, { scheduled_at: string; status: string }> = {};
  for (const sp of ad.scheduled_posts) {
    scheduledByPlatform[sp.platform] = { scheduled_at: sp.scheduled_at, status: sp.status };
  }

  function getStatus(platformId: string): { label: string; color: string; icon: string } {
    if (ad.posted_platforms.includes(platformId)) {
      return { label: "Posted", color: "text-emerald-400", icon: "✓" };
    }
    if (scheduledByPlatform[platformId]) {
      const sp = scheduledByPlatform[platformId];
      if (sp.status === "failed")   return { label: "Schedule failed", color: "text-destructive", icon: "✕" };
      if (sp.status === "posted")   return { label: "Posted (scheduled)", color: "text-emerald-400", icon: "✓" };
      return { label: `Scheduled · ${formatInTimeZone(sp.scheduled_at, detectedTimeZone())}`, color: "text-secondary", icon: "🗓" };
    }
    if (adPlatforms.includes(platformId)) {
      return { label: "Not posted yet", color: "text-muted-foreground", icon: "○" };
    }
    return { label: "Added later — not posted yet", color: "text-muted-foreground", icon: "○" };
  }

  const postedCount = ad.posted_platforms.length;
  const scheduledCount = ad.scheduled_posts.filter((sp) => sp.status === "pending").length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-border bg-card/95 backdrop-blur-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-foreground">Posting status</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {postedCount > 0 && <span className="text-emerald-400">{postedCount} posted</span>}
              {postedCount > 0 && scheduledCount > 0 && <span className="text-muted-foreground"> · </span>}
              {scheduledCount > 0 && <span className="text-secondary">{scheduledCount} scheduled</span>}
              {postedCount === 0 && scheduledCount === 0 && <span>Not posted to any platform yet</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* Platform list */}
        <div className="p-4 space-y-2">
          {allInvolvedIds.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No platforms selected when this ad was created.<br />
              Open Preview / Repost to add platforms and post.
            </div>
          ) : (
            allInvolvedIds.map((platformId) => {
              const p = getPlatform(platformId);
              const status = getStatus(platformId);
              return (
                <div key={platformId} className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5">
                  <span className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-950" style={{ background: p.color }}>
                    {p.tag}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground">{p.name}</div>
                    <div className={`text-[10px] ${status.color}`}>{status.icon} {status.label}</div>
                  </div>
                  {ad.posted_platforms.includes(platformId) && (
                    <div className="shrink-0">
                      <span className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-[9px] text-emerald-400">✓</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {ad.posted_at && (
          <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
            First posted {formatInTimeZone(ad.posted_at, detectedTimeZone())}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Prompt Preview Modal ──────────────────────────────────────────────────────
type GenerationPrompts = {
  job_id: string;
  text_prompt: string | null;
  image_prompt: string | null;
  video_prompt: string | null;
};

function PromptModal({ ad, onClose, onRegenerated }: { ad: AdOut; onClose: () => void; onRegenerated: () => void }) {
  const [prompts, setPrompts] = useState<GenerationPrompts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [textPrompt, setTextPrompt] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");

  const [regenerating, setRegenerating] = useState(false);
  const [regenErr, setRegenErr] = useState("");
  const [regenDone, setRegenDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load prompts on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadErr("");
      try {
        const data: GenerationPrompts = await api(`/ads/${ad.id}/prompts`);
        setPrompts(data);
        setTextPrompt(data.text_prompt ?? "");
        setImagePrompt(data.image_prompt ?? "");
        setVideoPrompt(data.video_prompt ?? "");
      } catch (e: any) {
        setLoadErr(e.message || "Could not load prompts.");
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [ad.id]);

  async function handleRegenerate() {
    setRegenerating(true);
    setRegenErr("");
    try {
      const body: Record<string, string> = {};
      if (textPrompt.trim()) body.text_prompt = textPrompt.trim();
      if (imagePrompt.trim()) body.image_prompt = imagePrompt.trim();
      if (videoPrompt.trim()) body.video_prompt = videoPrompt.trim();

      await api(`/ads/${ad.id}/regenerate`, { method: "POST", body });

      // Poll the ad until it's no longer "generating"
      pollRef.current = setInterval(async () => {
        try {
          const updated = await api(`/ads/${ad.id}`);
          if (updated.status !== "generating") {
            if (pollRef.current) clearInterval(pollRef.current);
            setRegenerating(false);
            setRegenDone(true);
            onRegenerated();
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          setRegenerating(false);
          setRegenErr("Lost track of regeneration — check My Ads to see the updated ad.");
        }
      }, 3000);
    } catch (e: any) {
      setRegenErr(e.message || "Regeneration failed.");
      setRegenerating(false);
    }
  }

  const hasImage = !!(prompts?.image_prompt);
  const hasVideo = !!(prompts?.video_prompt);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => !regenerating && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-border overflow-hidden"
        style={{
          background: "oklch(0.14 0.02 260 / 0.97)",
          backdropFilter: "blur(20px) saturate(1.5)",
          boxShadow: "0 0 0 1px oklch(1 0 0 / 0.08), 0 24px 64px oklch(0 0 0 / 0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <div>
            <div className="text-sm font-semibold text-foreground">🔍 Generation Prompts</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              The exact prompts sent to the AI — edit and regenerate as needed.
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={regenerating}
            className="text-lg leading-none text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="py-10 text-center text-sm text-muted-foreground animate-pulse">Loading prompts…</div>
          )}

          {loadErr && !loading && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loadErr}
            </div>
          )}

          {!loading && !loadErr && prompts && (
            <>
              {regenDone && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                  ✓ Regeneration complete — the ad has been updated.
                </div>
              )}

              {/* Text prompt */}
              {prompts.text_prompt !== null && (
                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    <span>✍️ Text / Copy Prompt</span>
                  </label>
                  <textarea
                    value={textPrompt}
                    onChange={(e) => setTextPrompt(e.target.value)}
                    disabled={regenerating}
                    rows={8}
                    className="w-full rounded-xl border border-input bg-input/30 px-3.5 py-3 text-xs text-foreground leading-relaxed focus:border-primary focus:outline-none resize-y disabled:opacity-50"
                    placeholder="Text/copy generation prompt…"
                  />
                </div>
              )}

              {/* Image prompt */}
              {hasImage && (
                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    <span>🖼 Image Prompt</span>
                  </label>
                  <textarea
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    disabled={regenerating}
                    rows={5}
                    className="w-full rounded-xl border border-input bg-input/30 px-3.5 py-3 text-xs text-foreground leading-relaxed focus:border-primary focus:outline-none resize-y disabled:opacity-50"
                    placeholder="Image generation prompt…"
                  />
                </div>
              )}

              {/* Video prompt */}
              {hasVideo && (
                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    <span>🎬 Video Prompt</span>
                  </label>
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    disabled={regenerating}
                    rows={5}
                    className="w-full rounded-xl border border-input bg-input/30 px-3.5 py-3 text-xs text-foreground leading-relaxed focus:border-primary focus:outline-none resize-y disabled:opacity-50"
                    placeholder="Video generation prompt…"
                  />
                </div>
              )}

              {regenErr && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                  {regenErr}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !loadErr && prompts && (
          <div className="shrink-0 border-t border-border px-5 py-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {regenerating ? "⏳ Regenerating ad — this may take a minute…" : "Edit any prompt above, then regenerate."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={regenerating}
                className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground hover:border-primary/40 disabled:opacity-40"
              >
                {regenDone ? "Close" : "Cancel"}
              </button>
              {!regenDone && (
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="rounded-full border px-4 py-2 text-xs font-medium disabled:opacity-50"
                  style={{
                    background: "oklch(0.85 0.18 52 / 0.15)",
                    borderColor: "oklch(0.85 0.18 52 / 0.5)",
                    color: "oklch(0.85 0.18 52)",
                  }}
                >
                  {regenerating ? "⏳ Regenerating…" : "✨ Regenerate with these prompts"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MyAds() {
  const allowed = useRequireCapability("view_my_ads");

  const [data, setData] = useState<AdListOut | null>(null);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState(""); // "" = all, "none" = not from a campaign, else campaign id
  const [statusFilter, setStatusFilter] = useState(""); // "" = all, "created" | "scheduled" | "posted"
  const [contentFilter, setContentFilter] = useState(""); // "" = all | "text" | "text_image" | "text_video"
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [retentionMonths, setRetentionMonths] = useState<number | null>(null);
  const [postRetentionMonths, setPostRetentionMonths] = useState<number | null>(null);
  const [repostAd, setRepostAd] = useState<AdOut | null>(null);
  const [postingStatusAd, setPostingStatusAd] = useState<AdOut | null>(null);
  const [confirmDeleteAd, setConfirmDeleteAd] = useState<AdOut | null>(null);
  const [promptAd, setPromptAd] = useState<AdOut | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadProducts() {
    try { setProducts(await api("/products")); } catch { /* non-fatal for this page */ }
  }
  async function loadCampaigns() {
    try {
      const res = await api("/campaigns?page=1&page_size=100");
      setCampaigns(res.items.map((c: any) => ({ id: c.id, name: c.name })));
    } catch { /* non-fatal for this page */ }
  }

  async function load() {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (productFilter) params.set("product_id", productFilter);
    if (campaignFilter === "none") params.set("no_campaign", "true");
    else if (campaignFilter) params.set("campaign_id", campaignFilter);
    if (statusFilter) params.set("status_filter", statusFilter);
    if (contentFilter) params.set("content_filter", contentFilter);
    try {
      setData(await api(`/ads?${params.toString()}`));
    } catch (e: any) {
      setErr(e.message || "Could not load ads");
    }
  }

  useEffect(() => { loadProducts(); loadCampaigns(); }, []);
  useEffect(() => {
    api("/ads/retention-info").then((r) => { setRetentionMonths(r.retention_months); setPostRetentionMonths(r.post_retention_months); }).catch(() => { /* non-fatal */ });
  }, []);
  useEffect(() => {
    load();
    // Auto-refresh so scheduled posts that fire in the background (the
    // Beat job checks every 60s) show up here without a manual reload.
    // Re-created whenever filters/page change so it always refetches
    // with the CURRENT filters, never a stale snapshot from when the
    // interval was first set up.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [page, dateFrom, dateTo, productFilter, campaignFilter, statusFilter, contentFilter]);

  async function deleteAd() {
    if (!confirmDeleteAd) return;
    setDeleting(true);
    try {
      await api(`/ads/${confirmDeleteAd.id}`, { method: "DELETE" });
      setConfirmDeleteAd(null);
      load();
    } catch (e: any) {
      setErr(e.message || "Could not delete ad");
    }
    setDeleting(false);
  }

  async function toggleFavorite(ad: AdOut) {
    setData((cur) => cur ? { ...cur, items: cur.items.map((a) => a.id === ad.id ? { ...a, favorite: !a.favorite } : a) } : cur);
    try { await api(`/ads/${ad.id}`, { method: "PATCH", body: { favorite: !ad.favorite } }); } catch { load(); }
  }

  async function cancelSchedule(ad: AdOut, scheduledId: string) {
    setData((cur) => cur ? {
      ...cur,
      items: cur.items.map((a) => a.id === ad.id ? { ...a, scheduled_posts: a.scheduled_posts.filter((s) => s.id !== scheduledId) } : a),
    } : cur);
    try { await api(`/schedule/${scheduledId}`, { method: "DELETE" }); } catch { load(); }
  }

  function productName(id: string | null) {
    if (!id) return null;
    return products.find((p) => p.id === id)?.name || null;
  }

  const filtered = data?.items.filter((a) => !search || briefTitle(a).toLowerCase().includes(search.toLowerCase()));
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  function clearFilters() {
    setDateFrom(""); setDateTo(""); setProductFilter(""); setCampaignFilter(""); setStatusFilter(""); setContentFilter(""); setSearch(""); setPage(1);
  }
  const hasFilters = dateFrom || dateTo || productFilter || campaignFilter || statusFilter || contentFilter || search;

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  return (
    <AppShell eyebrow="Library" title="My Ads">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-muted-foreground">All the ads you've generated.</p>
        <Input placeholder="🔍 Search by product…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      <RetentionWarning retentionMonths={retentionMonths} postRetentionMonths={postRetentionMonths} className="mb-4" />

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/40 p-4">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">From</div>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">To</div>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Product category</div>
          <select value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Campaign</div>
          <select value={campaignFilter} onChange={(e) => { setCampaignFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
            <option value="">All ads</option>
            <option value="none">Not from a campaign</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Status</div>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
            <option value="">Any status</option>
            <option value="created">Created (not scheduled/posted)</option>
            <option value="scheduled">Scheduled</option>
            <option value="posted">Posted</option>
          </select>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Content type</div>
          <select value={contentFilter} onChange={(e) => { setContentFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
            <option value="">All types</option>
            <option value="text">✍️ Text only</option>
            <option value="text_image">🖼 Text + Image</option>
            <option value="text_video">🎬 Text + Video</option>
          </select>
        </div>
        {hasFilters && <button onClick={clearFilters} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40">Clear filters</button>}
      </div>

      {err && <div className="mb-4 text-xs text-destructive">{err}</div>}

      {data === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered && filtered.length > 0 ? (
        <>
          <div className="space-y-2">
            {filtered.map((ad) => {
              const catName = productName(ad.product_id);
              return (
                <div key={ad.id} className="flex items-stretch rounded-xl border border-border bg-card/60 overflow-hidden">
                  {/* Thumbnail — flush left, full card height, same as Ad Generations panel */}
                  {(() => {
                    const v = ad.results?.variants?.[0] as any;
                    const imgUrl: string | null = v?.image_url ?? null;
                    const vidUrl: string | null = v?.video_url ?? null;
                    const thumb = imgUrl ?? vidUrl;
                    const t = contentTypeTag(ad);
                    return (
                      <div className="w-[64px] shrink-0 relative bg-muted/20 flex items-center justify-center">
                        {thumb ? (
                          vidUrl && !imgUrl ? (
                            <video src={vidUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
                          ) : (
                            <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          )
                        ) : (
                          <span className="text-2xl opacity-30">{t.icon}</span>
                        )}
                        {/* Status dot */}
                        <span className={`absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full border border-background/80 ${
                          ad.status === "posted" || ad.status === "partially_posted" ? "bg-emerald-400" :
                          ad.status === "failed" ? "bg-destructive" :
                          ad.status === "generating" ? "bg-primary animate-pulse" :
                          "bg-muted-foreground/30"
                        }`} />
                      </div>
                    );
                  })()}
                  {/* Content */}
                  <div className="flex flex-1 min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <button onClick={() => toggleFavorite(ad)} className={`text-lg ${ad.favorite ? "text-amber-400" : "text-muted-foreground/40"}`}>★</button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm text-foreground">{briefTitle(ad).slice(0, 70)}</span>
                        {catName && <span className="shrink-0 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-[10px] text-primary">{catName}</span>}
                        {ad.campaign_name && (
                          <span className="shrink-0 rounded-full border border-secondary/40 bg-secondary/5 px-2 py-0.5 text-[10px] text-secondary">
                            📣 {ad.campaign_name}{ad.campaign_phase && ` · ${PHASE_LABEL[ad.campaign_phase] || ad.campaign_phase}`}
                          </span>
                        )}
                        {ad.agent_source && (
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                            ad.agent_source === "rss"
                              ? "border-amber-500/40 bg-amber-500/5 text-amber-400"
                              : ad.agent_source === "streak"
                              ? "border-violet-500/40 bg-violet-500/5 text-violet-400"
                              : "border-primary/40 bg-primary/5 text-primary"
                          }`}>
                            {ad.agent_source === "rss"
                              ? "📰 RSS Feed"
                              : ad.agent_source === "streak"
                              ? "🚀 Brand Campaign"
                              : ad.agent_source === "event"
                              ? "🤖 Agent Niva · event"
                              : "🤖 Agent Niva"}
                          </span>
                        )}
                        {(() => { const t = contentTypeTag(ad); return (
                          <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {t.icon} {t.label}
                          </span>
                        ); })()}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {ad.platforms.join(" · ")} · created {new Date(ad.created_at).toLocaleDateString()}
                        {ad.posted_at && <> · <span className="text-primary">posted {formatInTimeZone(ad.posted_at, detectedTimeZone())}</span></>}
                      </div>
                      {ad.scheduled_posts.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {ad.scheduled_posts.map((sp) => {
                            const p = PLATFORMS.find((x) => x.id === sp.platform);
                            return (
                              <span key={sp.id} className="flex items-center gap-1.5 rounded-full border border-secondary/40 bg-secondary/5 px-2 py-0.5 text-[10px] text-secondary">
                                <span className="h-3.5 w-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-slate-950" style={{ background: p?.color }}>{p?.tag}</span>
                                🗓 {p?.name || sp.platform} · {formatInTimeZone(sp.scheduled_at, detectedTimeZone())}
                                <button onClick={() => cancelSchedule(ad, sp.id)} className="ml-0.5 text-secondary/70 hover:text-destructive" title="Cancel this platform's schedule">✕</button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`text-xs ${STATUS_COLOR[ad.status] || "text-muted-foreground"}`}>{ad.status.replace("_", " ")}</span>
                    {ad.results && (
                      <button onClick={() => setRepostAd(ad)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">
                        👁 Preview / Repost
                      </button>
                    )}
                    <button
                      onClick={() => setPromptAd(ad)}
                      title="View and edit the AI prompts used to generate this ad"
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-amber-500/40 hover:text-amber-400"
                    >
                      🔍 Preview Prompt
                    </button>
                    <button onClick={() => setPostingStatusAd(ad)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-secondary/40 hover:text-secondary">
                      📡 Posting Status
                    </button>
                    <button onClick={() => setConfirmDeleteAd(ad)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive">
                      🗑 Delete
                    </button>
                  </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {data.page} of {totalPages} · {data.total} ad{data.total !== 1 ? "s" : ""} total</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-border px-3 py-1.5 disabled:opacity-40">← Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-border px-3 py-1.5 disabled:opacity-40">Next →</button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState>{hasFilters ? "No ads match your filters." : "No ads yet — head to Create Ad to make your first one."}</EmptyState>
      )}

      {repostAd && (
        <RepostModal ad={repostAd} onClose={() => setRepostAd(null)} onUpdated={load} />
      )}

      {promptAd && (
        <PromptModal
          ad={promptAd}
          onClose={() => setPromptAd(null)}
          onRegenerated={() => { load(); }}
        />
      )}

      {postingStatusAd && (
        <PostingStatusModal ad={postingStatusAd} onClose={() => setPostingStatusAd(null)} />
      )}

      {confirmDeleteAd && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDeleteAd(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-sm rounded-2xl border border-border bg-card/95 p-6 backdrop-blur-xl">
            <div className="text-sm font-semibold text-foreground">Delete this ad?</div>
            <p className="mt-2 text-sm text-muted-foreground">
              "{briefTitle(confirmDeleteAd).slice(0, 60)}" will be permanently deleted, including its generated copy and image. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirmDeleteAd(null)} disabled={deleting} className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary/40 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={deleteAd} disabled={deleting} className="rounded-full border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive disabled:opacity-50">
                {deleting ? "Deleting…" : "🗑 Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
