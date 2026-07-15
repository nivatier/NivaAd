import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, Field, Input } from "@/components/app-shell";
import { api } from "@/lib/api";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/brand-kit")({
  component: BrandKit,
  head: () => ({ meta: [{ title: "Brand Kit — NivaAd" }] }),
});

const COLORS = ["#c9a84c", "#22d3ee", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#e5e7eb", "#a855f7"];
const PLACEMENTS: { key: string; label: string }[] = [
  { key: "top-left", label: "Top left" },
  { key: "top-right", label: "Top right" },
  { key: "bottom-left", label: "Bottom left" },
  { key: "bottom-right", label: "Bottom right" },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function BrandKit() {
  const allowed = useRequireCapability("view_brand_kit");

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [tagline, setTagline] = useState("");
  const [placement, setPlacement] = useState("bottom-right");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    try {
      const kit = await api("/brand-kit");
      setLogoUrl(kit.logo_url);
      setColor(kit.primary_color || COLORS[0]);
      setTagline(kit.tagline || "");
      setPlacement(kit.logo_placement || "bottom-right");
    } catch (e: any) {
      setErr(e.message || "Could not load brand kit");
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveColor(c: string) {
    setColor(c);
    try { await api("/brand-kit", { method: "PUT", body: { primary_color: c } }); } catch { /* non-fatal */ }
  }

  async function savePlacement(p: string) {
    setPlacement(p);
    try { await api("/brand-kit", { method: "PUT", body: { logo_placement: p } }); } catch { /* non-fatal */ }
  }

  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setSaving(true);
    try {
      const kit = await api("/brand-kit", { method: "PUT", body: { logo: dataUrl } });
      setLogoUrl(kit.logo_url);
    } catch (e: any) {
      setErr(e.message || "Could not upload logo");
    }
    setSaving(false);
  }

  async function removeLogo() {
    setSaving(true);
    try {
      const kit = await api("/brand-kit", { method: "PUT", body: { logo: "" } });
      setLogoUrl(kit.logo_url);
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  async function saveTagline() {
    setSaving(true); setSavedMsg("");
    try {
      await api("/brand-kit", { method: "PUT", body: { tagline } });
      setSavedMsg("✓ Saved");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e: any) {
      setSavedMsg(e.message || "Could not save");
    }
    setSaving(false);
  }

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  if (loading) {
    return (
      <AppShell eyebrow="Setup" title="Brand Kit">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell eyebrow="Setup" title="Brand Kit">
      <Panel className="max-w-3xl">
        {err && <div className="mb-4 text-xs text-destructive">{err}</div>}

        <div className="text-sm font-medium text-foreground">Logo</div>
        <div className="mt-3 flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="h-20 w-20 rounded-2xl object-cover border border-border" />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gold-gradient font-display text-3xl font-bold text-background">N</div>
          )}
          <div className="flex flex-col gap-2">
            <label className="cursor-pointer rounded-full bg-gold-gradient px-4 py-2 text-center text-sm font-semibold text-background shadow-[var(--shadow-gold)]">
              ⬆ Upload logo
              <input type="file" accept="image/*" className="hidden" onChange={handleLogo} disabled={saving} />
            </label>
            {logoUrl && (
              <button onClick={removeLogo} disabled={saving} className="rounded-full border border-destructive/40 px-4 py-1.5 text-xs text-destructive disabled:opacity-50">Remove</button>
            )}
          </div>
        </div>

        {logoUrl && (
          <div className="mt-6">
            <div className="text-sm font-medium text-foreground">Logo placement on generated ads</div>
            <p className="mt-1 text-xs text-muted-foreground">Where your logo appears on the ad image when you tick "Include logo" while creating an ad.</p>
            <div className="mt-3 grid w-56 grid-cols-2 gap-2 rounded-xl border border-border bg-background/40 p-3">
              {PLACEMENTS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => savePlacement(p.key)}
                  className={`rounded-lg border px-3 py-4 text-[11px] font-medium transition ${placement === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <div className="text-sm font-medium text-foreground">Primary brand color <span className="text-xs text-muted-foreground">(buttons & accents)</span></div>
          <div className="mt-3 flex flex-wrap gap-3">
            {COLORS.map((c) => (
              <button key={c} onClick={() => saveColor(c)} style={{ background: c }}
                className={`h-10 w-10 rounded-lg ring-offset-2 ring-offset-background transition ${color === c ? "ring-2 ring-primary" : "ring-1 ring-border"}`} />
            ))}
            <input type="color" value={color} onChange={(e) => saveColor(e.target.value)} className="h-10 w-10 rounded-lg border border-border bg-transparent cursor-pointer" />
          </div>
        </div>

        <div className="mt-8 max-w-md">
          <Field label="Tagline" hint="Short and memorable — woven into copy and shown on the ad image.">
            <Input placeholder='e.g. "Hydration, reinvented."' value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </Field>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={saveTagline} disabled={saving} className="rounded-full border border-primary/50 px-4 py-1.5 text-xs text-primary disabled:opacity-50">
              {saving ? "Saving…" : "Save tagline"}
            </button>
            {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
          These items appear as optional tick-boxes in every new ad — the logo is genuinely composited onto the generated image, not just shown in the preview.
        </div>
      </Panel>
    </AppShell>
  );
}
