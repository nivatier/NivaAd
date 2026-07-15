import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell, Panel, Field, Input, Chip } from "@/components/app-shell";
import { PLATFORMS, estimateCost, PlatformPreviewCard, PromptConfirmModal, type AdVariant } from "@/components/create-ad-parts";
import { CAROUSEL_MAX_IMAGES, CAROUSEL_MIN_IMAGES, MAX_VIDEO_SHOTS } from "@/lib/constants";
import { TimezoneSelect } from "@/components/timezone-picker";
import { detectedTimeZone, zonedWallTimeToUtcNaiveIso } from "@/lib/timezone";
import { api, type AvailableModelsOut } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/app/")({
  component: CreateAd,
  head: () => ({ meta: [{ title: "Create Ad — NivaAd" }] }),
});

const STEPS = ["Setup", "Generate", "Preview & Post"];
const GOALS = ["Drive sales", "Product launch", "Brand awareness", "Get signups"];
const TONES = ["Professional", "Fun", "Luxury", "Minimal"];
const ENV_STYLES = ["Studio", "Lifestyle / in use", "Outdoor / nature", "Home setting", "Luxury / premium", "Festive / seasonal"];

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
  const [imageReferenceImage, setImageReferenceImage] = useState<string | null>(null);
  const [envStyle, setEnvStyle] = useState("Studio");
  const placementTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [envDesc, setEnvDesc] = useState("");
  const [imageScene, setImageScene] = useState("");
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
  const [carouselSlides, setCarouselSlides] = useState<string[]>(Array(CAROUSEL_MAX_IMAGES).fill(""));
  const [availableModels, setAvailableModels] = useState<AvailableModelsOut | null>(null);
  const [textModelId, setTextModelId] = useState<string | null>(null);
  const [imageModelId, setImageModelId] = useState<string | null>(null);
  const [videoModelId, setVideoModelId] = useState<string | null>(null);
  const [videoResolution, setVideoResolution] = useState<string | null>(null);
  const [videoAudio, setVideoAudio] = useState(true);
  const [liveImageCredits, setLiveImageCredits] = useState<number | null>(null);
  const [liveVideoCredits, setLiveVideoCredits] = useState<number | null>(null);
  const [liveTextCredits, setLiveTextCredits] = useState<number | null>(null);
  const [videoShots, setVideoShots] = useState<{ prompt: string; duration: number }[]>([{ prompt: "", duration: 6 }]);

  // Platforms
  const [selected, setSelected] = useState<Record<string, boolean>>({ instagram: true, facebook: true, linkedin: false, x: false, tiktok: false });

  // Generation state
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [warning, setWarning] = useState("");
  const [referenceRejectedMsg, setReferenceRejectedMsg] = useState("");
  const [retentionMonths, setRetentionMonths] = useState<number | null>(null);
  const [retryingWithoutRef, setRetryingWithoutRef] = useState(false);
  const [adId, setAdId] = useState<string | null>(null);
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

  const chosenPlatforms = PLATFORMS.filter((p) => selected[p.id]);
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

  const results = variants ? variants[activeVariant] : null;

  function resetWizard() {
    setStep(1); setProductName(""); setAudience(""); setDescription(""); setOffer("");
    setGoal("Drive sales"); setTone("Professional"); setVideoFrameImage(null); setImageReferenceImage(null);
    setEnvStyle("Studio"); setEnvDesc(""); setImageScene("");
    setAdId(null); setVariants(null); setPostedMap({}); setBlocked(false); setWarning(""); setErrorMsg("");
    setSelectedProductId(null);
    setFormat("single"); setVariations(1); setCarouselCount(3); setCarouselSlides(Array(CAROUSEL_MAX_IMAGES).fill(""));
    setVideoShots([{ prompt: "", duration: selectedVideoModel?.min_duration || 6 }]);
  }

  // Just clears what's typed in the brief (step 1) — stays on step 1,
  // unlike resetWizard() which abandons the whole in-progress ad.
  function clearBrief() {
    setProductName(""); setAudience(""); setDescription(""); setOffer("");
    setGoal("Drive sales"); setTone("Professional"); setVideoFrameImage(null); setImageReferenceImage(null);
    setEnvStyle("Studio"); setEnvDesc(""); setImageScene(""); setSelectedProductId(null);
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
    api("/ads/retention-info").then((r) => setRetentionMonths(r.retention_months)).catch(() => { /* non-fatal — notice just won't show a specific number */ });
    api("/ads/available-models").then((models: AvailableModelsOut) => {
      setAvailableModels(models);
      if (models.text.length > 0) setTextModelId(models.text[0].id);
      if (models.image.length > 0) setImageModelId(models.image[0].id);
      if (models.video.length > 0) {
        setVideoModelId(models.video[0].id);
        setVideoResolution(models.video[0].resolutions?.[0] ?? null);
        setVideoShots([{ prompt: "", duration: models.video[0].min_duration ?? 6 }]);
      }
    }).catch(() => { /* non-fatal — dropdowns just won't have options until this loads, generation will be blocked with a clear message until then */ });
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

  async function handleImageReferenceImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageReferenceImage(await fileToDataUrl(f));
  }

  async function openPromptPreview() {
    setErrorMsg(""); setPreviewBusy(true);
    try {
      const res = await api("/ads/preview-prompt", {
        method: "POST",
        body: {
          product_name: productName, description, audience, offer, goal, tone,
          env: imageReferenceImage ? (envDesc || envStyle) : null,
          image_scene: !imageReferenceImage && imageScene ? imageScene : null,
          has_photo: !!imageReferenceImage,
          tagline: useTagline && brandTagline ? brandTagline : null,
          platforms: chosenPlatforms.map((p) => p.id),
          outputs,
          format, variations,
          carousel_slides: format === "carousel" ? carouselSlides.slice(0, carouselCount) : null,
          video_shots: outputs.video ? videoShots : null,
        },
      });
      setTextPrompt(res.text_prompt);
      setImagePrompt(res.image_prompt || "");
      setVideoPrompt(res.video_prompt || "");
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
            env: imageReferenceImage ? (envDesc || envStyle) : null,
            image_scene: !imageReferenceImage && imageScene ? imageScene : null,
            product_image: null,
            product_image_url: null,
            product_id: selectedProductId,
            tagline: useTagline && brandTagline ? brandTagline : null,
            use_brand_logo: useLogo,
            platforms: chosenPlatforms.map((p) => p.id),
            outputs, format, variations,
            carousel_slides: format === "carousel" ? carouselSlides.slice(0, carouselCount) : null,
            video_shots: outputs.video ? videoShots : null,
            video_frame_image: outputs.video && isDataUrlVideoFrame ? videoFrameImage : null,
            video_frame_image_url: outputs.video && !isDataUrlVideoFrame && videoFrameImage ? videoFrameImage : null,
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
          },
        });
        id = res.ad_id; setAdId(id);
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
    } catch (e: any) {
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
    <AppShell eyebrow="Create" title="What is this ad for?">
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
          <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-5">
            <div className="text-xs font-medium uppercase tracking-widest text-primary">⚡ Quick start</div>
            <p className="mt-1 text-[11px] text-muted-foreground">URL import isn't wired up yet — fill the fields below directly.</p>
          </div>

          <h2 className="mt-6 font-display text-xl font-bold text-foreground">Tick what you need generated</h2>
          <p className="mt-1 text-xs text-muted-foreground">Ad Text is always available. You can generate an AI Image OR an AI Video for this ad, not both — ticking one turns the other off.</p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {/* ===== AD TEXT ===== */}
            <div className={`rounded-xl border p-4 ${outputs.text ? "border-primary bg-primary/5" : "border-border"}`}>
              <button onClick={() => setOutputs((o) => ({ ...o, text: !o.text }))} className="flex w-full items-center justify-between text-left">
                <div>
                  <div className="text-sm font-semibold text-foreground">{outputs.text ? "☑" : "☐"} ✍️ Ad Text</div>
                  <div className="text-xs text-muted-foreground mt-0.5">~1 credit</div>
                </div>
              </button>
              {outputs.text && (
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-foreground mb-2">Text Model</div>
                    <select
                      value={textModelId || ""}
                      onChange={(e) => setTextModelId(e.target.value)}
                      className="w-full max-w-sm rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {!availableModels && <option value="">Loading options…</option>}
                      {availableModels?.text.map((m) => (
                        <option key={m.id} value={m.id}>{m.label} — {m.credits} credit{m.credits > 1 ? "s" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground mb-2">Variations</div>
                    <div className="flex gap-2">
                      {[[1, "1 version"], [3, "3 variations ×2cr"]].map(([v, l]) => (
                        <button key={v as number} onClick={() => setVariations(v as number)} className={`rounded-full border px-4 py-2 text-xs ${variations === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
                      ))}
                    </div>
                  </div>

                  <Field label="Product / service name *" hint="The exact name as it should appear in the ad.">
                    <Input placeholder="e.g. AquaGlow Smart Bottle" value={productName} onChange={(e) => setProductName(e.target.value)} />
                  </Field>
                  <Field label="Target audience *" hint="Who should this ad speak to? Age, interests, lifestyle.">
                    <Input placeholder="e.g. fitness-focused professionals, 25-40, urban" value={audience} onChange={(e) => setAudience(e.target.value)} />
                  </Field>
                  <Field label="Describe the product & what makes it special *" hint="Mention 2-3 concrete features — specifics make ads convert.">
                    <textarea
                      rows={4}
                      placeholder="e.g. Stainless-steel smart water bottle that tracks hydration and glows to remind you to drink."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full rounded-lg border border-input bg-input/40 p-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                  <Field label="Offer / promotion (optional)" hint="Discounts and deadlines create urgency.">
                    <Input placeholder="e.g. 20% off launch week, free shipping" value={offer} onChange={(e) => setOffer(e.target.value)} />
                  </Field>
                  <div>
                    <div className="text-sm font-medium text-foreground">Campaign goal & tone</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {GOALS.map((g) => <Chip key={g} active={goal === g} onClick={() => setGoal(g)}>{g}</Chip>)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TONES.map((t) => <Chip key={t} active={tone === t} onClick={() => setTone(t)}>{t}</Chip>)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ===== AI IMAGE ===== */}
            <div className={`rounded-xl border p-4 ${outputs.image ? "border-primary bg-primary/5" : outputs.video ? "border-border opacity-40" : "border-border"}`}>
              <button
              disabled={outputs.video}
              onClick={() => setOutputs((o) => ({ ...o, image: !o.image }))}
              className="flex w-full items-center justify-between text-left disabled:cursor-not-allowed"
            >
              <div>
                <div className="text-sm font-semibold text-foreground">{outputs.image ? "☑" : "☐"} 🖼️ AI Image</div>
                <div className="text-xs text-muted-foreground mt-0.5">{outputs.video ? "Turn off AI Video to pick this instead" : "~2 credits"}</div>
              </div>
            </button>
            {outputs.image && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold text-foreground mb-2">Image Model</div>
                  <select
                    value={imageModelId || ""}
                    onChange={(e) => setImageModelId(e.target.value)}
                    className="w-full max-w-sm rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {!availableModels && <option value="">Loading options…</option>}
                    {availableModels?.image.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} — {m.credits} credit{m.credits > 1 ? "s" : ""}</option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <div className="text-xs font-semibold text-foreground">Reference image (optional)</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    If attached, the image generates around this exact photo. If not, it falls back to your product photo from Step 1 (if any), or is fully AI-imagined from your description.
                  </p>
                  {imageReferenceImage ? (
                    <div className="mt-3 flex items-center gap-3">
                      <img src={imageReferenceImage} alt="image reference" className="h-16 w-16 rounded-lg border border-border object-cover" />
                      <div className="text-[11px] text-emerald-400">✓ This photo will be used as the generation reference.</div>
                      <button onClick={() => setImageReferenceImage(null)} className="ml-auto rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive">Remove</button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background">
                        Upload reference image
                        <input type="file" accept="image/*" onChange={handleImageReferenceImage} className="hidden" />
                      </label>
                      <span className="text-[11px] text-muted-foreground">No image = fully AI-imagined from your description</span>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <label className="text-xs font-semibold text-foreground">{imageReferenceImage ? "Product placement & surroundings" : "Describe how the AI-generated image should look"}</label>
                  <div className="text-[11px] text-muted-foreground mt-1 mb-2">
                    {imageReferenceImage ? "💡 Describe how to place YOUR product and what should surround it. Pick a quick style below, or write your own in the box — whatever you type there is always what's actually used." : "💡 No photo uploaded — describe the background/environment for a fully AI-generated image."}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {ENV_STYLES.map((s) => (
                      <button key={s} type="button" onClick={() => (imageReferenceImage ? setEnvStyle(s) : setImageScene((p) => p || s))}
                        className={`rounded-full border px-3 py-1.5 text-xs ${imageReferenceImage && envStyle === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                        {s}
                      </button>
                    ))}
                    <button type="button" onClick={() => placementTextareaRef.current?.focus()}
                      className="rounded-full border border-dashed border-primary/50 px-3 py-1.5 text-xs text-primary hover:bg-primary/5">
                      ✏️ Define your own
                    </button>
                  </div>
                  <textarea
                    ref={placementTextareaRef}
                    rows={2}
                    value={imageReferenceImage ? envDesc : imageScene}
                    onChange={(e) => (imageReferenceImage ? setEnvDesc(e.target.value) : setImageScene(e.target.value))}
                    placeholder={imageReferenceImage ? "e.g. place the bottle upright on a wooden gym bench, morning sunlight" : "e.g. minimalist studio background, soft top lighting"}
                    className="w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <div className="text-xs font-semibold text-foreground mb-2">Image format</div>
                  <div className="flex gap-2">
                    {[["single", "🖼 Single"], ["carousel", "🎠 Carousel"]].map(([f, l]) => (
                      <button key={f} onClick={() => setFormat(f)} className={`rounded-full border px-4 py-2 text-xs ${format === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
                    ))}
                  </div>
                </div>

                {format === "carousel" && (
                  <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-foreground">Carousel images</div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setCarouselCount((n) => Math.max(CAROUSEL_MIN_IMAGES, n - 1))} className="grid h-7 w-7 place-items-center rounded-full border border-border text-sm text-foreground hover:border-primary/40">−</button>
                        <span className="w-6 text-center text-sm font-semibold text-foreground">{carouselCount}</span>
                        <button onClick={() => setCarouselCount((n) => Math.min(CAROUSEL_MAX_IMAGES, n + 1))} className="grid h-7 w-7 place-items-center rounded-full border border-border text-sm text-foreground hover:border-primary/40">＋</button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Up to {CAROUSEL_MAX_IMAGES} images — each is a real, separate AI generation, so cost scales with the count (2 credits × {carouselCount} = {2 * carouselCount} credits for the image tier shown here).</p>
                    <div className="mt-3 space-y-2">
                      {Array.from({ length: carouselCount }).map((_, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-[11px] text-muted-foreground">#{i + 1}</span>
                          <input
                            placeholder={`Describe image ${i + 1} (optional — e.g. "close-up on the label")`}
                            value={carouselSlides[i] || ""}
                            onChange={(e) => setCarouselSlides((s) => { const copy = [...s]; copy[i] = e.target.value; return copy; })}
                            className="w-full rounded-lg border border-input bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ===== AI VIDEO ===== */}
          <div className={`rounded-xl border p-4 ${outputs.video ? "border-primary bg-primary/5" : outputs.image ? "border-border opacity-40" : "border-border"}`}>
            <button
              disabled={outputs.image}
              onClick={() => setOutputs((o) => ({ ...o, video: !o.video }))}
              className="flex w-full items-center justify-between text-left disabled:cursor-not-allowed"
            >
              <div>
                <div className="text-sm font-semibold text-foreground">{outputs.video ? "☑" : "☐"} 🎬 AI Video</div>
                <div className="text-xs text-muted-foreground mt-0.5">{outputs.image ? "Turn off AI Image to pick this instead" : "~5 credits · takes a few minutes"}</div>
              </div>
            </button>
            {outputs.video && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold text-foreground mb-2">Video Model</div>
                  <select
                    value={videoModelId || ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      setVideoModelId(id);
                      const m = availableModels?.video.find((x) => x.id === id);
                      if (m) {
                        setVideoShots((s) => s.length === 1 ? [{ ...s[0], duration: m.min_duration ?? s[0].duration }] : s);
                        setVideoResolution(m.resolutions?.[0] ?? null); // each model offers its own resolutions — reset to its first (cheapest-leaning) rather than carrying over one the new model may not support
                      }
                    }}
                    className="w-full max-w-sm rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {!availableModels && <option value="">Loading options…</option>}
                    {availableModels?.video.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.credits} credit{m.credits > 1 ? "s" : ""} · {m.duration_options ? m.duration_options.map((d) => `${d}s`).join("/") : `${m.min_duration}-${m.max_duration}s`}
                      </option>
                    ))}
                  </select>
                  {selectedVideoModel?.resolutions && selectedVideoModel.resolutions.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Resolution:</span>
                      {selectedVideoModel.resolutions.map((r) => (
                        <button key={r} onClick={() => setVideoResolution(r)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] ${videoResolution === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedVideoModel?.supports_audio && (
                    <label className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground">
                      <input type="checkbox" checked={videoAudio} onChange={(e) => setVideoAudio(e.target.checked)} />
                      🔊 Generate with audio {videoAudio ? "" : "(off — usually cheaper)"}
                    </label>
                  )}
                  {selectedVideoModel?.duration_options && videoShots.length === 1 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Length:</span>
                      {selectedVideoModel.duration_options.map((d) => (
                        <button key={d} onClick={() => setVideoShots((s) => [{ ...s[0], duration: d }])}
                          className={`rounded-full border px-2.5 py-1 text-[11px] ${videoTotalDuration === d ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                          {d}s
                        </button>
                      ))}
                      <span className="text-[10px] text-muted-foreground">— this model only supports these exact lengths, not a range</span>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <div className="text-xs font-semibold text-foreground">Reference image for the video (optional)</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    If attached, the video opens on this exact photo (image-to-video). If not, the video is fully AI-generated from your prompt (text-to-video) — no image is sent either way unless you attach one here, deliberately separate from the image section's reference above.
                  </p>
                  {videoFrameImage ? (
                    <div className="mt-3 flex items-center gap-3">
                      <img src={videoFrameImage} alt="video reference" className="h-16 w-16 rounded-lg border border-border object-cover" />
                      <div className="text-[11px] text-emerald-400">✓ This photo will be sent as the video's starting frame.</div>
                      <button onClick={() => setVideoFrameImage(null)} className="ml-auto rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive">Remove</button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="inline-block cursor-pointer rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background">
                        Upload image for video
                        <input type="file" accept="image/*" onChange={handleVideoFrameImage} className="hidden" />
                      </label>
                      {imageReferenceImage && (
                        <button onClick={() => setVideoFrameImage(imageReferenceImage)} className="rounded-full border border-border px-4 py-2 text-xs text-foreground hover:border-primary/40">
                          Use the image reference above
                        </button>
                      )}
                      <span className="text-[11px] text-muted-foreground">No image = text-to-video</span>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-foreground">Video shots</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setVideoShots((s) => s.length > 1 ? s.slice(0, -1) : s)}
                        disabled={videoShots.length <= 1}
                        className="grid h-7 w-7 place-items-center rounded-full border border-border text-sm text-foreground hover:border-primary/40 disabled:opacity-40"
                      >−</button>
                      <span className="w-6 text-center text-sm font-semibold text-foreground">{videoShots.length}</span>
                      <button
                        onClick={() => setVideoShots((s) => s.length < MAX_VIDEO_SHOTS ? [...s, { prompt: "", duration: 6 }] : s)}
                        disabled={videoShots.length >= MAX_VIDEO_SHOTS}
                        className="grid h-7 w-7 place-items-center rounded-full border border-border text-sm text-foreground hover:border-primary/40 disabled:opacity-40"
                      >＋</button>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {videoShots.length > 1
                      ? `Up to ${MAX_VIDEO_SHOTS} shots — combined into ONE continuous video (a single real generation, one flat cost), with each shot's own direction and timing followed in sequence.`
                      : "One continuous shot — add more to describe several scenes within one video."}
                    {selectedVideoModel && (
                      selectedVideoModel.duration_options
                        ? <> "<b className="text-foreground">{selectedVideoModel.label}</b>" only supports these exact total lengths: {selectedVideoModel.duration_options.map((d) => `${d}s`).join(", ")}.</>
                        : <> "<b className="text-foreground">{selectedVideoModel.label}</b>" allows a total of {selectedVideoModel.min_duration}–{selectedVideoModel.max_duration}s across all shots.</>
                    )}
                  </p>
                  <div className="mt-3 space-y-3">
                    {videoShots.map((shot, i) => (
                      <div key={i} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-[11px] text-muted-foreground">#{i + 1}</span>
                          <input
                            placeholder={videoShots.length > 1 ? `Describe shot ${i + 1} — style, angle, action (e.g. "slow orbit around the bottle")` : `Describe this shot (optional — e.g. "slow push-in on the product")`}
                            value={shot.prompt}
                            onChange={(e) => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, prompt: e.target.value } : x))}
                            className="w-full rounded-lg border border-input bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <input
                            type="number"
                            value={shot.duration}
                            disabled={!!(selectedVideoModel?.duration_options && videoShots.length === 1)}
                            onChange={(e) => setVideoShots((s) => s.map((x, idx) => idx === i ? { ...x, duration: Number(e.target.value) || 0 } : x))}
                            title={selectedVideoModel?.duration_options && videoShots.length === 1 ? "This model only supports exact lengths — use the buttons above instead" : undefined}
                            className="w-16 shrink-0 rounded-lg border border-input bg-input/40 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className="shrink-0 text-[11px] text-muted-foreground">sec</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Total length: {videoTotalDuration}s</span>
                  </div>
                  {!videoShotsValid && selectedVideoModel && (
                    <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
                      ⚠ {videoTotalDuration}s total is outside what "{selectedVideoModel.label}" allows ({selectedVideoModel.min_duration}–{selectedVideoModel.max_duration}s total).
                      Pick a different video option above, or adjust your shot durations.
                    </div>
                  )}
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
              {PLATFORMS.map((p) => (
                <button key={p.id} onClick={() => setSelected((s) => ({ ...s, [p.id]: !s[p.id] }))}
                  className={`flex items-center gap-3 rounded-xl p-4 border ${selected[p.id] ? "border-primary bg-primary/5" : "border-border"}`}>
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
                  <div className="text-left text-sm text-foreground">{selected[p.id] ? "☑" : "☐"} {p.name}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              disabled={!productName.trim() || description.trim().length < 10 || !audience.trim() || (!outputs.text && !outputs.image && !outputs.video) || !videoShotsValid || chosenPlatforms.length === 0 || credits < cost || previewBusy}
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
              {" "}If you're scheduling this ad, it must be posted within that same {retentionMonths}-month window. Download a copy if you want to keep it longer.
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
            {chosenPlatforms.map((p) => (
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
              <button onClick={postAll} className="rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)]">🚀 Post all ({chosenPlatforms.filter((p) => !postedMap[p.id]).length} remaining)</button>
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
                  {chosenPlatforms.map((p) => {
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
        />
      )}
    </AppShell>
  );
}
