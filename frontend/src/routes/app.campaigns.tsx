import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, Input, EmptyState } from "@/components/app-shell";
import { RequirementChecklist } from "@/components/requirement-checklist";
import { PLATFORMS, type Platform } from "@/components/create-ad-parts";
import { useConnectedPlatforms } from "@/hooks/use-connected-platforms";
import { CampaignImageModal } from "@/components/campaign-image-modal";
import { RepostModal } from "@/components/repost-modal";

import { detectedTimeZone, zonedWallTimeToUtcParts, formatInTimeZone } from "@/lib/timezone";
import { MAX_VIDEO_SHOTS } from "@/lib/constants";
import { api, type AdOut, type AvailableModel } from "@/lib/api";
import { ImageThemeGrid, mapImageTheme, type ImageTheme, type ImageThemeField } from "@/components/theme-gallery-grid";
import { NovaHint } from "@/components/nova-hint";
import { useAuth } from "@/hooks/use-auth";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/campaigns")({
  component: Campaigns,
  head: () => ({ meta: [{ title: "Campaigns — NivaSpark" }] }),
});

const PAGE_SIZE = 10;

const POSITION_OPTIONS = [
  "top_left","top_center","top_right",
  "middle_left","middle_center","middle_right",
  "bottom_left","bottom_center","bottom_right",
];

// Mirrors app.index.tsx — same three overlay fields, kept in sync
const STANDARD_TEXT_FIELDS: ImageThemeField[] = [
  { key: "headline", label: "Headline", placeholder: "e.g. MEGA SALE", defaultPosition: "top-left",
    styleHint: "large bold advertising headline typography" },
  { key: "badge", label: "Discount badge", placeholder: "e.g. UP TO 50% OFF", defaultPosition: "middle-right",
    styleHint: "styled like a real promotional discount sticker/badge" },
  { key: "body", label: "Body / about text", placeholder: "e.g. short brand or offer description", defaultPosition: "bottom-left",
    styleHint: "smaller clean sans-serif supporting text" },
];

function buildOverlayText(
  fields: ImageThemeField[],
  fieldValues: Record<string, string>,
  positions: Record<string, string>,
): string | null {
  const filled = fields.filter((f) => fieldValues[f.key]?.trim());
  if (filled.length === 0) return null;
  return filled.map((f) => `${f.label}: "${fieldValues[f.key].trim()}" (${positions[f.key] || f.defaultPosition}, ${f.styleHint})`).join(". ") + ".";
}

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

type TextOverlay = {
  text: string; startTime: number; endTime: number | null;
  position: string; fontStyle: string; fontSize: string; textColor: string; overlayStyle: string;
};
type VideoShot = {
  prompt: string; duration: number;
  voiceoverText?: string; showVoiceover?: boolean;
  textOverlays?: TextOverlay[]; showOverlays?: boolean;
};
type PhaseFormState = {
  date: string; time: string; platforms: Record<string, boolean>;
  wantImage: boolean; productImage: string | null; sceneText: string; useBrandKit: boolean;
  imageModelId: string | null; imagePromptOverride: string;
  imageAspectRatio: string | null;
  refMode: "text" | "image";
  selectedImageTheme: string | null;
  themeFieldValues: Record<string, string>;
  themePositions: Record<string, string>;
  selectedTextStyle: string | null;
  selectedTextCategory: string | null;
  imageTextOverlay: string | null;
  showThemeModal: boolean;
  wantVideo: boolean; videoModelId: string | null; videoResolution: string | null;
  videoAspectRatio: string | null;
  videoFrameImage: string | null; videoEndFrameImage: string | null;
  videoShots: VideoShot[];
  videoMode: "single_reference" | "first_last_frame";
  videoAudio: boolean; videoCameraStyleIds: string[]; videoNegativePrompt: string;
  videoBackgroundMusicId: string; videoReferencePrompt: string; showVideoReferencePrompt: boolean;
  videoStartShotId: string | null; videoEndShotId: string | null;
  refineVideoPrompt: boolean; refineVideoFrame: boolean;
};

function PhaseScheduleInput({ label, state, setState, availableImageModels, availableVideoModels, availablePlatforms, connectedPlatformIds, testMode, cameraStylePresets, musicPresets, brandVideoShots, imageThemes, textTheme }: {
  label: string; state: PhaseFormState; setState: (v: PhaseFormState) => void;
  availableImageModels: AvailableModel[] | null; availableVideoModels: AvailableModel[] | null;
  availablePlatforms: Platform[];
  connectedPlatformIds: Set<string>; testMode: boolean;
  cameraStylePresets: { id: string; label: string }[];
  musicPresets: { id: string; label: string }[];
  brandVideoShots: { id: string; kind: string; status: string; label: string; prompt: string; duration: number }[];
  imageThemes: ImageTheme[];
  textTheme: { styleTags: string[]; categoryTags: string[]; stylePrompts: Record<string, string>; categoryPrompts: Record<string, string> };
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
        {availablePlatforms.map((p) => {
          const isConnected = connectedPlatformIds.has(p.id);
          const isSelectable = testMode || isConnected;
          const isSelected = !!state.platforms[p.id];
          return (
            <button key={p.id} type="button"
              disabled={!isSelectable}
              onClick={() => isSelectable && setState({ ...state, platforms: { ...state.platforms, [p.id]: !state.platforms[p.id] } })}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all
                ${isSelected ? "border-primary bg-primary/10 text-primary" :
                  isSelectable ? "border-border text-muted-foreground hover:border-primary/40" :
                  "border-border/40 text-muted-foreground/30 opacity-40 cursor-not-allowed"}`}>
              <span className="h-3 w-3 rounded-full inline-flex items-center justify-center text-[7px] font-bold text-slate-950 shrink-0" style={{ background: isSelectable ? p.color : "#888" }}>{p.tag}</span>
              {p.name}
            </button>
          );
        })}
      </div>

      <label className={`mt-2 flex items-center gap-1.5 text-[11px] ${state.wantVideo ? "text-muted-foreground/50" : "text-foreground"}`}>
        <input type="checkbox" disabled={state.wantVideo} checked={state.wantImage} onChange={(e) => setState({ ...state, wantImage: e.target.checked })} />
        Include AI image for this phase{state.wantVideo && " (turn off video first)"}
      </label>

      {state.wantImage && (
        <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-card/40 p-2.5">
          {/* Model + aspect ratio */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">Image Model</div>
            <select
              value={state.imageModelId || ""}
              onChange={(e) => {
                const m = availableImageModels?.find((x) => x.id === e.target.value);
                setState({ ...state, imageModelId: e.target.value, imageAspectRatio: m?.aspect_ratios?.[0] ?? null });
              }}
              className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none"
            >
              {!availableImageModels && <option value="">Loading options…</option>}
              {availableImageModels?.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.credits} credit{m.credits > 1 ? "s" : ""}</option>
              ))}
            </select>
            {(() => {
              const m = availableImageModels?.find((x) => x.id === state.imageModelId);
              if (!m?.aspect_ratios?.length) return null;
              return (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Ratio:</span>
                  {m.aspect_ratios.map((r: string) => (
                    <button key={r} type="button" onClick={() => setState({ ...state, imageAspectRatio: r })}
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${state.imageAspectRatio === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{r}</button>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Reference photo */}
          {state.productImage ? (
            <div className="flex items-center gap-2">
              <img src={state.productImage} alt="product" className="h-10 w-10 rounded object-cover border border-border" />
              <span className="text-[10px] text-emerald-400 flex-1">✓ Reference photo</span>
              <button type="button" onClick={() => setState({ ...state, productImage: null })} className="text-[10px] text-destructive border border-destructive/40 rounded-full px-2 py-0.5">Remove</button>
            </div>
          ) : (
            <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
              ⬆ Upload reference photo
              <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </label>
          )}

          {/* Theme reference mode */}
          <div className="rounded-lg border border-border/60 bg-background/40 p-2">
            <div className="text-[10px] font-semibold text-foreground mb-1.5">
              {state.productImage ? "Placement & surroundings" : "Image description"} <NovaHint hintKey="field:image-describe" />
            </div>
            <div className="flex gap-1 mb-2">
              {(["text", "image"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setState({ ...state, refMode: m, selectedImageTheme: null, selectedTextStyle: null, selectedTextCategory: null, imageTextOverlay: null })}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${state.refMode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                  {m === "text" ? "✏️ Text Theme" : "🖼 Image Theme"}
                </button>
              ))}
            </div>

            {state.refMode === "text" ? (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Style</label>
                    <select value={state.selectedTextStyle ?? ""} onChange={(e) => {
                      const s = { ...state, selectedTextStyle: e.target.value || null };
                      const styleP = s.selectedTextStyle ? textTheme.stylePrompts[s.selectedTextStyle] || "" : "";
                      const catP = s.selectedTextCategory ? textTheme.categoryPrompts[s.selectedTextCategory] || "" : "";
                      const combined = [styleP, catP].filter(Boolean).join(" ");
                      s.sceneText = combined || state.sceneText;
                      setState(s);
                    }} className="w-full rounded border border-input bg-input/40 px-1.5 py-1 text-[10px] text-foreground focus:border-primary focus:outline-none">
                      <option value="">None</option>
                      {textTheme.styleTags.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Category</label>
                    <select value={state.selectedTextCategory ?? ""} onChange={(e) => {
                      const s = { ...state, selectedTextCategory: e.target.value || null };
                      const styleP = s.selectedTextStyle ? textTheme.stylePrompts[s.selectedTextStyle] || "" : "";
                      const catP = s.selectedTextCategory ? textTheme.categoryPrompts[s.selectedTextCategory] || "" : "";
                      const combined = [styleP, catP].filter(Boolean).join(" ");
                      s.sceneText = combined || state.sceneText;
                      setState(s);
                    }} className="w-full rounded border border-input bg-input/40 px-1.5 py-1 text-[10px] text-foreground focus:border-primary focus:outline-none">
                      <option value="">None</option>
                      {textTheme.categoryTags.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {/* Text overlay fields */}
                <div className="space-y-1">
                  {STANDARD_TEXT_FIELDS.map((f) => (
                    <div key={f.key} className="flex gap-1.5 items-end">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">{f.label}</label>
                        <input value={state.themeFieldValues[f.key] ?? ""} onChange={(e) => {
                          const fv = { ...state.themeFieldValues, [f.key]: e.target.value };
                          setState({ ...state, themeFieldValues: fv, imageTextOverlay: buildOverlayText(STANDARD_TEXT_FIELDS, fv, state.themePositions) });
                        }} placeholder={f.placeholder}
                          className="w-full rounded border border-input bg-input/40 px-1.5 py-1 text-[10px] text-foreground focus:border-primary focus:outline-none" />
                      </div>
                      <div className="w-28">
                        <label className="text-[10px] text-muted-foreground">Position</label>
                        <select value={state.themePositions[f.key] ?? f.defaultPosition} onChange={(e) => {
                          const tp = { ...state.themePositions, [f.key]: e.target.value };
                          setState({ ...state, themePositions: tp, imageTextOverlay: buildOverlayText(STANDARD_TEXT_FIELDS, state.themeFieldValues, tp) });
                        }} className="w-full rounded border border-input bg-input/40 px-1 py-1 text-[10px] text-foreground focus:border-primary focus:outline-none">
                          {POSITION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                {state.selectedImageTheme ? (() => {
                  const theme = imageThemes.find((t) => t.id === state.selectedImageTheme)!;
                  return (
                    <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-1.5 mb-1.5">
                      <img src={theme.thumbnail} alt={theme.label} className="h-8 w-8 rounded object-cover shrink-0" />
                      <div className="min-w-0 flex-1 text-[10px] font-semibold text-foreground truncate">{theme.label}</div>
                      <button type="button" onClick={() => setState({ ...state, showThemeModal: true })}
                        className="shrink-0 rounded-full border border-primary/50 px-2 py-0.5 text-[10px] text-primary">Change</button>
                    </div>
                  );
                })() : (
                  <button type="button" onClick={() => setState({ ...state, showThemeModal: true })}
                    className="w-full mb-1.5 rounded border border-dashed border-primary/50 px-2 py-2 text-[10px] text-primary hover:bg-primary/5 flex items-center justify-center gap-1">
                    🖼 Browse image themes
                  </button>
                )}
                {state.selectedImageTheme && (() => {
                  const theme = imageThemes.find((t) => t.id === state.selectedImageTheme)!;
                  return theme.textFields.length > 0 ? (
                    <div className="space-y-1">
                      {theme.textFields.map((f) => (
                        <div key={f.key} className="flex gap-1.5 items-end">
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground">{f.label}</label>
                            <input value={state.themeFieldValues[f.key] ?? ""} onChange={(e) => {
                              const fv = { ...state.themeFieldValues, [f.key]: e.target.value };
                              setState({ ...state, themeFieldValues: fv, imageTextOverlay: buildOverlayText(theme.textFields, fv, state.themePositions) });
                            }} placeholder={f.placeholder}
                              className="w-full rounded border border-input bg-input/40 px-1.5 py-1 text-[10px] text-foreground focus:border-primary focus:outline-none" />
                          </div>
                          <div className="w-28">
                            <label className="text-[10px] text-muted-foreground">Position</label>
                            <select value={state.themePositions[f.key] ?? f.defaultPosition} onChange={(e) => {
                              const tp = { ...state.themePositions, [f.key]: e.target.value };
                              setState({ ...state, themePositions: tp, imageTextOverlay: buildOverlayText(theme.textFields, state.themeFieldValues, tp) });
                            }} className="w-full rounded border border-input bg-input/40 px-1 py-1 text-[10px] text-foreground focus:border-primary focus:outline-none">
                              {POSITION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-[10px] text-muted-foreground">No text overlay for this theme.</div>;
                })()}
              </div>
            )}

            <textarea value={state.sceneText} onChange={(e) => setState({ ...state, sceneText: e.target.value })} rows={2}
              placeholder={state.productImage ? "e.g. place on a wooden desk, morning light" : "e.g. minimalist studio, soft lighting — optional"}
              className="mt-1.5 w-full rounded-lg border border-input bg-input/40 p-2 text-[11px] text-foreground resize-none focus:border-primary focus:outline-none" />
            {state.imageTextOverlay && (
              <div className="mt-1 text-[10px] text-muted-foreground bg-background/60 border border-border/60 rounded p-1.5">
                <span className="font-semibold text-foreground">Text overlay: </span>{state.imageTextOverlay}
              </div>
            )}
          </div>

          <label className="flex items-center gap-1.5 text-[11px] text-foreground">
            <input type="checkbox" checked={state.useBrandKit} onChange={(e) => setState({ ...state, useBrandKit: e.target.checked })} />
            🎨 Include brand kit
          </label>
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">Image prompt override <span className="font-normal">(optional)</span></div>
            <input value={state.imagePromptOverride} onChange={(e) => setState({ ...state, imagePromptOverride: e.target.value })}
              placeholder="Override the AI's image prompt entirely…"
              className="w-full rounded-lg border border-input bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none" />
          </div>
        </div>
      )}
      {/* Image theme picker modal */}
      {state.showThemeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setState({ ...state, showThemeModal: false })}>
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-foreground">Choose an image theme</div>
              <button type="button" onClick={() => setState({ ...state, showThemeModal: false })} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
            </div>
            <ImageThemeGrid themes={imageThemes} selectedId={state.selectedImageTheme}
              onSelect={(t) => {
                const scene = t.basePrompt;
                setState({ ...state, selectedImageTheme: t.id, themeFieldValues: {}, themePositions: {}, imageTextOverlay: null, sceneText: scene, showThemeModal: false });
              }} />
          </div>
        </div>
      )}

      <label className={`mt-2 flex items-center gap-1.5 text-[11px] ${state.wantImage ? "text-muted-foreground/50" : "text-foreground"}`}>
        <input type="checkbox" disabled={state.wantImage} checked={state.wantVideo} onChange={(e) => setState({ ...state, wantVideo: e.target.checked })} />
        Include AI video for this phase{state.wantImage && " (turn off image first)"}
      </label>

      {state.wantVideo && (
        <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-card/40 p-2.5">
          {/* Model + resolution + audio + duration options */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">Video Model</div>
            <select value={state.videoModelId || ""}
              onChange={(e) => {
                const id = e.target.value;
                const m = availableVideoModels?.find((x) => x.id === id);
                setState({ ...state, videoModelId: id, videoResolution: m?.resolutions?.[0] ?? null,
                  videoShots: state.videoShots.length === 1 ? [{ ...state.videoShots[0], duration: m?.min_duration ?? state.videoShots[0].duration }] : state.videoShots });
              }}
              className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
              {!availableVideoModels && <option value="">Loading…</option>}
              {availableVideoModels?.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.credits}cr · {m.duration_options ? m.duration_options.map((d: number) => `${d}s`).join("/") : `${m.min_duration}-${m.max_duration}s`}</option>
              ))}
            </select>
            {selectedVideoModel?.resolutions && selectedVideoModel.resolutions.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Res:</span>
                {selectedVideoModel.resolutions.map((r: string) => (
                  <button key={r} type="button" onClick={() => setState({ ...state, videoResolution: r })}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoResolution === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{r}</button>
                ))}
              </div>
            )}
            {selectedVideoModel?.aspect_ratios && selectedVideoModel.aspect_ratios.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Ratio:</span>
                {(selectedVideoModel.aspect_ratios as string[]).map((r) => (
                  <button key={r} type="button" onClick={() => setState({ ...state, videoAspectRatio: r })}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoAspectRatio === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{r}</button>
                ))}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {selectedVideoModel?.supports_audio && (
                <label className="flex items-center gap-1 text-[10px] text-foreground">
                  <input type="checkbox" checked={state.videoAudio} onChange={(e) => setState({ ...state, videoAudio: e.target.checked })} />
                  🔊 Audio {state.videoAudio ? "on" : "off"}
                </label>
              )}
              {selectedVideoModel?.duration_options && state.videoShots.length === 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Length:</span>
                  {(selectedVideoModel.duration_options as number[]).map((d) => (
                    <button key={d} onClick={() => setState({ ...state, videoShots: [{ ...state.videoShots[0], duration: d }] })}
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoShots[0].duration === d ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{d}s</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Reference image */}
          <div className="rounded-lg border border-border/60 bg-background/40 p-2">
            <div className="text-[10px] font-semibold text-foreground mb-1.5">Reference image (optional)</div>
            {selectedVideoModel?.supports_last_frame && (
              <div className="flex gap-1.5 mb-1.5">
                <button type="button" onClick={() => setState({ ...state, videoMode: "single_reference" })}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoMode === "single_reference" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>Single</button>
                <button type="button" onClick={() => setState({ ...state, videoMode: "first_last_frame" })}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${state.videoMode === "first_last_frame" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>Start + end</button>
              </div>
            )}
            {state.videoFrameImage ? (
              <div className="flex items-center gap-2">
                <img src={state.videoFrameImage} alt="ref" className="h-10 w-10 rounded object-cover border border-border shrink-0" />
                <span className="text-[10px] text-emerald-400 flex-1">✓ {state.videoMode === "first_last_frame" ? "Starting frame" : "Reference set"}</span>
                <button type="button" onClick={() => setState({ ...state, videoFrameImage: null, videoReferencePrompt: "", showVideoReferencePrompt: false })}
                  className="text-[10px] text-destructive border border-destructive/40 rounded-full px-2 py-0.5">Remove</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
                  ⬆ {state.videoMode === "first_last_frame" ? "Start frame" : "Upload image"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleVideoFrameImage} />
                </label>
                {state.productImage && (
                  <button type="button" onClick={() => setState({ ...state, videoFrameImage: state.productImage })}
                    className="rounded-full border border-border px-2 py-1 text-[10px] text-foreground">Use product photo</button>
                )}
                {state.videoMode === "single_reference" && <span className="text-[10px] text-muted-foreground">No image = text-to-video</span>}
              </div>
            )}
            {state.videoMode === "single_reference" && state.videoFrameImage && (
              <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-foreground">
                <input type="checkbox" checked={state.refineVideoFrame} onChange={(e) => setState({ ...state, refineVideoFrame: e.target.checked })} />
                🎨 Match background to shot 1 scene
              </label>
            )}
            {state.videoMode === "first_last_frame" && (
              state.videoEndFrameImage ? (
                <div className="mt-1.5 flex items-center gap-2 border-t border-border/60 pt-1.5">
                  <img src={state.videoEndFrameImage} alt="end" className="h-10 w-10 rounded object-cover border border-border shrink-0" />
                  <span className="text-[10px] text-emerald-400 flex-1">✓ Ending frame</span>
                  <button type="button" onClick={() => setState({ ...state, videoEndFrameImage: null })}
                    className="text-[10px] text-destructive border border-destructive/40 rounded-full px-2 py-0.5">Remove</button>
                </div>
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-1.5">
                  <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-3 py-1 text-[10px] font-semibold text-background">
                    ⬆ End frame
                    <input type="file" accept="image/*" className="hidden" onChange={handleVideoEndFrameImage} />
                  </label>
                  <span className="text-[10px] text-muted-foreground">Required for start + end mode</span>
                </div>
              )
            )}
            {state.videoFrameImage && (
              <div className="mt-1.5 border-t border-border/60 pt-1.5">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-semibold text-foreground">🔗 Reference preservation</span>
                  <button type="button" onClick={() => setState({ ...state, showVideoReferencePrompt: !state.showVideoReferencePrompt })}
                    className="text-[10px] text-primary hover:underline">{state.showVideoReferencePrompt ? "Hide" : "Edit"}</button>
                </div>
                {!state.showVideoReferencePrompt && state.videoReferencePrompt.trim() && (
                  <p className="text-[11px] text-muted-foreground line-clamp-1 italic">{state.videoReferencePrompt}</p>
                )}
                {state.showVideoReferencePrompt && (
                  <textarea rows={2} value={state.videoReferencePrompt}
                    onChange={(e) => setState({ ...state, videoReferencePrompt: e.target.value })}
                    placeholder="Describe how to preserve the reference image style…"
                    className="w-full rounded-lg border border-input bg-input/40 p-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none resize-y" />
                )}
              </div>
            )}
          </div>

          {/* Brand intro / outro */}
          {(() => {
            const readyIntros = brandVideoShots.filter((s) => s.kind === "intro" && s.status === "ready");
            const readyOutros = brandVideoShots.filter((s) => s.kind === "outro" && s.status === "ready");
            if (readyIntros.length === 0 && readyOutros.length === 0) return null;
            const shotName = (s: typeof readyIntros[number]) => s.label || (s.prompt.length > 30 ? s.prompt.slice(0, 30) + "…" : s.prompt);
            return (
              <div className="rounded-lg border border-border/60 bg-background/40 p-2">
                <div className="text-[10px] font-semibold text-foreground mb-1.5">Brand intro / outro</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">Start shot</div>
                    <select value={state.videoStartShotId || ""} onChange={(e) => setState({ ...state, videoStartShotId: e.target.value || null })}
                      className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                      <option value="">None</option>
                      {readyIntros.map((s) => <option key={s.id} value={s.id}>{shotName(s)} ({s.duration}s)</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">End shot</div>
                    <select value={state.videoEndShotId || ""} onChange={(e) => setState({ ...state, videoEndShotId: e.target.value || null })}
                      className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                      <option value="">None</option>
                      {readyOutros.map((s) => <option key={s.id} value={s.id}>{shotName(s)} ({s.duration}s)</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Camera style */}
          {cameraStylePresets.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">🎥 Camera style <span className="font-normal">(optional)</span></div>
              <div className="flex flex-wrap gap-1">
                {cameraStylePresets.map((p) => {
                  const active = state.videoCameraStyleIds.includes(p.id);
                  return (
                    <button key={p.id} type="button"
                      onClick={() => setState({ ...state, videoCameraStyleIds: active ? state.videoCameraStyleIds.filter((x) => x !== p.id) : [...state.videoCameraStyleIds, p.id] })}
                      className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                      {active ? "✓ " : ""}{p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Background music */}
          {musicPresets.length > 1 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">🎵 Background music</div>
              <select value={state.videoBackgroundMusicId} onChange={(e) => setState({ ...state, videoBackgroundMusicId: e.target.value })}
                className="w-full rounded-lg border border-input bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-primary focus:outline-none">
                {musicPresets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          )}

          {/* Negative prompt */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">🚫 Negative prompt <span className="font-normal">(optional)</span></div>
            <input value={state.videoNegativePrompt} onChange={(e) => setState({ ...state, videoNegativePrompt: e.target.value })}
              placeholder="e.g. no warped geometry, no flickering, no artifacts"
              className="w-full rounded-lg border border-input bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none" />
          </div>

          {/* Shots */}
          <div className="rounded-lg border border-border/60 bg-background/40 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground">Shots</span>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={state.videoShots.length <= 1}
                  onClick={() => setState({ ...state, videoShots: state.videoShots.slice(0, -1) })}
                  className="grid h-5 w-5 place-items-center rounded-full border border-border text-[11px] disabled:opacity-40">−</button>
                <span className="w-4 text-center text-[11px] font-semibold text-foreground">{state.videoShots.length}</span>
                <button type="button" disabled={state.videoShots.length >= MAX_VIDEO_SHOTS}
                  onClick={() => setState({ ...state, videoShots: [...state.videoShots, { prompt: "", duration: 6 }] })}
                  className="grid h-5 w-5 place-items-center rounded-full border border-border text-[11px] disabled:opacity-40">＋</button>
              </div>
            </div>
            <div className="space-y-2">
              {state.videoShots.map((shot, i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-card/40 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-[10px] text-muted-foreground">#{i + 1}</span>
                    <input placeholder={state.videoShots.length > 1 ? `Shot ${i + 1} — angle, action` : "Describe this shot (optional)"}
                      value={shot.prompt}
                      onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, idx) => idx === i ? { ...x, prompt: e.target.value } : x) })}
                      className="w-full rounded-lg border border-input bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none" />
                    <input type="number" value={shot.duration}
                      disabled={!!(selectedVideoModel?.duration_options && state.videoShots.length === 1)}
                      onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, idx) => idx === i ? { ...x, duration: Number(e.target.value) || 0 } : x) })}
                      className="w-12 shrink-0 rounded-lg border border-input bg-input/40 px-1.5 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none disabled:opacity-50" />
                    <span className="shrink-0 text-[10px] text-muted-foreground">s</span>
                  </div>
                  {/* Per-shot extras */}
                  <div className="flex flex-wrap gap-1.5 pl-5">
                    {!shot.showOverlays ? (
                      <button type="button" onClick={() => setState({ ...state, videoShots: state.videoShots.map((x, idx) => idx === i ? { ...x, showOverlays: true, textOverlays: x.textOverlays || [] } : x) })}
                        className="flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary">
                        <span>＋</span> Text overlay</button>
                    ) : <span className="text-[10px] font-medium text-primary">💬 Overlays</span>}
                    {!shot.showVoiceover ? (
                      <button type="button" onClick={() => setState({ ...state, videoShots: state.videoShots.map((x, idx) => idx === i ? { ...x, showVoiceover: true } : x) })}
                        className="flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-secondary/50 hover:text-secondary">
                        <span>＋</span> Voice-over</button>
                    ) : <span className="text-[10px] font-medium text-secondary">🎙 Voice-over</span>}
                  </div>
                  {/* Text overlays */}
                  {shot.showOverlays && (
                    <div className="pl-5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">Text overlays</span>
                        <button type="button" onClick={() => setState({ ...state, videoShots: state.videoShots.map((x, idx) => idx === i ? { ...x, textOverlays: [...(x.textOverlays || []), { text: "", startTime: 0, endTime: null, position: "bottom-center", fontStyle: "sans", fontSize: "medium", textColor: "#FFFFFF", overlayStyle: "fade" }] } : x) })}
                          className="rounded-full border border-primary/50 px-1.5 py-0.5 text-[10px] text-primary">＋ Add</button>
                      </div>
                      {(shot.textOverlays || []).map((ov, oi) => (
                        <div key={oi} className="rounded-lg border border-border/60 bg-background/50 p-1.5 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <input placeholder={`"The wait is almost over."`} value={ov.text}
                              onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, text: e.target.value } : o) } : x) })}
                              className="flex-1 rounded-lg border border-input bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none" />
                            <button type="button" onClick={() => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).filter((_, oi2) => oi2 !== oi) } : x) })}
                              className="shrink-0 rounded-full border border-destructive/40 px-1.5 py-0.5 text-[10px] text-destructive">✕</button>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            <div><label className="text-[9px] text-muted-foreground">Start s</label>
                              <input type="number" min="0" step="0.5" value={ov.startTime}
                                onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, startTime: Number(e.target.value) || 0 } : o) } : x) })}
                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground" /></div>
                            <div><label className="text-[9px] text-muted-foreground">End s</label>
                              <input type="number" min="0" step="0.5" value={ov.endTime ?? ""} placeholder="end"
                                onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, endTime: e.target.value === "" ? null : Number(e.target.value) } : o) } : x) })}
                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground" /></div>
                            <div><label className="text-[9px] text-muted-foreground">Position</label>
                              <select value={ov.position} onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, position: e.target.value } : o) } : x) })}
                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                {POSITION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
                            <div><label className="text-[9px] text-muted-foreground">Style</label>
                              <select value={ov.overlayStyle} onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, overlayStyle: e.target.value } : o) } : x) })}
                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                <option value="fade">Fade</option><option value="solid">Solid</option><option value="slide_up">Slide up</option></select></div>
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            <div><label className="text-[9px] text-muted-foreground">Font</label>
                              <select value={ov.fontStyle} onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, fontStyle: e.target.value } : o) } : x) })}
                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                <option value="sans">Sans</option><option value="sans_bold">Bold</option><option value="serif">Serif</option></select></div>
                            <div><label className="text-[9px] text-muted-foreground">Size</label>
                              <select value={ov.fontSize} onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, fontSize: e.target.value } : o) } : x) })}
                                className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[11px] text-foreground">
                                <option value="small">Sm</option><option value="medium">Md</option><option value="large">Lg</option></select></div>
                            <div><label className="text-[9px] text-muted-foreground">Color</label>
                              <div className="flex items-center gap-1">
                                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(ov.textColor) ? ov.textColor : "#FFFFFF"}
                                  onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, textColor: e.target.value } : o) } : x) })}
                                  className="h-6 w-7 rounded border border-border bg-transparent shrink-0" />
                                <input value={ov.textColor}
                                  onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, textOverlays: (x.textOverlays || []).map((o, oi2) => oi2 === oi ? { ...o, textColor: e.target.value } : o) } : x) })}
                                  className="w-full rounded border border-input bg-input/40 px-1 py-0.5 text-[10px] text-foreground" /></div></div>
                          </div>
                          {(shot.textOverlays || []).length > 0 && (
                            <button type="button" onClick={() => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, showOverlays: false } : x) })}
                              className="text-[10px] text-muted-foreground hover:text-foreground">↑ Hide</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Voiceover */}
                  {shot.showVoiceover && (
                    <div className="pl-5 space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-semibold text-secondary">🎙 Voice-over</label>
                        <button type="button" onClick={() => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, showVoiceover: false, voiceoverText: "" } : x) })}
                          className="text-[10px] text-muted-foreground hover:text-destructive">✕</button>
                      </div>
                      <textarea rows={1} value={shot.voiceoverText || ""}
                        onChange={(e) => setState({ ...state, videoShots: state.videoShots.map((x, xi) => xi === i ? { ...x, voiceoverText: e.target.value } : x) })}
                        placeholder="Narration for this shot…"
                        className="w-full rounded-lg border border-secondary/30 bg-secondary/5 p-1.5 text-[11px] text-foreground focus:border-secondary/60 focus:outline-none resize-y" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Total: {videoTotalDuration}s
              {selectedVideoModel && (videoTotalDuration < (selectedVideoModel as any).min_duration || videoTotalDuration > (selectedVideoModel as any).max_duration) && (
                <span className="text-destructive"> — needs {(selectedVideoModel as any).min_duration}-{(selectedVideoModel as any).max_duration}s</span>
              )}
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-[10px] text-foreground">
            <input type="checkbox" checked={state.refineVideoPrompt} onChange={(e) => setState({ ...state, refineVideoPrompt: e.target.checked })} />
            ✨ Refine shot wording with AI before generating
          </label>
        </div>
      )}
    </div>
  );
}

function newPhaseState(days: number): PhaseFormState {
  return {
    date: defaultDate(days), time: "10:00",
    platforms: { instagram: true, facebook: true },
    wantImage: false, productImage: null, sceneText: "", useBrandKit: false, imageModelId: null, imagePromptOverride: "",
    imageAspectRatio: null, refMode: "text" as const, selectedImageTheme: null,
    themeFieldValues: {}, themePositions: {}, selectedTextStyle: null, selectedTextCategory: null,
    imageTextOverlay: null, showThemeModal: false,
    wantVideo: false, videoModelId: null, videoResolution: null, videoAspectRatio: null,
    videoFrameImage: null, videoEndFrameImage: null,
    videoShots: [{ prompt: "", duration: 6 }],
    videoMode: "single_reference" as const,
    videoAudio: false, videoCameraStyleIds: [], videoNegativePrompt: "", videoBackgroundMusicId: "none",
    videoReferencePrompt: "", showVideoReferencePrompt: false, videoStartShotId: null, videoEndShotId: null,
    refineVideoPrompt: false, refineVideoFrame: false,
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
  const [cameraStylePresets, setCameraStylePresets] = useState<{ id: string; label: string }[]>([]);
  const [musicPresets, setMusicPresets] = useState<{ id: string; label: string }[]>([]);
  const { platforms: availablePlatforms, connected: connectedPlatformIds, testMode } = useConnectedPlatforms();
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

  const [brandVideoShots, setBrandVideoShots] = useState<{ id: string; kind: string; status: string; label: string; prompt: string; duration: number }[]>([]);
  const [imageThemes, setImageThemes] = useState<ImageTheme[]>([]);
  const [textTheme, setTextTheme] = useState<{ styleTags: string[]; categoryTags: string[]; stylePrompts: Record<string, string>; categoryPrompts: Record<string, string> }>({ styleTags: [], categoryTags: [], stylePrompts: {}, categoryPrompts: {} });

  useEffect(() => {
    api("/ads/camera-style-presets").then((r: any[]) => setCameraStylePresets(r)).catch(() => {});
    api("/ads/music-presets").then((r: any[]) => setMusicPresets([{ id: "none", label: "None" }, ...r])).catch(() => {});
    api("/brand-kit/video-shots").then((shots: any[]) => setBrandVideoShots(shots)).catch(() => {});
    api("/ads/themes").then((r) => {
      const t = r.themes || {};
      setImageThemes((t.image_themes || []).map(mapImageTheme));
    }).catch(() => {});
    api("/ads/text-theme").then((r) => {
      setTextTheme({ styleTags: r.style_tags || [], categoryTags: r.category_tags || [], stylePrompts: r.style_prompts || {}, categoryPrompts: r.category_prompts || {} });
    }).catch(() => {});
  }, []);

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
      image_prompt_override: s.wantImage && s.imagePromptOverride.trim() ? s.imagePromptOverride.trim() : null,
      image_aspect_ratio: s.wantImage ? s.imageAspectRatio : null,
      text_overlay: s.wantImage ? s.imageTextOverlay : null,
      video_audio: s.wantVideo ? s.videoAudio : false,
      video_camera_style_ids: s.wantVideo ? s.videoCameraStyleIds : [],
      video_negative_prompt: s.wantVideo && s.videoNegativePrompt.trim() ? s.videoNegativePrompt.trim() : null,
      video_background_music_id: s.wantVideo && s.videoBackgroundMusicId !== "none" ? s.videoBackgroundMusicId : null,
      video_start_shot_id: s.wantVideo ? s.videoStartShotId : null,
      video_end_shot_id: s.wantVideo ? s.videoEndShotId : null,
      video_reference_prompt: s.wantVideo && s.videoReferencePrompt.trim() ? s.videoReferencePrompt.trim() : null,
      video_aspect_ratio: s.wantVideo ? s.videoAspectRatio : null,
      video_shots: s.wantVideo ? s.videoShots.map((sh) => ({
        prompt: sh.prompt,
        duration: sh.duration,
        voiceover_text: sh.voiceoverText?.trim() || null,
        text_overlays: sh.textOverlays?.filter((ov) => ov.text.trim()) ?? [],
      })) : null,
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
          <PhaseScheduleInput label="Teaser" state={teaser} setState={setTeaser} availableImageModels={availableImageModels} availableVideoModels={availableVideoModels} availablePlatforms={availablePlatforms} connectedPlatformIds={connectedPlatformIds} testMode={testMode} cameraStylePresets={cameraStylePresets} musicPresets={musicPresets} brandVideoShots={brandVideoShots} imageThemes={imageThemes} textTheme={textTheme} />
          <PhaseScheduleInput label="Launch" state={launch} setState={setLaunch} availableImageModels={availableImageModels} availableVideoModels={availableVideoModels} availablePlatforms={availablePlatforms} connectedPlatformIds={connectedPlatformIds} testMode={testMode} cameraStylePresets={cameraStylePresets} musicPresets={musicPresets} brandVideoShots={brandVideoShots} imageThemes={imageThemes} textTheme={textTheme} />
          <PhaseScheduleInput label="Follow-up" state={followup} setState={setFollowup} availableImageModels={availableImageModels} availableVideoModels={availableVideoModels} availablePlatforms={availablePlatforms} connectedPlatformIds={connectedPlatformIds} testMode={testMode} cameraStylePresets={cameraStylePresets} musicPresets={musicPresets} brandVideoShots={brandVideoShots} imageThemes={imageThemes} textTheme={textTheme} />
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
