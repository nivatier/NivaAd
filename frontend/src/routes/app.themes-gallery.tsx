import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { api, type ProductOut } from "@/lib/api";
import { ImageThemeGrid, VideoThemeGrid, mapImageTheme, type ImageTheme, type VideoTheme } from "@/components/theme-gallery-grid";
import { ThemeLinkProductModal } from "@/components/theme-link-product-modal";

export const Route = createFileRoute("/app/themes-gallery")({
  component: ThemesGallery,
  head: () => ({ meta: [{ title: "Themes Gallery — NivaAd" }] }),
});

/** Handoff payload to Create Ad — read once on mount there (see
 * app.index.tsx's "arriving from Themes Gallery" effect), same
 * sessionStorage-prefill pattern the Products page already uses for
 * "New ad" (nivaad_prefill_product), just carrying a theme selection
 * alongside an optional product instead of only a product. */
type ThemeGalleryPrefill = {
  themeKind: "image" | "video";
  themeId: string;
  product: ProductOut | null;
};

function ThemesGallery() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"image" | "video">("image");
  const [imageThemes, setImageThemes] = useState<ImageTheme[]>([]);
  const [videoThemes, setVideoThemes] = useState<VideoTheme[]>([]);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<{ kind: "image" | "video"; id: string; label: string } | null>(null);

  useEffect(() => {
    api("/ads/themes").then((r) => setImageThemes((r.themes?.image_themes || []).map(mapImageTheme))).catch((e) => setErr(e.message || "Could not load image themes"));
    api("/ads/video-themes").then(setVideoThemes).catch((e) => setErr(e.message || "Could not load video themes"));
  }, []);

  function continueToCreateAd(product: ProductOut | null) {
    if (!picked) return;
    const payload: ThemeGalleryPrefill = { themeKind: picked.kind, themeId: picked.id, product };
    sessionStorage.setItem("nivaad_prefill_theme", JSON.stringify(payload));
    navigate({ to: "/app" });
  }

  return (
    <AppShell eyebrow="Library" title="Themes Gallery">
      <p className="mb-5 text-xs text-muted-foreground max-w-2xl">Pick a theme to start a new ad — optionally link a saved product first.</p>
      <div className="flex gap-2 mb-5">
        {([["image", "Image Theme Gallery"], ["video", "Video Theme Gallery"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${tab === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
            {l}
          </button>
        ))}
      </div>

      {err && <div className="mb-4 text-xs text-destructive">{err}</div>}

      {tab === "image" ? (
        <ImageThemeGrid themes={imageThemes} selectedId={null} onSelect={(t) => setPicked({ kind: "image", id: t.id, label: t.label })} />
      ) : (
        <VideoThemeGrid themes={videoThemes} selectedId={null} onSelect={(t) => setPicked({ kind: "video", id: t.id, label: t.label })} />
      )}

      {picked && (
        <ThemeLinkProductModal
          themeName={picked.label}
          onCancel={() => setPicked(null)}
          onContinue={continueToCreateAd}
        />
      )}
    </AppShell>
  );
}
