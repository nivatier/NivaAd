import { useState } from "react";
import { api, type AdOut } from "@/lib/api";
import { PLATFORMS, PostPreviewCard } from "@/components/create-ad-parts";
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
  const variants: Record<string, any>[] = ad.results?.variants?.length ? ad.results.variants : [{}];
  const adPlatforms = PLATFORMS.filter((p) => ad.platforms.includes(p.id));

  const [activeVariantIdx, setActiveVariantIdx] = useState(0);
  const [activeTab, setActiveTab] = useState(ad.platforms[0]);
  const [editMode, setEditMode] = useState(false);
  // captions[variantIdx][platformId] — kept per-variant so switching
  // tabs never loses an unsaved edit on another variant.
  const [captions, setCaptions] = useState<Record<number, Record<string, string>>>(
    Object.fromEntries(variants.map((v, i) => [i, Object.fromEntries(ad.platforms.map((p) => [p, v[p]?.caption || ""]))]))
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(ad.platforms.map((p) => [p, !ad.posted_platforms.includes(p)]))
  );
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(todayPlus(1));
  const [scheduleTime, setScheduleTime] = useState("10:00");
  const [timeZone, setTimeZone] = useState(detectedTimeZone());
  const [schedulePlatforms, setSchedulePlatforms] = useState<Record<string, boolean>>(
    Object.fromEntries(ad.platforms.map((p) => [p, !ad.posted_platforms.includes(p)]))
  );
  const [scheduledMsg, setScheduledMsg] = useState("");
  const [err, setErr] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  function startReschedule(scheduledId: string, currentIso: string) {
    // Pre-fill with the CURRENT scheduled time (in the viewer's chosen
    // timezone) rather than blank fields, so "reschedule" reads as
    // "adjust this" rather than "start over".
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
    } catch (e: any) {
      setErr(e.message || "Could not reschedule");
    }
    setRescheduling(false);
  }

  async function cancelOne(scheduledId: string) {
    setErr("");
    try {
      await api(`/schedule/${scheduledId}`, { method: "DELETE" });
      onUpdated();
    } catch (e: any) {
      setErr(e.message || "Could not cancel");
    }
  }

  const activeVariant = variants[activeVariantIdx] || {};
  const imageUrl: string | undefined = activeVariant.image_url;
  const imageUrls: string[] | undefined = activeVariant.image_urls;
  const videoUrl: string | undefined = activeVariant.video_url;
  const activePlatform = adPlatforms.find((p) => p.id === activeTab) || adPlatforms[0];
  const activeAlreadyPosted = ad.posted_platforms.includes(activeTab);
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const schedulePlatformCount = Object.values(schedulePlatforms).filter(Boolean).length;

  // Builds the full variants array with this variant's edited captions
  // applied, AND (important) reorders so the variant being acted on
  // becomes index 0 — that's the "primary" variant everywhere else in
  // the app reads from (My Ads thumbnails, Schedule page, etc.), so
  // posting/scheduling from a non-first variant tab needs to promote it.
  function buildResultsForAction() {
    const updated = variants.map((v, i) => {
      const c = captions[i] || {};
      const nv = { ...v };
      for (const p of ad.platforms) if (c[p] !== undefined) nv[p] = { ...nv[p], caption: c[p] };
      return nv;
    });
    const reordered = [updated[activeVariantIdx], ...updated.filter((_, i) => i !== activeVariantIdx)];
    return { variants: reordered };
  }

  async function saveCaptions() {
    setSaving(true); setErr("");
    try {
      await api(`/ads/${ad.id}`, { method: "PATCH", body: { results: buildResultsForAction() } });
      setSavedMsg("✓ Saved");
      setTimeout(() => setSavedMsg(""), 2000);
      setEditMode(false);
      onUpdated();
    } catch (e: any) {
      setErr(e.message || "Could not save changes");
    }
    setSaving(false);
  }

  async function postSelected() {
    const platforms = ad.platforms.filter((p) => selected[p]);
    if (platforms.length === 0) return;
    setPosting(true); setErr("");
    try {
      await api(`/ads/${ad.id}`, { method: "PATCH", body: { results: buildResultsForAction() } });
      await api(`/ads/${ad.id}/post`, { method: "POST", body: { platforms } });
      onUpdated();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Could not post");
    }
    setPosting(false);
  }

  async function scheduleSelected() {
    const platforms = ad.platforms.filter((p) => schedulePlatforms[p]);
    if (platforms.length === 0) return;
    setScheduling(true); setErr("");
    try {
      await api(`/ads/${ad.id}`, { method: "PATCH", body: { results: buildResultsForAction() } });
      const naiveUtc = zonedWallTimeToUtcNaiveIso(scheduleDate, scheduleTime, timeZone);
      await api("/schedule", { method: "POST", body: { ad_id: ad.id, platforms, scheduled_at: naiveUtc } });
      setScheduledMsg(`🗓 Scheduled for ${new Date(scheduleDate + "T" + scheduleTime).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${timeZone}`);
      onUpdated();
    } catch (e: any) {
      setErr(e.message || "Could not schedule");
    }
    setScheduling(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card/95 backdrop-blur-xl">
        <div className="sticky top-0 flex items-start justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">Preview & repost</div>
            {ad.posted_at && <div className="text-[11px] text-primary">posted {formatInTimeZone(ad.posted_at, detectedTimeZone())}</div>}
            {ad.scheduled_posts.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {ad.scheduled_posts.map((sp) => {
                  const p = PLATFORMS.find((x) => x.id === sp.platform);
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
                      <button onClick={() => setReschedulingId(null)} className="text-[10px] text-muted-foreground">Cancel edit</button>
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

        {/* Variant tabs — only shown when there's more than one (i.e. "3 variations" was chosen) */}
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

        {/* Platform tabs — switch which platform's real preview is shown */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-background/40 px-4 py-2">
          {adPlatforms.map((p) => (
            <button
              key={p.id}
              onClick={() => { setActiveTab(p.id); setEditMode(false); }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${activeTab === p.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              <span className="h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
              {p.name}
              {ad.posted_platforms.includes(p.id) && <span className="text-emerald-400">✓</span>}
            </button>
          ))}
        </div>

        {/* THE ACTUAL PLATFORM-STYLED PREVIEW — this is the default view, not hidden behind another click. Shows a real carousel (prev/next + dots) when this ad has more than one image. */}
        <div className="p-4">
          {activePlatform && (
            <PostPreviewCard
              platform={activePlatform}
              result={{ ...activeVariant[activeTab], caption: captions[activeVariantIdx]?.[activeTab] }}
              imageUrl={imageUrl}
              imageUrls={imageUrls}
              videoUrl={videoUrl}
              companyName={me?.company_name || ""}
            />
          )}

          <div className="mt-3 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={!!selected[activeTab]} onChange={(e) => setSelected((s) => ({ ...s, [activeTab]: e.target.checked }))} />
              Include this platform
              {activeAlreadyPosted && <span className="text-emerald-400">(already posted once)</span>}
            </label>
            <button onClick={() => setEditMode((v) => !v)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">
              {editMode ? "Cancel edit" : "✏️ Edit caption"}
            </button>
          </div>

          {editMode && (
            <div className="mt-3">
              <textarea
                value={captions[activeVariantIdx]?.[activeTab] || ""}
                onChange={(e) => setCaptions((c) => ({ ...c, [activeVariantIdx]: { ...c[activeVariantIdx], [activeTab]: e.target.value } }))}
                rows={3}
                className="w-full rounded-lg border border-input bg-input/40 p-2.5 text-xs text-foreground resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">The preview above updates live as you type — this is exactly what will post.</p>
            </div>
          )}

          {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
        </div>

        <div className="sticky bottom-0 border-t border-border bg-card/95 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-5 py-4">
            <button onClick={saveCaptions} disabled={saving} className="rounded-full border border-primary/50 px-4 py-2 text-xs text-primary disabled:opacity-50">
              {saving ? "Saving…" : "💾 Save"}
            </button>
            {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
            <button
              onClick={postSelected}
              disabled={posting || selectedCount === 0}
              className="ml-auto rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
            >
              {posting ? "Posting…" : `🚀 Post now (${selectedCount})`}
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
              <div className="mb-2 text-xs font-semibold text-foreground">Which platforms should this schedule cover?</div>
              <div className="flex flex-wrap gap-1.5">
                {adPlatforms.map((p) => (
                  <button key={p.id} onClick={() => setSchedulePlatforms((s) => ({ ...s, [p.id]: !s[p.id] }))}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${schedulePlatforms[p.id] ? "border-secondary bg-secondary/10 text-secondary" : "border-border text-muted-foreground"}`}>
                    {schedulePlatforms[p.id] ? "☑" : "☐"} {p.name}
                  </button>
                ))}
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
                <button disabled={scheduling || schedulePlatformCount === 0} onClick={scheduleSelected}
                  className="mt-3 w-full rounded-full bg-secondary px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
                  {scheduling ? "Scheduling…" : `Confirm schedule for ${schedulePlatformCount} platform(s)`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
