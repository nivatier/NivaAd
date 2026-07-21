import { useState, type ReactNode } from "react";

export type ImageThemeField = { key: string; label: string; placeholder: string; styleHint: string; defaultPosition: string };
export type ImageTheme = {
  id: string;
  label: string;
  thumbnail: string;
  styleTags: string[];
  categoryTags: string[];
  basePrompt: string;
  textFields: ImageThemeField[];
};
export type VideoTheme = {
  id: string;
  label: string;
  thumbnail: string | null;
  category_tags: string[];
  style_notes: string;
  shots: { label: string; duration: number; prompt_template: string }[];
};

/** Shown on demand via each card's Preview button — the full-size
 * thumbnail plus whatever detail the theme kind has (image themes:
 * style/category tags; video themes: shot list). Selecting from here
 * calls the same onSelect the card itself uses. */
function ThemePreviewModal({
  thumbnail, label, detail, onClose, onUse,
}: {
  thumbnail: string | null;
  label: string;
  detail: ReactNode;
  onClose: () => void;
  onUse: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground truncate pr-4">{label}</div>
          <button onClick={onClose} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground shrink-0">✕ Close</button>
        </div>
        {thumbnail ? (
          <img src={thumbnail} alt={label} className="w-full rounded-lg border border-border object-contain max-h-[55vh] bg-muted/20" />
        ) : (
          <div className="flex h-48 w-full items-center justify-center rounded-lg border border-border bg-gradient-to-br from-primary/10 to-primary/5 text-5xl">🎬</div>
        )}
        <div className="mt-3 text-xs text-muted-foreground">{detail}</div>
        <button onClick={onUse} className="mt-4 w-full rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background">Use this theme</button>
      </div>
    </div>
  );
}

export function mapImageTheme(t: any): ImageTheme {
  return {
    id: t.id, label: t.label, thumbnail: t.thumbnail || "",
    styleTags: t.style_tags || [], categoryTags: t.category_tags || [],
    basePrompt: t.base_prompt,
    textFields: (t.text_fields || []).map((f: any) => ({
      key: f.key, label: f.label, placeholder: f.placeholder || "",
      styleHint: f.style_hint || "", defaultPosition: f.default_position || "top-left",
    })),
  };
}

/** Style + category filter chips, then a thumbnail grid — the exact
 * browsing UI Create Ad's "Browse image themes" popup has always used,
 * now shared with the standalone Themes Gallery page so both stay in
 * sync automatically rather than drifting apart as two copies. */
export function ImageThemeGrid({ themes, selectedId, onSelect }: { themes: ImageTheme[]; selectedId: string | null; onSelect: (theme: ImageTheme) => void }) {
  const [filterStyle, setFilterStyle] = useState("All");
  const [filterCategory, setFilterCategory] = useState("All");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const styleOpts = ["All", ...Array.from(new Set(themes.flatMap((t) => t.styleTags)))];
  const categoryOpts = ["All", ...Array.from(new Set(themes.flatMap((t) => t.categoryTags)))];
  const visible = themes.filter((t) =>
    (filterStyle === "All" || t.styleTags.includes(filterStyle)) &&
    (filterCategory === "All" || t.categoryTags.includes(filterCategory))
  );
  const previewTheme = previewId ? themes.find((t) => t.id === previewId) || null : null;

  return (
    <div>
      <div className="mb-2">
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Style</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {styleOpts.map((tag) => (
            <button key={tag} type="button" onClick={() => setFilterStyle(tag)}
              className={`rounded-full border px-3 py-1.5 text-xs ${filterStyle === tag ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
              {tag}
            </button>
          ))}
        </div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Product category</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {categoryOpts.map((tag) => (
            <button key={tag} type="button" onClick={() => setFilterCategory(tag)}
              className={`rounded-full border px-3 py-1.5 text-xs ${filterCategory === tag ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {visible.map((t) => (
          <button key={t.id} type="button" onClick={() => onSelect(t)}
            className={`group relative rounded-xl border overflow-hidden text-left transition ${selectedId === t.id ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"}`}>
            <div className="relative h-20 w-full">
              <img src={t.thumbnail} alt={t.label} className="h-full w-full object-cover" />
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setPreviewId(t.id); }}
                className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"
              >
                <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] text-white">👁 Preview</span>
              </span>
            </div>
            <div className="p-1.5">
              <div className="text-[11px] font-semibold text-foreground truncate">{t.label}</div>
            </div>
          </button>
        ))}
        {visible.length === 0 && (
          <div className="col-span-full text-center text-xs text-muted-foreground py-8">No themes match those filters yet.</div>
        )}
        <div className="rounded-xl border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground px-2 py-6 text-center">
          More themes coming soon
        </div>
      </div>

      {previewTheme && (
        <ThemePreviewModal
          thumbnail={previewTheme.thumbnail}
          label={previewTheme.label}
          detail={[...previewTheme.styleTags, ...previewTheme.categoryTags].join(" · ") || "No tags"}
          onClose={() => setPreviewId(null)}
          onUse={() => { onSelect(previewTheme); setPreviewId(null); }}
        />
      )}
    </div>
  );
}

export function VideoThemeGrid({ themes, selectedId, onSelect }: { themes: VideoTheme[]; selectedId: string | null; onSelect: (theme: VideoTheme) => void }) {
  const [filterCategory, setFilterCategory] = useState("All");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const categoryOpts = ["All", ...Array.from(new Set(themes.flatMap((t) => t.category_tags)))];
  const visible = themes.filter((t) => filterCategory === "All" || t.category_tags.includes(filterCategory));
  const previewTheme = previewId ? themes.find((t) => t.id === previewId) || null : null;

  return (
    <div>
      <div className="mb-4">
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Product category</div>
        <div className="flex flex-wrap gap-2">
          {categoryOpts.map((tag) => (
            <button key={tag} type="button" onClick={() => setFilterCategory(tag)}
              className={`rounded-full border px-3 py-1.5 text-xs ${filterCategory === tag ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {visible.map((t) => (
          <button key={t.id} type="button" onClick={() => onSelect(t)}
            className={`group relative rounded-xl border overflow-hidden text-left transition ${selectedId === t.id ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"}`}>
            <div className="relative h-20 w-full">
              {t.thumbnail ? (
                <img src={t.thumbnail} alt={t.label} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center text-2xl">🎬</div>
              )}
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setPreviewId(t.id); }}
                className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"
              >
                <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] text-white">👁 Preview</span>
              </span>
            </div>
            <div className="p-1.5">
              <div className="text-[11px] font-semibold text-foreground truncate">{t.label}</div>
              <div className="text-[10px] text-muted-foreground">{t.shots.length} shot{t.shots.length > 1 ? "s" : ""}</div>
            </div>
          </button>
        ))}
        {visible.length === 0 && (
          <div className="col-span-full text-center text-xs text-muted-foreground py-8">No themes match that filter.</div>
        )}
        <div className="rounded-xl border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground px-2 py-6 text-center">
          More video themes coming soon
        </div>
      </div>

      {previewTheme && (
        <ThemePreviewModal
          thumbnail={previewTheme.thumbnail}
          label={previewTheme.label}
          detail={
            <div className="space-y-1">
              <div>{previewTheme.shots.length} shot{previewTheme.shots.length > 1 ? "s" : ""} · {previewTheme.shots.reduce((s, x) => s + x.duration, 0)}s total</div>
              {previewTheme.style_notes && <div>{previewTheme.style_notes}</div>}
              <ul className="mt-2 space-y-1">
                {previewTheme.shots.map((s, i) => (
                  <li key={i} className="rounded-lg border border-border/60 bg-background/40 px-2 py-1">
                    <span className="font-semibold text-foreground">{s.label || `Shot ${i + 1}`}</span> — {s.duration}s
                  </li>
                ))}
              </ul>
            </div>
          }
          onClose={() => setPreviewId(null)}
          onUse={() => { onSelect(previewTheme); setPreviewId(null); }}
        />
      )}
    </div>
  );
}
