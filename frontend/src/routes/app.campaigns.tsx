import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, Input, EmptyState } from "@/components/app-shell";
import { RequirementChecklist } from "@/components/requirement-checklist";
import { PLATFORMS } from "@/components/create-ad-parts";
import { useConnectedPlatforms } from "@/hooks/use-connected-platforms";
import { CampaignImageModal } from "@/components/campaign-image-modal";
import { RepostModal } from "@/components/repost-modal";

import { detectedTimeZone, zonedWallTimeToUtcParts, formatInTimeZone } from "@/lib/timezone";
import { MAX_VIDEO_SHOTS } from "@/lib/constants";
import { api, type AdOut, type AvailableModel } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/campaigns")({
  component: Campaigns,
  head: () => ({ meta: [{ title: "Campaigns — NivaSpark" }] }),
});

const PAGE_SIZE = 10;

type PhaseInfo = { caption: string; date?: string; time?: string; platforms?: string[]; ad_id?: string | null };
type Campaign = {
  id: string; name: string; brief: string;
  phases: { teaser: PhaseInfo; launch: PhaseInfo; followup: PhaseInfo } | null;
  phase_status: Record<string, string>;
  created_at: string;
};
type CampaignListOut = { items: Campaign[]; total: number; page: number; page_size: number };

const PHASE_LABELS: [keyof NonNullable<Campaign["phases"]>, string][] = [
  ["teaser", "Teaser"],
  ["launch", "Launch"],
  ["followup", "Follow-up"],
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  posted: { label: "📤 Posted", cls: "border-primary/40 bg-primary/10 text-primary" },
  partially_posted: { label: "◐ Partially posted", cls: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  scheduled: { label: "🗓 Scheduled", cls: "border-secondary/40 bg-secondary/10 text-secondary" },
  no_ad: { label: "— No ad", cls: "border-border text-muted-foreground" },
};

function defaultDate(daysFromNow: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

type PhaseFormState = {
  date: string; time: string; platforms: Record<string, boolean>;
  wantImage: boolean; productImage: string | null; sceneText: string; useBrandKit: boolean;
  imageModelId: string | null;
  wantVideo: boolean; videoModelId: string | null; videoResolution: string | null;
  videoFrameImage: string | null; videoShots: { prompt: string; duration: number }[];
  videoMode: "single_reference" | "first_last_frame"; videoEndFrameImage: string | null;
  refineVideoPrompt: boolean; refineVideoFrame: boolean;
};

function PhaseScheduleInput({ label, state, setState, availableImageModels, availableVideoModels, availablePlatforms }: {
  label: string; state: PhaseFormState; setState: (v: PhaseFormState) => void;
  availableImageModels: AvailableModel[] | null; availableVideoModels: AvailableModel[] | null;
  availablePlatforms: typeof PLATFORMS;
}) {
  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setState({ ...state, productImage: await fileToDataUrl(f) });
  }

  async function handleVideoFrameImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setState({ ...state, videoFrameImage: await fileToDataUrl(f) });
  }

  async function handleVideoEndFrameImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setState({ ...state, videoEndFrameImage: await fileToDataUrl(f) });
  }

  const selectedVideoModel = availableVideoModels?.find((m) => m.id === state.videoModelId) || null;
  const videoTotalDuration = state.videoShots.reduce((sum, s) => sum + (s.duration || 0), 0);

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs font-semibold text-secondary">{label}</div>
      <div className="mt-2 flex gap-2">
        <input type="date" value={state.date} onChange={(e) => setState({ ...state, date: e.target.value })}
          className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
        <input type="time" value={state.time} onChange={(e) => setState({ ...state, time: e.target.value })}
          className="w-24 rounded-lg border border-input bg-input/40 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {availablePlatforms.map((p) => (
          <button key={p.id} type="button" onClick={() => setState({ ...state, platforms: { ...state.platforms, [p.id]: !state.platforms[p.id] } })}
            className={`rounded-full border px-2 py-1 text-[10px] ${state.platforms[p.id] ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
            {state.platforms[p.id] ? "☑" : "☐"} {p.tag}
          </button>
        ))}
      </div>

      <label className={`mt-2 flex items-center gap-1.5 text-[11px] ${state.wantVideo ? "text-muted-foreground/50" : "text-foreground"}`}>
        <input type="checkbox" disabled={state.wantVideo} checked={state.wantImage} onChange={(e) => setState({ ...state, wantImage: e.target.checked })} />
        Include AI image for this phase{state.wantVideo && " (turn off video first)"}
      </label>

      {state.wantImage && (
        <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-card/40 p-2.5">
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">Image Model</div>
            <select
              value={state.imageModelId || ""}
              onChange={(e) => setState({ ...state, imageModelId: e.target.value })}
              className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none"
            >
              {!availableImageModels && <option value="">Loading options…</option>}
              {availableImageModels?.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.credits} credit{m.credits > 1 ? "s" : ""}</option>
              ))}
            </select>
          </div>
          {state.productImage ? (
            <div className="flex items-center gap-2">
              <img src={state.productImage} alt="product" className="h-10 w-10 rounded object-cover border border-border" />
              <button type="button" onClick={() => setState({ ...state, productImage: null })} className="text-[10px] text-destructive border border-destructive/40 rounded-full px-2 py-0.5">Remove</button>
            </div>
          ) : (
            <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
              ⬆ Upload your own photo
              <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </label>
          )}
          <textarea
            value={state.sceneText}
            onChange={(e) => setState({ ...state, sceneText: e.target.value })}
            rows={2}
            placeholder={state.productImage ? 'Placement, e.g. "on a wooden desk, morning light"' : 'Describe the scene, e.g. "minimalist studio, soft lighting" — optional'}
            className="w-full rounded-lg border border-input bg-input/40 p-2 text-[11px] text-foreground resize-none focus:border-primary focus:outline-none"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-foreground">
            <input type="checkbox" checked={state.useBrandKit} onChange={(e) => setState({ ...state, useBrandKit: e.target.checked })} />
            🎨 Include brand kit
          </label>
        </div>
      )}

      <label className={`mt-2 flex items-center gap-1.5 text-[11px] ${state.wantImage ? "text-muted-foreground/50" : "text-foreground"}`}>
        <input type="checkbox" disabled={state.wantImage} checked={state.wantVideo} onChange={(e) => setState({ ...state, wantVideo: e.target.checked })} />
        Include AI video for this phase{state.wantImage && " (turn off image first)"}
      </label>

      {state.wantVideo && (
        <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-card/40 p-2.5">
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">Video Model</div>
            <select
              value={state.videoModelId || ""}
              onChange={(e) => {
                const id = e.target.value;
                const m = availableVideoModels?.find((x) => x.id === id);
                setState({
                  ...state, videoModelId: id,
                  videoResolution: m?.resolutions?.[0] ?? null,
                  videoShots: state.videoShots.length === 1 ? [{ ...state.videoShots[0], duration: m?.min_duration ?? state.videoShots[0].duration }] : state.videoShots,
                });
              }}
              className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none"
            >
              {!availableVideoModels && <option value="">Loading options…</option>}
              {availableVideoModels?.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.credits} credit{m.credits > 1 ? "s" : ""} · {m.min_duration}-{m.max_duration}s</option>
              ))}
            </select>
            {selectedVideoModel?.resolutions && selectedVideoModel.resolutions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Resolution:</span>
                {selectedVideoModel.resolutions.map((r) => (
                  <button key={r} type="button" onClick={() => setState({ ...state, videoResolution: r })}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoResolution === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedVideoModel?.supports_last_frame && (
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setState({ ...state, videoMode: "single_reference" })}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoMode === "single_reference" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                Single image
              </button>
              <button type="button" onClick={() => setState({ ...state, videoMode: "first_last_frame" })}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoMode === "first_last_frame" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                Start + end frame
              </button>
            </div>
          )}

          {state.videoFrameImage ? (
            <div className="flex items-center gap-2">
              <img src={state.videoFrameImage} alt="video reference" className="h-10 w-10 rounded object-cover border border-border" />
              <span className="text-[10px] text-emerald-400">✓ starting frame</span>
              <button type="button" onClick={() => setState({ ...state, videoFrameImage: null })} className="text-[10px] text-destructive border border-destructive/40 rounded-full px-2 py-0.5">Remove</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
                ⬆ {state.videoMode === "first_last_frame" ? "Upload starting frame" : "Upload reference image"}
                <input type="file" accept="image/*" className="hidden" onChange={handleVideoFrameImage} />
              </label>
              {state.productImage && (
                <button type="button" onClick={() => setState({ ...state, videoFrameImage: state.productImage })} className="rounded-full border border-border px-3 py-1 text-[10px] text-foreground">Use product photo</button>
              )}
              {state.videoMode === "single_reference" && <span className="text-[10px] text-muted-foreground">No image = text-to-video</span>}
            </div>
          )}

          {state.videoMode === "single_reference" && state.videoFrameImage && (
            <label className="flex items-center gap-1.5 text-[10px] text-foreground">
              <input type="checkbox" checked={state.refineVideoFrame} onChange={(e) => setState({ ...state, refineVideoFrame: e.target.checked })} />
              🎨 Change background to match shot 1's scene (optional)
            </label>
          )}

          {state.videoMode === "first_last_frame" && (
            state.videoEndFrameImage ? (
              <div className="flex items-center gap-2 border-t border-border/60 pt-2">
                <img src={state.videoEndFrameImage} alt="video end frame" className="h-10 w-10 rounded object-cover border border-border" />
                <span className="text-[10px] text-emerald-400">✓ ending frame</span>
                <button type="button" onClick={() => setState({ ...state, videoEndFrameImage: null })} className="text-[10px] text-destructive border border-destructive/40 rounded-full px-2 py-0.5">Remove</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
                <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
                  ⬆ Upload ending frame
                  <input type="file" accept="image/*" className="hidden" onChange={handleVideoEndFrameImage} />
                </label>
                <span className="text-[10px] text-muted-foreground">Required for start + end frame mode</span>
              </div>
            )
          )}

          <label className="flex items-center gap-1.5 text-[10px] text-foreground">
            <input type="checkbox" checked={state.refineVideoPrompt} onChange={(e) => setState({ ...state, refineVideoPrompt: e.target.checked })} />
            ✨ Refine shot wording with AI (optional)
          </label>

          <div className="rounded-lg border border-border/60 bg-background/40 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground">Video shots</span>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={state.videoShots.length <= 1}
                  onClick={() => setState({ ...state, videoShots: state.videoShots.length > 1 ? state.videoShots.slice(0, -1) : state.videoShots })}
                  className="grid h-5 w-5 place-items-center rounded-full border border-border text-[11px] text-foreground disabled:opacity-40">−</button>
                <span className="w-4 text-center text-[11px] font-semibold text-foreground">{state.videoShots.length}</span>
                <button type="button" disabled={state.videoShots.length >= MAX_VIDEO_SHOTS}
                  onClick={() => setState({ ...state, videoShots: state.videoShots.length < MAX_VIDEO_SHOTS ? [...state.videoShots, { prompt: "", duration: 6 }] : state.videoShots })}
                  className="grid h-5 w-5 place-items-center rounded-full border border-border text-[11px] text-foreground disabled:opacity-40">＋</button>
              </div>
            </div>
            <div className="mt-1.5 space-y-1.5">
              {state.videoShots.map((shot, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    placeholder={state.videoShots.length > 1 ? `Shot ${i + 1} — style, angle, action` : "Describe this shot (optional)"}
                    value={shot.prompt}
                    onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, idx) => idx === i ? { ...x, prompt: e.target.value } : x) })}
                    className="w-full rounded-lg border border-input bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none"
                  />
                  <input
                    type="number"
                    value={shot.duration}
                    onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, idx) => idx === i ? { ...x, duration: Number(e.target.value) || 0 } : x) })}
                    className="w-12 shrink-0 rounded-lg border border-input bg-input/40 px-1.5 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none"
                  />
                  <span className="shrink-0 text-[10px] text-muted-foreground">sec</span>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Total: {videoTotalDuration}s
              {selectedVideoModel && (videoTotalDuration < selectedVideoModel.min_duration! || videoTotalDuration > selectedVideoModel.max_duration!) && (
                <span className="text-destructive"> — "{selectedVideoModel.label}" needs {selectedVideoModel.min_duration}-{selectedVideoModel.max_duration}s</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function newPhaseState(days: number): PhaseFormState {
  return {
    date: defaultDate(days), time: "10:00",
    platforms: { instagram: true, facebook: true },
    wantImage: false, productImage: null, sceneText: "", useBrandKit: false, imageModelId: null,
    wantVideo: false, videoModelId: null, videoResolution: null, videoFrameImage: null,
    videoShots: [{ prompt: "", duration: 6 }],
    videoMode: "single_reference", videoEndFrameImage: null, refineVideoPrompt: false,
    refineVideoFrame: false,
  };
}

function Campaigns() {
  const allowed = useRequireCapability("view_campaigns");

  const { refresh } = useAuth();
  const [data, setData] = useState<CampaignListOut | null>(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const timeZone = detectedTimeZone();
  const [teaser, setTeaser] = useState(newPhaseState(2));
  const [availableImageModels, setAvailableImageModels] = useState<AvailableModel[] | null>(null);
  const [availableVideoModels, setAvailableVideoModels] = useState<AvailableModel[] | null>(null);
  const connectedPlatformIds = useConnectedPlatforms();
  const availablePlatforms = connectedPlatformIds === null ? PLATFORMS : PLATFORMS.filter((p) => connectedPlatformIds.has(p.id));
  const [launch, setLaunch] = useState(newPhaseState(5));
  const [followup, setFollowup] = useState(newPhaseState(8));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [imageModal, setImageModal] = useState<{ campaignId: string; phaseKey: string; phaseLabel: string; ad: AdOut } | null>(null);
  const [previewAd, setPreviewAd] = useState<AdOut | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);  // phase ad_id currently loading, for a per-button spinner state

  async function load() {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    try {
      setData(await api(`/campaigns?${params.toString()}`));
    } catch (e: any) {
      setErr(e.message || "Could not load campaigns");
    }
  }
  useEffect(() => { load(); }, [page, dateFrom, dateTo]);

  useEffect(() => {
    api("/ads/available-models").then((models) => {
      setAvailableImageModels(models.image);
      setAvailableVideoModels(models.video);
      if (models.image.length > 0) {
        const firstId = models.image[0].id;
        setTeaser((s) => s.imageModelId ? s : { ...s, imageModelId: firstId });
        setLaunch((s) => s.imageModelId ? s : { ...s, imageModelId: firstId });
        setFollowup((s) => s.imageModelId ? s : { ...s, imageModelId: firstId });
      }
      if (models.video.length > 0) {
        const firstVideo = models.video[0];
        const seed = (s: PhaseFormState) => s.videoModelId ? s : {
          ...s, videoModelId: firstVideo.id, videoResolution: firstVideo.resolutions?.[0] ?? null,
          videoShots: [{ prompt: "", duration: firstVideo.min_duration ?? 6 }],
        };
        setTeaser(seed); setLaunch(seed); setFollowup(seed);
      }
    }).catch(() => { /* non-fatal — dropdowns just won't have options until this loads */ });
  }, []);

  function toPayload(s: PhaseFormState) {
    // Convert the wall-clock date/time you entered (in the selected
    // timezone) into true UTC before sending — the backend always stores
    // and fires schedules in UTC.
    const utc = zonedWallTimeToUtcParts(s.date, s.time, timeZone);
    return {
      date: utc.date, time: utc.time,
      platforms: availablePlatforms.filter((p) => s.platforms[p.id]).map((p) => p.id),
      generate_image: s.wantImage,
      env: s.productImage ? s.sceneText || null : null,
      image_scene: !s.productImage ? s.sceneText || null : null,
      product_image: s.productImage,
      use_brand_logo: s.useBrandKit,
      image_model_id: s.imageModelId,
      generate_video: s.wantVideo,
      video_model_id: s.videoModelId,
      video_shots: s.wantVideo ? s.videoShots : null,
      video_frame_image: s.wantVideo && s.videoFrameImage?.startsWith("data:") ? s.videoFrameImage : null,
      video_end_frame_image: s.wantVideo && s.videoMode === "first_last_frame" && s.videoEndFrameImage?.startsWith("data:") ? s.videoEndFrameImage : null,
      video_mode: s.wantVideo ? s.videoMode : "single_reference",
      video_resolution: s.videoResolution,
      refine_video_prompt: s.wantVideo ? s.refineVideoPrompt : false,
      refine_video_frame: s.wantVideo ? s.refineVideoFrame : false,
    };
  }

  async function generate() {
    if (!name.trim() || !brief.trim()) return;
    const teaserP = toPayload(teaser), launchP = toPayload(launch), followupP = toPayload(followup);
    setBusy(true); setErr("");
    try {
      await api("/campaigns", { method: "POST", body: { name, brief, teaser: teaserP, launch: launchP, followup: followupP } });
      setName(""); setBrief("");
      setTeaser(newPhaseState(2)); setLaunch(newPhaseState(5)); setFollowup(newPhaseState(8));
      setPage(1);
      load();
    } catch (e: any) {
      setErr(e.message || "Could not generate the campaign");
    }
    refresh(); // keep the sidebar credit count accurate — was missing here
    setBusy(false);
  }

  async function remove(id: string) {
    setData((cur) => cur ? { ...cur, items: cur.items.filter((c) => c.id !== id) } : cur);
    try { await api(`/campaigns/${id}`, { method: "DELETE" }); load(); } catch (e: any) { setErr(e.message || "Could not delete campaign"); load(); }
  }

  async function openImageModal(campaignId: string, phaseKey: string, phaseLabel: string, phase: PhaseInfo) {
    if (!phase.ad_id) return;
    const ad: AdOut = await api(`/ads/${phase.ad_id}`);
    setImageModal({ campaignId, phaseKey, phaseLabel, ad });
  }

  async function openPreview(adId: string) {
    setPreviewLoading(adId);
    try {
      const ad: AdOut = await api(`/ads/${adId}`);
      setPreviewAd(ad);
    } catch {
      // silent — the button just stops spinning; nothing destructive happened
    }
    setPreviewLoading(null);
  }

  function clearFilters() { setDateFrom(""); setDateTo(""); setPage(1); }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  return (
    <AppShell eyebrow="Create" title="Launch Campaigns">
      <Panel>
        <div className="mb-4">
          <h2 className="font-display text-base font-semibold text-foreground">Campaign details</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Name your launch and describe what it's for — this drives the copy for all three phases.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Input placeholder="Product / launch name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="One line: what is it & who's it for" value={brief} onChange={(e) => setBrief(e.target.value)} />
        </div>


        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <PhaseScheduleInput label="Teaser" state={teaser} setState={setTeaser} availableImageModels={availableImageModels} availableVideoModels={availableVideoModels} availablePlatforms={availablePlatforms} />
          <PhaseScheduleInput label="Launch" state={launch} setState={setLaunch} availableImageModels={availableImageModels} availableVideoModels={availableVideoModels} availablePlatforms={availablePlatforms} />
          <PhaseScheduleInput label="Follow-up" state={followup} setState={setFollowup} availableImageModels={availableImageModels} availableVideoModels={availableVideoModels} availablePlatforms={availablePlatforms} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">💡 Each phase's image is independent — e.g. skip the image for the Teaser, add your own photo for the Launch.</p>

        <RequirementChecklist items={[
          { label: "Campaign / product name", met: !!name.trim() },
          { label: "One-line brief", met: !!brief.trim() },
        ]} />
        {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
        <button
          disabled={!name.trim() || !brief.trim() || busy}
          onClick={generate}
          className="mt-4 rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Generate & schedule campaign (2 credits)"}
        </button>
      </Panel>

      <div className="mt-6 mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/40 p-4">
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
        {(dateFrom || dateTo) && <button onClick={clearFilters} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40">Clear filters</button>}
      </div>

      {data === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : data.items.length === 0 ? (
        <EmptyState>{dateFrom || dateTo ? "No campaigns in this date range." : "No campaigns yet."}</EmptyState>
      ) : (
        <>
          <div className="space-y-4">
            {data.items.map((c) => (
              <Panel key={c.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display text-lg font-semibold text-foreground">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.brief}</div>
                  </div>
                  <button onClick={() => remove(c.id)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive">Delete</button>
                </div>
                {c.phases && (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {PHASE_LABELS.map(([key, label]) => {
                      const phase = c.phases![key];
                      const status = c.phase_status?.[key] || "no_ad";
                      const badge = STATUS_BADGE[status];
                      return (
                        <div key={key} className="rounded-xl border border-border bg-background/40 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-secondary">{label}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
                          </div>
                          <p className="mt-2 text-xs text-foreground">{phase.caption}</p>
                          <div className="mt-2 text-[10px] text-muted-foreground">
                            {phase.date ? `📅 ${formatInTimeZone(`${phase.date}T${phase.time || "00:00"}:00`, timeZone)}` : "No schedule set (created before scheduling was added)"}
                            {phase.platforms && phase.platforms.length > 0 && ` · ${phase.platforms.join(", ")}`}
                          </div>
                          <div className="mt-3 flex items-center gap-3">
                            <button
                              onClick={() => phase.ad_id && openPreview(phase.ad_id)}
                              disabled={!phase.ad_id || previewLoading === phase.ad_id}
                              className="text-xs font-medium text-secondary disabled:opacity-40"
                            >
                              {previewLoading === phase.ad_id ? "Loading…" : "👁 Preview"}
                            </button>
                            <button
                              onClick={() => openImageModal(c.id, key, label, phase)}
                              disabled={!phase.ad_id}
                              className="text-xs font-medium text-primary disabled:opacity-40"
                            >
                              🖼 Add / regenerate image
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {data.page} of {totalPages} · {data.total} campaign{data.total !== 1 ? "s" : ""} total</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-border px-3 py-1.5 disabled:opacity-40">← Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-border px-3 py-1.5 disabled:opacity-40">Next →</button>
            </div>
          </div>
        </>
      )}

      {imageModal && (
        <CampaignImageModal
          campaignId={imageModal.campaignId}
          phaseKey={imageModal.phaseKey}
          phaseLabel={imageModal.phaseLabel}
          ad={imageModal.ad}
          onClose={() => setImageModal(null)}
          onUpdated={load}
        />
      )}
      {previewAd && (
        <RepostModal
          ad={previewAd}
          onClose={() => setPreviewAd(null)}
          onUpdated={() => { load(); openPreview(previewAd.id); }}
        />
      )}
    </AppShell>
  );
}
