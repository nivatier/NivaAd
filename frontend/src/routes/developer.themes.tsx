import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/themes")({
  component: DeveloperThemes,
  head: () => ({ meta: [{ title: "Themes — NivaSpark Developer" }] }),
});

type ImageForImageEntry = { thumbnail: string; prompt: string };
type ImageThemeEditor = {
  style_tags: string[];
  category_tags: string[];
  text_for_image: { style: Record<string, string>; product: Record<string, string> };
  image_for_image: { style: Record<string, ImageForImageEntry>; product: Record<string, ImageForImageEntry> };
};

type VideoThemeShot = { label: string; duration: number; prompt_template: string };
type VideoTheme = { id: string; label: string; thumbnail: string | null; category_tags: string[]; style_notes: string; shots: VideoThemeShot[] };
type VideoThemeDraft = Omit<VideoTheme, "thumbnail"> & { thumbnail: string };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Left = list of tags, right = the selected tag's editable prompt.
 * Shared by every Style/Product panel — plain text prompt only. */
function TagPromptEditor({
  tags, values, onSave, addTagAxis,
}: {
  tags: string[];
  values: Record<string, string>;
  onSave: (tag: string, prompt: string) => Promise<void>;
  addTagAxis: "style" | "category";
}) {
  const handleAuthError = useDevAuthErrorHandler();
  const [selected, setSelected] = useState(tags[0] || "");
  const [draft, setDraft] = useState(values[selected] ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setDraft(values[selected] ?? ""); setSaved(false); }, [selected]);
  useEffect(() => { if (!tags.includes(selected)) setSelected(tags[0] || ""); }, [tags.join("|")]);

  async function save() {
    setSaving(true); setErr("");
    try {
      await onSave(selected, draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  async function addTag() {
    if (!newTag.trim()) return;
    const tag = newTag.trim();
    setAddingTag(true); setErr("");
    try {
      const afterAdd = await devApi("/developer/themes/tags", { method: "POST", body: { axis: addTagAxis, tag } });
      // Auto-draft a prompt for the new tag via the developer's configured
      // text model (Developer > Settings > Theme AI models), then save it
      // as that tag's starting prompt — still fully editable afterward.
      try {
        const gen = await devApi("/developer/themes/image-theme/generate-prompt", { method: "POST", body: { axis: addTagAxis, tag } });
        const textForImage = { ...afterAdd.text_for_image, [addTagAxis]: { ...afterAdd.text_for_image[addTagAxis], [tag]: gen.prompt } };
        await devApi("/developer/themes/image-theme", { method: "PUT", body: { text_for_image: textForImage, image_for_image: afterAdd.image_for_image } });
      } catch {
        // AI draft failed (e.g. no text model configured yet) — tag still
        // got added with an empty prompt, just not auto-filled. Not fatal.
      }
      setNewTag("");
      window.location.reload(); // simplest way to refresh the full tag list + editor state together
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add tag");
    }
    setAddingTag(false);
  }

  return (
    <div className="flex gap-4">
      <div className="w-56 shrink-0 space-y-1">
        {tags.map((tag) => (
          <button key={tag} onClick={() => setSelected(tag)}
            className={`block w-full truncate rounded-lg px-3 py-2 text-left text-xs ${selected === tag ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"}`}>
            {tag}{values[tag]?.trim() ? "" : " ·"}
          </button>
        ))}
        <div className="mt-2 flex gap-1 border-t border-border pt-2">
          <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add new tag…"
            className="w-full rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none" />
          <button onClick={addTag} disabled={addingTag} className="shrink-0 rounded-lg bg-foreground px-2 text-xs text-background hover:bg-foreground/90 disabled:opacity-50">＋</button>
        </div>
      </div>
      <div className="flex-1">
        {selected ? (
          <>
            <div className="mb-1 text-xs font-semibold text-foreground">{selected}</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              placeholder="Describe the scene/background this tag should produce…"
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-3">
              <button onClick={save} disabled={saving} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
              {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">No tags yet — add one on the left.</div>
        )}
      </div>
    </div>
  );
}

type GalleryEntry = { id: string; label: string; thumbnail: string; style_tags: string[]; category_tags: string[]; base_prompt: string };
type AnalyzeResult = {
  matched_style_tags: string[]; matched_category_tags: string[];
  new_style_tag: string | null; new_category_tag: string | null;
  prompt: string; thumbnail_url: string;
};

/** Image for Image: a gallery of uploaded reference images, each carrying
 * its own set of Style + Product tags (multiple allowed per axis) and one
 * prompt. Uploading runs the AI pipeline (vision tagging + image-model
 * transform for copyright safety) and hands back a draft for review —
 * nothing is saved until the developer confirms. */
function ImageGalleryTab({ styleTags, categoryTags }: { styleTags: string[]; categoryTags: string[] }) {
  const handleAuthError = useDevAuthErrorHandler();
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [allStyleTags, setAllStyleTags] = useState(styleTags);
  const [allCategoryTags, setAllCategoryTags] = useState(categoryTags);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GalleryEntry | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [useAi, setUseAi] = useState(true);

  async function load() {
    try {
      const r = await devApi("/developer/themes");
      setEntries(r.themes.image_themes);
      setAllStyleTags(r.themes.style_tags);
      setAllCategoryTags(r.themes.category_tags);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load the gallery");
    }
  }
  useEffect(() => { load(); }, []);

  function selectExisting(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setSelectedId(id);
    setDraft({ ...entry });
    setErr("");
  }

  function startNewBlank() {
    setSelectedId(null);
    setDraft({ id: `img-${Date.now()}`, label: "", thumbnail: "", style_tags: [], category_tags: [], base_prompt: "" });
    setErr("");
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr("");
    const dataUrl = await fileToDataUrl(f);
    const id = `img-${Date.now()}`;
    if (!useAi) {
      // Manual path — no AI call, in case a model misreads the image or
      // OpenRouter is down. Just uploads nothing yet; developer fills
      // everything in by hand and picks a thumbnail URL manually if needed.
      setSelectedId(null);
      setDraft({ id, label: "", thumbnail: dataUrl, style_tags: [], category_tags: [], base_prompt: "" });
      e.target.value = "";
      return;
    }
    setAnalyzing(true);
    try {
      const result: AnalyzeResult = await devApi("/developer/themes/image-gallery/analyze", { method: "POST", body: { image: dataUrl } });
      const styleTagsForDraft = [...result.matched_style_tags, ...(result.new_style_tag ? [result.new_style_tag] : [])];
      const categoryTagsForDraft = [...result.matched_category_tags, ...(result.new_category_tag ? [result.new_category_tag] : [])];
      setSelectedId(null);
      setDraft({
        id, label: result.new_style_tag || result.matched_style_tags[0] || result.new_category_tag || "Untitled",
        thumbnail: result.thumbnail_url, style_tags: styleTagsForDraft, category_tags: categoryTagsForDraft,
        base_prompt: result.prompt,
      });
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "AI analysis failed — check Developer > Settings has a vision + image model set, or turn off AI assist and tag manually.");
    }
    setAnalyzing(false);
    e.target.value = "";
  }

  function toggleTag(axis: "style_tags" | "category_tags", tag: string) {
    if (!draft) return;
    const current = draft[axis];
    setDraft({ ...draft, [axis]: current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag] });
  }

  async function saveDraft() {
    if (!draft || !draft.label.trim() || !draft.thumbnail || !draft.base_prompt.trim()) {
      setErr("Label, thumbnail, and prompt are all required before saving.");
      return;
    }
    setSaving(true); setErr("");
    try {
      // Register any brand-new tags (from AI suggestion or typed manually)
      // into the master lists first, so they show up as filter chips too.
      for (const tag of draft.style_tags) {
        if (!allStyleTags.includes(tag)) await devApi("/developer/themes/tags", { method: "POST", body: { axis: "style", tag } });
      }
      for (const tag of draft.category_tags) {
        if (!allCategoryTags.includes(tag)) await devApi("/developer/themes/tags", { method: "POST", body: { axis: "category", tag } });
      }
      await devApi("/developer/themes/image-gallery", { method: "POST", body: draft });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
      setSelectedId(draft.id);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this gallery image? Companies using it will fall back silently.")) return;
    setErr("");
    try {
      await devApi(`/developer/themes/image-gallery/${id}`, { method: "DELETE" });
      setDraft(null); setSelectedId(null);
      await load();
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not delete");
    }
  }

  return (
    <div className="flex gap-4">
      <div className="w-64 shrink-0">
        <div className="mb-2 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            AI-assist upload
          </label>
        </div>
        <label className="block cursor-pointer rounded-lg border border-dashed border-primary/50 px-3 py-3 text-center text-[11px] text-primary hover:bg-primary/5">
          {analyzing ? "Analyzing…" : "+ Upload reference image"}
          <input type="file" accept="image/*" onChange={handleUpload} disabled={analyzing} className="hidden" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {entries.map((entry) => (
            <button key={entry.id} onClick={() => selectExisting(entry.id)}
              className={`overflow-hidden rounded-lg border text-left ${selectedId === entry.id ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/40"}`}>
              <img src={entry.thumbnail} alt={entry.label} className="h-16 w-full object-cover" />
              <div className="truncate px-1.5 py-1 text-[10px] text-foreground">{entry.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 rounded-xl border border-border bg-card/60 p-4">
        {!draft ? (
          <div className="text-xs text-muted-foreground">Select an image on the left, or upload a new reference.</div>
        ) : (
          <>
            <div className="mb-3 flex items-start gap-3">
              {draft.thumbnail ? (
                <img src={draft.thumbnail} alt={draft.label} className="h-24 w-24 rounded-lg object-cover border border-border" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground">No image</div>
              )}
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground">Label</label>
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
              </div>
            </div>

            <div className="mb-3">
              <div className="text-[11px] font-semibold text-muted-foreground mb-1">Style tags</div>
              <div className="flex flex-wrap gap-1.5">
                {allStyleTags.map((tag) => (
                  <button key={tag} onClick={() => toggleTag("style_tags", tag)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${draft.style_tags.includes(tag) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <div className="text-[11px] font-semibold text-muted-foreground mb-1">Product tags</div>
              <div className="flex flex-wrap gap-1.5">
                {allCategoryTags.map((tag) => (
                  <button key={tag} onClick={() => toggleTag("category_tags", tag)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${draft.category_tags.includes(tag) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <label className="text-[11px] text-muted-foreground">Prompt</label>
            <textarea
              value={draft.base_prompt}
              onChange={(e) => setDraft({ ...draft, base_prompt: e.target.value })}
              rows={5}
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none"
            />

            <div className="mt-3 flex items-center gap-3">
              <button onClick={saveDraft} disabled={saving} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
                {saving ? "Saving…" : "Save to gallery"}
              </button>
              {selectedId && (
                <button onClick={() => deleteEntry(selectedId)} className="rounded-full border border-destructive/50 px-4 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                  Delete
                </button>
              )}
              {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
            </div>
            {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function ImageThemeTab() {
  const handleAuthError = useDevAuthErrorHandler();
  const [data, setData] = useState<ImageThemeEditor | null>(null);
  const [err, setErr] = useState("");
  const [subTab, setSubTab] = useState<"text_for_image" | "image_for_image">("text_for_image");
  const [axis, setAxis] = useState<"style" | "product">("style");
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateMsg, setGenerateMsg] = useState("");

  async function load() {
    try {
      const r = await devApi("/developer/themes/image-theme");
      setData(r);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load");
    }
  }
  useEffect(() => { load(); }, []);

  async function saveTextPrompt(tag: string, prompt: string) {
    if (!data) return;
    const updated: ImageThemeEditor = {
      ...data,
      text_for_image: {
        ...data.text_for_image,
        [axis]: { ...data.text_for_image[axis], [tag]: prompt },
      },
    };
    await devApi("/developer/themes/image-theme", { method: "PUT", body: { text_for_image: updated.text_for_image, image_for_image: updated.image_for_image } });
    setData(updated);
  }

  async function generateAllMissing() {
    setGeneratingAll(true); setErr(""); setGenerateMsg("");
    try {
      const r = await devApi("/developer/themes/image-theme/generate-all-missing", { method: "POST" });
      setData(r.editor);
      setGenerateMsg(r.filled === 0 ? "Nothing to fill — every tag already has a prompt." : `Filled ${r.filled} tag${r.filled === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} failed (try again)` : ""}.`);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not generate — check a text model is set in Developer > Settings.");
    }
    setGeneratingAll(false);
  }

  if (err) return <div className="text-xs text-destructive">{err}</div>;
  if (!data) return <div className="text-xs text-muted-foreground">Loading…</div>;

  const tags = axis === "style" ? data.style_tags : data.category_tags;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {([["text_for_image", "Text for Image"], ["image_for_image", "Image for Image"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${subTab === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
            {l}
          </button>
        ))}
      </div>
      <p className="mb-4 max-w-2xl text-[11px] text-muted-foreground">
        {subTab === "text_for_image"
          ? "Used when a company hasn't uploaded a product photo — a pure text description of the scene."
          : "Used when a company HAS uploaded a product photo — pick a reference image whose style/product tags match."}
      </p>

      {subTab === "text_for_image" ? (
        <>
          <div className="mb-4 flex items-center gap-2">
            {([["style", "Style"], ["product", "Product"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setAxis(k)}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${axis === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                {l}
              </button>
            ))}
            <button onClick={generateAllMissing} disabled={generatingAll}
              className="ml-auto rounded-full border border-primary/50 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">
              {generatingAll ? "Generating…" : "✨ Generate all missing prompts"}
            </button>
          </div>
          {generateMsg && <div className="mb-2 text-[11px] text-emerald-400">{generateMsg}</div>}
          <div className="max-w-3xl rounded-xl border border-border bg-card/60 p-4">
            <TagPromptEditor tags={tags} values={data.text_for_image[axis]} onSave={saveTextPrompt} addTagAxis={axis === "style" ? "style" : "category"} />
          </div>
        </>
      ) : (
        <ImageGalleryTab styleTags={data.style_tags} categoryTags={data.category_tags} />
      )}
    </div>
  );
}

/** Video Theme gallery — deliberately mirrors the Image Theme Reference
 * gallery's card model (thumbnail + label + tags + prompt content), just
 * with a repeatable shots[] list instead of one base_prompt. Thumbnails can
 * be uploaded manually OR AI-generated as a still "hero frame" from one of
 * the theme's own shot prompts — developer's choice per entry. */
function VideoThemeTab({ categoryTags }: { categoryTags: string[] }) {
  const handleAuthError = useDevAuthErrorHandler();
  const [entries, setEntries] = useState<VideoTheme[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VideoThemeDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [err, setErr] = useState("");

  const [showBrief, setShowBrief] = useState(false);
  const [brief, setBrief] = useState("");
  const [briefTags, setBriefTags] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);

  async function load() {
    try {
      setEntries(await devApi("/developer/themes/video-themes"));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load video themes");
    }
  }
  useEffect(() => { load(); }, []);

  function selectExisting(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setSelectedId(id);
    setDraft({ ...entry, thumbnail: entry.thumbnail || "", shots: entry.shots.map((s) => ({ ...s })) });
    setErr("");
  }

  function startNewBlank() {
    setSelectedId(null);
    setDraft({ id: `video-${Date.now()}`, label: "", thumbnail: "", category_tags: [], style_notes: "", shots: [{ label: "Shot 1", duration: 3, prompt_template: "" }] });
    setErr("");
  }

  async function generateFromBrief() {
    if (!brief.trim()) return;
    setDrafting(true); setErr("");
    try {
      const r: { label: string; style_notes: string; shots: VideoThemeShot[] } =
        await devApi("/developer/themes/video-gallery/generate-draft", { method: "POST", body: { brief: brief.trim(), category_tags: briefTags } });
      setSelectedId(null);
      setDraft({
        id: `video-${Date.now()}`, label: r.label || "Untitled", thumbnail: "",
        category_tags: briefTags, style_notes: r.style_notes,
        shots: r.shots.length ? r.shots : [{ label: "Shot 1", duration: 3, prompt_template: "" }],
      });
      setShowBrief(false); setBrief(""); setBriefTags([]);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "AI draft failed — check Developer > Settings has a text model set, or write the theme manually.");
    }
    setDrafting(false);
  }

  async function handleThumbnailUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !draft) return;
    const dataUrl = await fileToDataUrl(f);
    setThumbBusy(true); setErr("");
    try {
      const r: { url: string } = await devApi("/developer/themes/thumbnail", { method: "POST", body: { image: dataUrl } });
      setDraft({ ...draft, thumbnail: r.url });
    } catch (ex: any) {
      if (!handleAuthError(ex)) setErr(ex.message || "Upload failed");
    }
    setThumbBusy(false);
    e.target.value = "";
  }

  async function generateThumbnailFromShot() {
    if (!draft || !draft.shots[0]?.prompt_template.trim()) {
      setErr("Add a shot prompt first — the thumbnail is generated from your first shot's prompt.");
      return;
    }
    setThumbBusy(true); setErr("");
    try {
      const r: { url: string } = await devApi("/developer/themes/video-gallery/generate-thumbnail", { method: "POST", body: { prompt: draft.shots[0].prompt_template } });
      setDraft({ ...draft, thumbnail: r.url });
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "AI thumbnail generation failed — check Developer > Settings has an image model set, or upload one manually.");
    }
    setThumbBusy(false);
  }

  function toggleTag(tag: string) {
    if (!draft) return;
    const current = draft.category_tags;
    setDraft({ ...draft, category_tags: current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag] });
  }

  function updateShot(i: number, patch: Partial<VideoThemeShot>) {
    if (!draft) return;
    const shots = draft.shots.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setDraft({ ...draft, shots });
  }
  function addShot() {
    if (!draft) return;
    setDraft({ ...draft, shots: [...draft.shots, { label: `Shot ${draft.shots.length + 1}`, duration: 3, prompt_template: "" }] });
  }
  function removeShot(i: number) {
    if (!draft || draft.shots.length <= 1) return;
    setDraft({ ...draft, shots: draft.shots.filter((_, idx) => idx !== i) });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.label.trim() || draft.shots.some((s) => !s.label.trim() || !s.prompt_template.trim())) {
      setErr("Label and every shot's label + prompt are required before saving.");
      return;
    }
    setSaving(true); setErr("");
    try {
      const saved_: VideoTheme[] = await devApi("/developer/themes/video-gallery", {
        method: "POST",
        body: { id: draft.id, label: draft.label.trim(), thumbnail: draft.thumbnail || null, category_tags: draft.category_tags, style_notes: draft.style_notes.trim(), shots: draft.shots },
      });
      setEntries(saved_);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setSelectedId(draft.id);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this video theme? Companies using it will fall back silently.")) return;
    setErr("");
    try {
      setEntries(await devApi(`/developer/themes/video-gallery/${id}`, { method: "DELETE" }));
      setDraft(null); setSelectedId(null);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not delete");
    }
  }

  return (
    <div className="flex gap-4">
      <div className="w-64 shrink-0 space-y-2">
        <button onClick={startNewBlank}
          className="block w-full rounded-lg border border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary">
          + New theme (blank)
        </button>
        {showBrief ? (
          <div className="rounded-lg border border-primary/40 bg-card/60 p-2.5 space-y-2">
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="e.g. Slow-motion unboxing with warm autumn light…"
              className="w-full rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] leading-relaxed text-foreground focus:border-ring focus:outline-none" />
            <div className="flex flex-wrap gap-1">
              {categoryTags.map((tag) => (
                <button key={tag} onClick={() => setBriefTags((t) => t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag])}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${briefTags.includes(tag) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={generateFromBrief} disabled={drafting || !brief.trim()}
                className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
                {drafting ? "Drafting…" : "Generate"}
              </button>
              <button onClick={() => setShowBrief(false)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowBrief(true)}
            className="block w-full rounded-lg border border-dashed border-primary/50 px-3 py-2 text-center text-[11px] text-primary hover:bg-primary/5">
            ✨ Draft from a brief
          </button>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {entries.map((entry) => (
            <button key={entry.id} onClick={() => selectExisting(entry.id)}
              className={`overflow-hidden rounded-lg border text-left ${selectedId === entry.id ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/40"}`}>
              {entry.thumbnail ? (
                <img src={entry.thumbnail} alt={entry.label} className="h-16 w-full object-cover" />
              ) : (
                <div className="flex h-16 w-full items-center justify-center bg-muted text-[9px] text-muted-foreground">No thumbnail</div>
              )}
              <div className="truncate px-1.5 py-1 text-[10px] text-foreground">{entry.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 rounded-xl border border-border bg-card/60 p-4">
        {!draft ? (
          <div className="text-xs text-muted-foreground">Select a theme on the left, start a blank one, or draft one from a brief.</div>
        ) : (
          <>
            <div className="mb-3 flex items-start gap-3">
              {draft.thumbnail ? (
                <img src={draft.thumbnail} alt={draft.label} className="h-24 w-24 rounded-lg object-cover border border-border" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground text-center px-1">No thumbnail</div>
              )}
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground">Label</label>
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none mb-2" />
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                    Upload thumbnail
                    <input type="file" accept="image/*" onChange={handleThumbnailUpload} disabled={thumbBusy} className="hidden" />
                  </label>
                  <button onClick={generateThumbnailFromShot} disabled={thumbBusy}
                    className="rounded-full border border-primary/50 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50">
                    {thumbBusy ? "…" : "✨ Generate from first shot"}
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <div className="text-[11px] font-semibold text-muted-foreground mb-1">Product categories</div>
              <div className="flex flex-wrap gap-1.5">
                {categoryTags.map((tag) => (
                  <button key={tag} onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${draft.category_tags.includes(tag) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <label className="text-[11px] text-muted-foreground">Style notes</label>
            <textarea value={draft.style_notes} onChange={(e) => setDraft({ ...draft, style_notes: e.target.value })} rows={2}
              placeholder="Overall look, mood, and pacing shown to companies browsing this theme…"
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none mb-3" />

            <div className="mb-1 flex items-center justify-between">
              <div className="text-[11px] font-semibold text-muted-foreground">Shots</div>
              <button onClick={addShot} className="rounded-full border border-dashed border-primary/50 px-2.5 py-0.5 text-[11px] text-primary hover:bg-primary/5">+ Add shot</button>
            </div>
            <div className="space-y-2 mb-3">
              {draft.shots.map((shot, i) => (
                <div key={i} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <input value={shot.label} onChange={(e) => updateShot(i, { label: e.target.value })} placeholder="Shot label"
                      className="flex-1 rounded-lg border border-border bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none" />
                    <input type="number" min={1} max={30} value={shot.duration} onChange={(e) => updateShot(i, { duration: Number(e.target.value) })}
                      className="w-16 rounded-lg border border-border bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none" />
                    <span className="text-[10px] text-muted-foreground shrink-0">sec</span>
                    {draft.shots.length > 1 && (
                      <button onClick={() => removeShot(i)} className="shrink-0 rounded-full border border-destructive/50 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/10">Remove</button>
                    )}
                  </div>
                  <textarea value={shot.prompt_template} onChange={(e) => updateShot(i, { prompt_template: e.target.value })} rows={2}
                    placeholder="Video generation prompt — must include {product} exactly once…"
                    className="w-full rounded-lg border border-border bg-input/40 px-2 py-1.5 text-[11px] leading-relaxed text-foreground focus:border-ring focus:outline-none font-mono" />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={saveDraft} disabled={saving} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
                {saving ? "Saving…" : "Save theme"}
              </button>
              {selectedId && (
                <button onClick={() => deleteEntry(selectedId)} className="rounded-full border border-destructive/50 px-4 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                  Delete
                </button>
              )}
              {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
            </div>
            {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}

type TextStylePreset = { id: string; label: string; font_style: string; text_color: string; accent_color: string; size: string };
const SIZE_OPTIONS = [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["xlarge", "Extra large"]] as const;

function PresetForm({
  initial, onSubmit, onCancel, busy,
}: {
  initial: Partial<TextStylePreset>;
  onSubmit: (v: { label: string; font_style: string; text_color: string; accent_color: string; size: string }) => void;
  onCancel?: () => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState(initial.label ?? "");
  const [fontStyle, setFontStyle] = useState(initial.font_style ?? "");
  const [textColor, setTextColor] = useState(initial.text_color ?? "#FFFFFF");
  const [accentColor, setAccentColor] = useState(initial.accent_color ?? "#000000");
  const [size, setSize] = useState(initial.size ?? "medium");

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Bold White on Black"
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Font style</label>
        <input value={fontStyle} onChange={(e) => setFontStyle(e.target.value)} placeholder="e.g. Bold sans-serif"
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Text color</label>
        <div className="flex items-center gap-2">
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : "#FFFFFF"} onChange={(e) => setTextColor(e.target.value)} className="h-8 w-10 rounded border border-border bg-transparent" />
          <input value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Accent / outline color</label>
        <div className="flex items-center gap-2">
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#000000"} onChange={(e) => setAccentColor(e.target.value)} className="h-8 w-10 rounded border border-border bg-transparent" />
          <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Size</label>
        <select value={size} onChange={(e) => setSize(e.target.value)}
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
          {SIZE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button disabled={busy || !label.trim()} onClick={() => onSubmit({ label: label.trim(), font_style: fontStyle, text_color: textColor, accent_color: accentColor, size })}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        {onCancel && <button onClick={onCancel} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>}
      </div>
    </div>
  );
}

function TextStylesTab() {
  const handleAuthError = useDevAuthErrorHandler();
  const [presets, setPresets] = useState<TextStylePreset[] | null>(null);
  const [err, setErr] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setPresets(await devApi("/developer/themes/text-style-presets"));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load");
    }
  }
  useEffect(() => { load(); }, []);

  async function add(v: { label: string; font_style: string; text_color: string; accent_color: string; size: string }) {
    setBusy(true); setErr("");
    try {
      setPresets(await devApi("/developer/themes/text-style-presets", { method: "POST", body: v }));
      setShowAdd(false);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add");
    }
    setBusy(false);
  }

  async function update(id: string, v: { label: string; font_style: string; text_color: string; accent_color: string; size: string }) {
    setBusy(true); setErr("");
    try {
      setPresets(await devApi(`/developer/themes/text-style-presets/${id}`, { method: "PUT", body: v }));
      setEditingId(null);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm("Delete this text style preset? Any ad currently mid-generation with it selected still finishes fine — new selections just won't see it anymore.")) return;
    setErr("");
    try {
      setPresets(await devApi(`/developer/themes/text-style-presets/${id}`, { method: "DELETE" }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not delete");
    }
  }

  if (!presets) return <div className="text-xs text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-[11px] text-muted-foreground">
        Font style, text color, accent/outline color, and size for the Headline / Discount badge / Body text
        companies overlay onto AI-generated images. "Standard (fits the image)" is the default — the AI decides
        based on the background, same as before presets existed. Companies pick a preset per field in Create Ad.
      </p>
      <div className="space-y-2 mb-4">
        {presets.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-card/60 p-3">
            {editingId === p.id ? (
              <PresetForm initial={p} busy={busy} onCancel={() => setEditingId(null)} onSubmit={(v) => update(p.id, v)} />
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  <span className="h-6 w-6 rounded border border-border" style={{ background: p.text_color || "#888" }} title="Text color" />
                  <span className="h-6 w-6 rounded border border-border" style={{ background: p.accent_color || "#888" }} title="Accent color" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-semibold text-foreground">{p.label}</div>
                  <div className="text-[11px] text-muted-foreground">{p.font_style || "—"} {p.size && `· ${p.size}`}</div>
                </div>
                {p.id !== "standard" && (
                  <>
                    <button onClick={() => setEditingId(p.id)} className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground">Edit</button>
                    <button onClick={() => remove(p.id)} className="rounded-full border border-destructive/50 px-3 py-1 text-[11px] text-destructive hover:bg-destructive/10">Delete</button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd ? (
        <div className="rounded-xl border border-border bg-card/60 p-3">
          <PresetForm initial={{}} busy={busy} onCancel={() => setShowAdd(false)} onSubmit={add} />
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="rounded-full border border-dashed border-primary/50 px-4 py-1.5 text-xs text-primary hover:bg-primary/5">
          + Add text style
        </button>
      )}
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function DeveloperThemes() {
  const allowed = useRequireDeveloperPermission("themes");
  const [tab, setTab] = useState<"text" | "image" | "video" | "styles">("image");
  const [categoryTags, setCategoryTags] = useState<string[]>([]);

  useEffect(() => {
    devApi("/developer/themes").then((r) => setCategoryTags(r.themes.category_tags)).catch(() => {});
  }, []);

  if (!allowed) return null;

  return (
    <DeveloperShell title="Themes">
      <p className="mb-6 max-w-2xl text-xs text-muted-foreground">
        Manages the theme references companies see in Create Ad — Text Theme Reference chips, the Image Theme
        Reference gallery, the Video Theme Reference gallery, and text-overlay style presets. Changes here appear
        for every company immediately.
      </p>

      <div className="mb-6 flex gap-2 border-b border-border pb-3">
        {([["text", "Text Themes"], ["image", "Image Theme"], ["styles", "Text Styles"], ["video", "Video Theme"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${tab === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "text" && (
        <div className="text-xs text-muted-foreground">Visual editor for Text Themes is coming next — same style/product per-tag editing as Image Theme below.</div>
      )}
      {tab === "image" && <ImageThemeTab />}
      {tab === "styles" && <TextStylesTab />}
      {tab === "video" && <VideoThemeTab categoryTags={categoryTags} />}
    </DeveloperShell>
  );
}
