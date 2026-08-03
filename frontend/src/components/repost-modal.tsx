import { useState, useEffect } from "react";
import { api, apiDownload, type AdOut } from "@/lib/api";
import { PostPreviewCard, type BrandKitPreview } from "@/components/create-ad-parts";
import { useConnectedPlatforms } from "@/hooks/use-connected-platforms";
import { TimezoneSelect } from "@/components/timezone-picker";
import { detectedTimeZone, formatInTimeZone, zonedWallTimeToUtcNaiveIso } from "@/lib/timezone";
import { useAuth } from "@/hooks/use-auth";

function todayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function RepostModal({ ad, onClose, onUpdated }: { ad: AdOut; onClose: () => void; onUpdated: () => void }) {
  const { me } = useAuth();
  const { platforms: allPlatforms, connected: connectedIds } = useConnectedPlatforms();
  const variants: Record<string, any>[] = ad.results?.variants?.length ? ad.results.variants : [{}];

  const DEFAULT_PLATFORM = { id: "default", name: "Default", tag: "📄", color: "#6366f1", ratio: "1:1" };
  const RESERVED_KEYS = new Set(["image_url", "image_urls", "video_url", "platform_image_urls", "platform_video_urls"]);
  const isDefaultAd = ad.platforms.length === 0 || ad.platforms[0] === "default";

  // Determine which platform keys actually have captions in the variant
  const initialCaptionPlatforms: string[] = (() => {
    const firstV = variants[0] || {};
    if (!isDefaultAd) return ad.platforms;
    const realKeys = Object.keys(firstV).filter((k) => !RESERVED_KEYS.has(k) && firstV[k]?.caption);
    return realKeys.length > 0 ? realKeys : ["default"];
  })();

  // ── All hooks must be declared before any derived values that use them ──
  // captionPlatforms drives the tab list — starts from what the LLM generated,
  // grows as the user adds new platforms via "+ Add Platform"
  const [activeCaptionPlatforms, setActiveCaptionPlatforms] = useState<string[]>(initialCaptionPlatforms);

  const [activeVariantIdx, setActiveVariantIdx] = useState(0);
  const [activeTab, setActiveTab] = useState(initialCaptionPlatforms[0]);
  const [editMode, setEditMode] = useState(false);
  const [captions, setCaptions] = useState<Record<number, Record<string, string>>>(
    Object.fromEntries(variants.map((v, i) => [i, Object.fromEntries(initialCaptionPlatforms.map((p) => [p, v[p]?.caption || ""]))]))
  );

  // Platforms selected for posting — only connected ones, none by default
  const [postSelected, setPostSelected] = useState<Set<string>>(new Set());
  const [scheduleSelected, setScheduleSelected] = useState<Set<string>>(new Set());

  // Per-platform reframe state
  const [reframing, setReframing] = useState<Record<string, boolean>>({});
  const [reframeErr, setReframeErr] = useState<Record<string, string>>({});
  const [localVariant, setLocalVariant] = useState<Record<string, any>>(variants[0] || {});

  // Add-platform state
  const [addingPlatform, setAddingPlatform] = useState<string | null>(null);
  const [addPlatformErr, setAddPlatformErr] = useState("");

  const [downloading, setDownloading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(todayPlus(1));
  const [scheduleTime, setScheduleTime] = useState("10:00");
  const [timeZone, setTimeZone] = useState(detectedTimeZone());
  const [scheduledMsg, setScheduledMsg] = useState("");
  const [err, setErr] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  // ── Derived values (use state variables, so must come after all hooks) ──
  // All platforms the user can browse for preview
  const previewPlatforms = activeCaptionPlatforms.map(
    (id) => allPlatforms.find((p) => p.id === id) ?? DEFAULT_PLATFORM
  );

  // Platforms not yet in the preview tabs — available to add
  const addablePlatforms = allPlatforms.filter((p) => !activeCaptionPlatforms.includes(p.id));
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [brandKit, setBrandKit] = useState<BrandKitPreview | null>(null);

  useEffect(() => {
    api("/brand-kit").then((kit: any) => {
      setBrandKit({ logo_url: kit.logo_url || null, logo_placement: kit.logo_placement || "bottom-right", primary_color: kit.primary_color || "#7c3aed" });
    }).catch(() => {});
  }, []);

  function startReschedule(scheduledId: string, currentIso: string) {
    const d = new Date(/[Zz]|[+-]\d\d:\d\d$/.test(currentIso) ? currentIso : `${currentIso}Z`);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value, m = parts.find((p) => p.type === "month")?.value, dd = parts.find((p) => p.type === "day")?.value;
    const timeParts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const hh = timeParts.find((p) => p.type === "hour")?.value, mm = timeParts.find((p) => p.type === "minute")?.value;
    setRescheduleDate(`${y}-${m}-${dd}`);
    setRescheduleTime(`${hh}:${mm}`);
    setReschedulingId(scheduledId);
  }

  async function saveReschedule(scheduledId: string) {
    setRescheduling(true); setErr("");
    try {
      const naiveUtc = zonedWallTimeToUtcNaiveIso(rescheduleDate, rescheduleTime, timeZone);
      await api(`/schedule/${scheduledId}`, { method: "PATCH", body: { scheduled_at: naiveUtc } });
      setReschedulingId(null);
      onUpdated();
    } catch (e: any) { setErr(e.message || "Could not reschedule"); }
    setRescheduling(false);
  }

  async function cancelOne(scheduledId: string) {
    setErr("");
    try {
      await api(`/schedule/${scheduledId}`, { method: "DELETE" });
      onUpdated();
    } catch (e: any) { setErr(e.message || "Could not cancel"); }
  }

  async function reframeForPlatform(platformId: string) {
    setReframing((r) => ({ ...r, [platformId]: true }));
    setReframeErr((r) => ({ ...r, [platformId]: "" }));
    try {
      const updated: any = await api(`/ads/${ad.id}/reframe/${platformId}`, { method: "POST" });
      const newVariant = updated.results?.variants?.[0] || {};
      setLocalVariant(newVariant);
    } catch (e: any) {
      setReframeErr((r) => ({ ...r, [platformId]: e.message || "Reframe failed" }));
    }
    setReframing((r) => ({ ...r, [platformId]: false }));
  }

  async function addPlatform(platformId: string) {
    setAddingPlatform(platformId);
    setAddPlatformErr("");
    try {
      const updated: any = await api(`/ads/${ad.id}/add-platform/${platformId}`, { method: "POST" });
      const newVariant = updated.results?.variants?.[0] || {};
      setLocalVariant(newVariant);
      // Add the new platform to the tab list and switch to it
      setActiveCaptionPlatforms((prev) => [...prev.filter((p) => p !== "default"), platformId]);
      setCaptions((c) => ({
        ...c,
        [activeVariantIdx]: {
          ...c[activeVariantIdx],
          [platformId]: newVariant[platformId]?.caption || "",
        },
      }));
      setActiveTab(platformId);
    } catch (e: any) {
      setAddPlatformErr(e.message || "Could not generate for this platform");
    }
    setAddingPlatform(null);
  }

  const activeVariant = { ...localVariant, ...(variants[activeVariantIdx] || {}) };
  const imageUrl: string | undefined = localVariant.image_url ?? variants[0]?.image_url;
  const imageUrls: string[] | undefined = localVariant.image_urls ?? variants[0]?.image_urls;
  const videoUrl: string | undefined = localVariant.video_url ?? variants[0]?.video_url;
  const activePlatform = previewPlatforms.find((p) => p.id === activeTab) || previewPlatforms[0];

  // For the active platform tab: use platform-specific reframed image if available, else master
  const activeImageUrl: string | undefined =
    activeTab === "default"
      ? imageUrl
      : (localVariant.platform_image_urls?.[activeTab] ?? variants[0]?.platform_image_urls?.[activeTab] ?? imageUrl);
  const activeVideoUrl: string | undefined =
    activeTab === "default"
      ? videoUrl
      : (localVariant.platform_video_urls?.[activeTab] ?? variants[0]?.platform_video_urls?.[activeTab] ?? videoUrl);

  const hasReframedMedia = activeTab !== "default" && !!(
    localVariant.platform_image_urls?.[activeTab] ??
    variants[0]?.platform_image_urls?.[activeTab] ??
    localVariant.platform_video_urls?.[activeTab] ??
    variants[0]?.platform_video_urls?.[activeTab]
  );
  const hasMasterMedia = !!(imageUrl || videoUrl);

  function buildResultsForAction() {
    const updated = variants.map((v, i) => {
      const c = captions[i] || {};
      const nv = { ...v, ...localVariant };
      for (const p of activeCaptionPlatforms) if (c[p] !== undefined) nv[p] = { ...nv[p], caption: c[p] };
      return nv;
    });
    const reordered = [updated[activeVariantIdx], ...updated.filter((_, i) => i !== activeVariantIdx)];
    return { variants: reordered };
  }

  async function downloadZip() {
    setDownloading(true); setErr("");
    try {
      await api(`/ads/${ad.id}`, { method: "PATCH", body: { results: buildResultsForAction() } });
      const blob = await apiDownload(`/ads/${ad.id}/export?variant=0`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ad-${ad.id.slice(0, 8)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setSavedMsg("✓ Saved"); setTimeout(() => setSavedMsg(""), 2000);
      setEditMode(false); onUpdated();
    } catch (e: any) { setErr(e.message || "Could not download"); }
    setDownloading(false);
  }

  async function postNow() {
    const platforms = [...postSelected].filter((p) => p !== "default");
    if (platforms.length === 0) return;
    setPosting(true); setErr("");
    try {
      await api(`/ads/${ad.id}`, { method: "PATCH", body: { results: buildResultsForAction() } });
      await api(`/ads/${ad.id}/post`, { method: "POST", body: { platforms } });
      onUpdated(); onClose();
    } catch (e: any) { setErr(e.message || "Could not post"); }
    setPosting(false);
  }

  async function scheduleNow() {
    const platforms = [...scheduleSelected].filter((p) => p !== "default");
    if (platforms.length === 0) return;
    setScheduling(true); setErr("");
    try {
      await api(`/ads/${ad.id}`, { method: "PATCH", body: { results: buildResultsForAction() } });
      const naiveUtc = zonedWallTimeToUtcNaiveIso(scheduleDate, scheduleTime, timeZone);
      await api("/schedule", { method: "POST", body: { ad_id: ad.id, platforms, scheduled_at: naiveUtc } });
      setScheduledMsg(`🗓 Scheduled for ${new Date(scheduleDate + "T" + scheduleTime).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${timeZone}`);
      onUpdated();
    } catch (e: any) { setErr(e.message || "Could not schedule"); }
    setScheduling(false);
  }

  // All platforms available for posting selection (connected ones from backend)
  const postablePlatforms = allPlatforms.filter((p) => connectedIds.has(p.id));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card/95 backdrop-blur-xl">

        {/* Header */}
        <div className="sticky top-0 flex items-start justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">Preview & post</div>
            {ad.posted_at && <div className="text-[11px] text-primary">posted {formatInTimeZone(ad.posted_at, detectedTimeZone())}</div>}
            {ad.scheduled_posts.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {ad.scheduled_posts.map((sp) => {
                  const p = allPlatforms.find((x) => x.id === sp.platform);
                  return reschedulingId === sp.id ? (
                    <div key={sp.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-secondary/40 bg-secondary/5 p-2">
                      <span className="text-[10px] text-secondary">{p?.name || sp.platform}:</span>
                      <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)}
                        className="rounded border border-input bg-input/40 px-1.5 py-0.5 text-[10px] text-foreground focus:border-primary focus:outline-none" />
                      <input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)}
                        className="rounded border border-input bg-input/40 px-1.5 py-0.5 text-[10px] text-foreground focus:border-primary focus:outline-none" />
                      <button disabled={rescheduling} onClick={() => saveReschedule(sp.id)} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-background disabled:opacity-50">
                        {rescheduling ? "…" : "Save"}
                      </button>
                      <button onClick={() => setReschedulingId(null)} className="text-[10px] text-muted-foreground">Cancel</button>
                    </div>
                  ) : (
                    <div key={sp.id} className="flex items-center gap-1.5 text-[11px] text-secondary">
                      <span className="h-3.5 w-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-slate-950 shrink-0" style={{ background: p?.color }}>{p?.tag}</span>
                      🗓 {p?.name || sp.platform} · {formatInTimeZone(sp.scheduled_at, detectedTimeZone())}
                      <button onClick={() => startReschedule(sp.id, sp.scheduled_at)} className="text-secondary/70 hover:text-secondary underline decoration-dotted">reschedule</button>
                      <button onClick={() => cancelOne(sp.id)} className="text-secondary/70 hover:text-destructive">✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground shrink-0">✕</button>
        </div>

        {/* Variant tabs */}
        {variants.length > 1 && (
          <div className="flex gap-1.5 border-b border-border bg-background/60 px-4 py-2">
            {variants.map((_, i) => (
              <button key={i} onClick={() => { setActiveVariantIdx(i); setEditMode(false); }}
                className={`rounded-full border px-3 py-1 text-xs ${activeVariantIdx === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                Variant {String.fromCharCode(65 + i)}
              </button>
            ))}
          </div>
        )}

        {/* Platform preview tabs + Add Platform */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-background/40 px-4 py-2">
          {previewPlatforms.map((p) => (
            <button key={p.id} onClick={() => { setActiveTab(p.id); setEditMode(false); }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${activeTab === p.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
              <span className="h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
              {p.name}
              {ad.posted_platforms.includes(p.id) && <span className="text-emerald-400">✓</span>}
            </button>
          ))}
          {/* Add Platform dropdown */}
          {addablePlatforms.length > 0 && (
            <div className="relative shrink-0 ml-auto">
              <select
                value=""
                disabled={!!addingPlatform}
                onChange={(e) => { if (e.target.value) addPlatform(e.target.value); }}
                className="rounded-full border border-dashed border-primary/50 bg-transparent px-3 py-1.5 text-xs text-primary hover:border-primary disabled:opacity-50 cursor-pointer focus:outline-none"
              >
                <option value="">{addingPlatform ? "Generating…" : "+ Add platform"}</option>
                {addablePlatforms.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {addPlatformErr && (
          <div className="px-4 py-2 text-[11px] text-destructive bg-destructive/5 border-b border-destructive/20">
            ✕ {addPlatformErr}
          </div>
        )}

        {/* Preview area */}
        <div className="p-4">
          {/* Caption actions — above the preview for visibility */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-[10px] text-muted-foreground">
              {activeTab === "default" ? "Default (original image)" : (
                hasReframedMedia
                  ? <span className="text-emerald-400">✓ Platform crop ready</span>
                  : <span className="text-amber-400">⚠ Showing original — no platform crop yet</span>
              )}
            </div>
            <button onClick={() => setEditMode((v) => !v)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">
              {editMode ? "Cancel edit" : "✏️ Edit caption"}
            </button>
          </div>

          {editMode && (
            <div className="mb-3">
              <textarea
                value={captions[activeVariantIdx]?.[activeTab] || ""}
                onChange={(e) => setCaptions((c) => ({ ...c, [activeVariantIdx]: { ...c[activeVariantIdx], [activeTab]: e.target.value } }))}
                rows={3}
                className="w-full rounded-lg border border-input bg-input/40 p-2.5 text-xs text-foreground resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Preview below updates live as you type.</p>
            </div>
          )}

          {/* Platform image section — reframe button for non-default platforms */}
          {activeTab !== "default" && hasMasterMedia && !hasReframedMedia && (
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5">
              <div className="text-[11px] font-semibold text-amber-400 mb-1">No platform-specific crop yet</div>
              <p className="text-[10px] text-muted-foreground mb-2">
                This will reframe the original image to {activePlatform?.ratio || "this platform's ratio"} using your Brand Kit padding settings.
              </p>
              {reframeErr[activeTab] && <div className="mb-2 text-[10px] text-destructive">{reframeErr[activeTab]}</div>}
              <button
                onClick={() => reframeForPlatform(activeTab)}
                disabled={reframing[activeTab]}
                className="rounded-full bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
              >
                {reframing[activeTab] ? "Generating…" : `🔄 Generate ${activePlatform?.name || activeTab} crop`}
              </button>
            </div>
          )}

          {/* The actual preview card */}
          {activePlatform && (
            <PostPreviewCard
              platform={activePlatform}
              result={{ ...activeVariant[activeTab], caption: captions[activeVariantIdx]?.[activeTab] }}
              imageUrl={activeImageUrl}
              imageUrls={imageUrls}
              videoUrl={activeVideoUrl}
              companyName={me?.company_name || ""}
              variant={activeVariant}
              brandKit={brandKit}
            />
          )}

          {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
        </div>

        {/* Post / Schedule footer */}
        <div className="sticky bottom-0 border-t border-border bg-card/95 backdrop-blur-xl">

          {/* Platform selection for posting */}
          {postablePlatforms.length > 0 && (
            <div className="px-5 pt-4 pb-2">
              <div className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Select platforms to post to</div>
              <div className="flex flex-wrap gap-1.5">
                {postablePlatforms.map((p) => {
                  const alreadyPosted = ad.posted_platforms.includes(p.id);
                  const sel = postSelected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPostSelected((prev) => {
                        const next = new Set(prev);
                        next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                        return next;
                      })}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                        sel
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      <span className="h-3.5 w-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
                      {p.name}
                      {alreadyPosted && <span className="text-emerald-400 text-[9px]">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {postablePlatforms.length === 0 && (
            <div className="px-5 pt-4 pb-2 text-[11px] text-muted-foreground italic">
              No connected platforms — connect one in Connections to post directly, or download to post manually.
            </div>
          )}

          <div className="flex items-center gap-3 px-5 py-3">
            <button onClick={downloadZip} disabled={downloading}
              className="rounded-full border border-primary/50 px-4 py-2 text-xs text-primary disabled:opacity-50">
              {downloading ? "Saving…" : "💾 Save"}
            </button>
            {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
            <button
              onClick={postNow}
              disabled={posting || postSelected.size === 0}
              className="ml-auto rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
            >
              {posting ? "Posting…" : `🚀 Post now${postSelected.size > 0 ? ` (${postSelected.size})` : ""}`}
            </button>
            <button
              onClick={() => setShowSchedule((v) => !v)}
              className="rounded-full border-2 border-secondary px-5 py-2 text-xs font-semibold text-secondary hover:bg-secondary/10"
            >
              🗓 Schedule
            </button>
          </div>

          {showSchedule && (
            <div className="border-t border-border bg-background/60 px-5 py-4">
              <div className="mb-2 text-xs font-semibold text-foreground">Which platforms to schedule?</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {postablePlatforms.map((p) => (
                  <button key={p.id} onClick={() => setScheduleSelected((prev) => {
                    const next = new Set(prev);
                    next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                    return next;
                  })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${scheduleSelected.has(p.id) ? "border-secondary bg-secondary/10 text-secondary" : "border-border text-muted-foreground"}`}>
                    {scheduleSelected.has(p.id) ? "☑" : "☐"} {p.name}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                  className="rounded-lg border border-input bg-input/40 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
                <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                  className="rounded-lg border border-input bg-input/40 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
                <TimezoneSelect value={timeZone} onChange={setTimeZone} />
              </div>
              {scheduledMsg ? (
                <div className="mt-3 text-xs text-secondary">{scheduledMsg}</div>
              ) : (
                <button disabled={scheduling || scheduleSelected.size === 0} onClick={scheduleNow}
                  className="mt-3 w-full rounded-full bg-secondary px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
                  {scheduling ? "Scheduling…" : `Confirm schedule for ${scheduleSelected.size} platform(s)`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
