import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/settings")({
  component: DeveloperSettings,
  head: () => ({ meta: [{ title: "Developer Settings — NivaAd" }] }),
});

function TeamLimitCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/team-limits")
      .then((r) => setValue(String(r.max_extra_users)))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load the team limit"); });
  }, []);

  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return;
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/team-limits", { method: "PUT", body: { max_extra_users: n } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-5 max-w-md">
      <div className="text-sm font-semibold text-foreground">Team size limit</div>
      <p className="mt-1 text-xs text-muted-foreground">How many non-admin members (editor/poster) a single company can add, on top of its admin(s). Applies to every company the same way. Pending invites count too, so this genuinely caps what's in the database, not just active accounts.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-slate-500 focus:outline-none" />
        <span className="text-xs text-muted-foreground">extra users per company</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function DataRetentionCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/retention")
      .then((r) => setValue(String(r.retention_months)))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load the retention period"); });
  }, []);

  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return;
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/retention", { method: "PUT", body: { retention_months: n } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-5 max-w-md">
      <div className="text-sm font-semibold text-foreground">Media retention period</div>
      <p className="mt-1 text-xs text-muted-foreground">How long a generated ad's image/video stays in storage before automatic cleanup. Only the media files are removed — the ad's caption, metadata, and analytics stay forever. Also caps how far out a post can be scheduled (measured from each ad's own creation date), so the two settings can never drift apart.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-slate-500 focus:outline-none" />
        <span className="text-xs text-muted-foreground">months</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function PostRetentionCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/post-retention")
      .then((r) => setValue(String(r.post_retention_months)))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load the post retention period"); });
  }, []);

  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return;
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/post-retention", { method: "PUT", body: { post_retention_months: n } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-5 max-w-md">
      <div className="text-sm font-semibold text-foreground">Post retention period</div>
      <p className="mt-1 text-xs text-muted-foreground">How long an ad's ENTIRE RECORD — caption, metadata, everything, not just its media — stays in the database before being permanently deleted. Separate from and longer than media retention above, since this is the real bound on long-term database growth. Default 2 years.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-slate-500 focus:outline-none" />
        <span className="text-xs text-muted-foreground">months</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function VideoRatiosCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [ratios, setRatios] = useState<string[] | null>(null);
  const [newRatio, setNewRatio] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const r = await devApi("/developer/video-ratios");
      setRatios(r.ratios);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load ratios");
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!newRatio.trim()) return;
    setBusy("add"); setErr("");
    try {
      const r = await devApi("/developer/video-ratios", { method: "POST", body: { ratio: newRatio.trim() } });
      setRatios(r.ratios);
      setNewRatio("");
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add that ratio — check the format (e.g. 21:9)");
    }
    setBusy(null);
  }

  async function remove(ratio: string) {
    setBusy(ratio); setErr("");
    try {
      const usage = await devApi(`/developer/video-ratios/${encodeURIComponent(ratio)}/usage`);
      const usedBy: string[] = [];
      if (usage.platforms.length > 0) usedBy.push(`${usage.platforms.length} platform(s): ${usage.platforms.join(", ")}`);
      if (usage.company_override_count > 0) usedBy.push(`${usage.company_override_count} company override(s)`);
      const warning = usedBy.length > 0
        ? `"${ratio}" is currently used by ${usedBy.join(" and ")}. Deleting it won't break anything — they'll silently fall back to a default ratio the next time they generate. Delete anyway?`
        : `Delete "${ratio}"? Nothing currently references it.`;
      if (!confirm(warning)) { setBusy(null); return; }
      const r = await devApi(`/developer/video-ratios/${encodeURIComponent(ratio)}`, { method: "DELETE" });
      setRatios(r.ratios);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not delete that ratio");
    }
    setBusy(null);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-5 max-w-md">
      <div className="text-sm font-semibold text-foreground">Video ratios</div>
      <p className="mt-1 text-xs text-muted-foreground">The aspect ratios available for platforms and company overrides to choose from. Just the ratio itself (e.g. "9:16") — actual pixel dimensions are computed per generation from each source video's own resolution, not a fixed size.</p>
      {!ratios ? (
        <div className="mt-3 text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ratios.map((r) => (
            <span key={r} className="flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] text-foreground">
              {r}
              <button onClick={() => remove(r)} disabled={busy === r} className="text-muted-foreground hover:text-destructive disabled:opacity-50">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input value={newRatio} onChange={(e) => setNewRatio(e.target.value)} placeholder="e.g. 21:9" className="w-24 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
        <button onClick={add} disabled={busy === "add" || !newRatio.trim()} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {busy === "add" ? "Adding…" : "+ Add"}
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function ThemeAiSettingsCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [settings, setSettings] = useState<any>(null);
  const [textModels, setTextModels] = useState<{ id: string; label: string }[]>([]);
  const [imageModels, setImageModels] = useState<{ id: string; label: string }[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newVisionLabel, setNewVisionLabel] = useState("");
  const [newVisionModel, setNewVisionModel] = useState("");
  const [addingVision, setAddingVision] = useState(false);

  async function load() {
    try {
      const [s, models] = await Promise.all([
        devApi("/developer/theme-ai/settings"),
        devApi("/developer/models"),
      ]);
      setSettings(s);
      setTextModels(models.text.map((m: any) => ({ id: m.id, label: m.label })));
      setImageModels(models.image.map((m: any) => ({ id: m.id, label: m.label })));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load theme AI settings");
    }
  }
  useEffect(() => { load(); }, []);

  async function save(patch: Partial<{ text_model_id: string; vision_model_id: string; image_transform_model_id: string }>) {
    setSaving(true); setErr(""); setSaved(false);
    try {
      const body = {
        text_model_id: settings.text_model_id, vision_model_id: settings.vision_model_id,
        image_transform_model_id: settings.image_transform_model_id, ...patch,
      };
      const r = await devApi("/developer/theme-ai/settings", { method: "PUT", body });
      setSettings(r);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  async function addVisionModel() {
    if (!newVisionLabel.trim() || !newVisionModel.trim()) return;
    setAddingVision(true); setErr("");
    try {
      const r = await devApi("/developer/theme-ai/vision-models", { method: "POST", body: { label: newVisionLabel.trim(), model: newVisionModel.trim() } });
      setSettings(r);
      setNewVisionLabel(""); setNewVisionModel("");
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add that vision model");
    }
    setAddingVision(false);
  }

  async function removeVisionModel(id: string) {
    setErr("");
    try {
      const r = await devApi(`/developer/theme-ai/vision-models/${id}`, { method: "DELETE" });
      setSettings(r);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not remove that vision model");
    }
  }

  if (!settings) return <div className="mb-6 max-w-2xl text-xs text-muted-foreground">Loading theme AI settings…</div>;

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-5 max-w-2xl">
      <div className="text-sm font-semibold text-foreground">Theme AI models</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Dedicated models used by Developer &gt; Themes &gt; Image Theme's AI assistance — writing draft prompts for
        new tags, and analyzing/tagging uploaded reference images. Separate from the video shot-review model.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-[11px] text-muted-foreground">Text model (writes tag prompts)</label>
          <select value={settings.text_model_id || ""} onChange={(e) => save({ text_model_id: e.target.value || undefined })}
            className="mt-1 w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none">
            <option value="">— none selected —</option>
            {textModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Image model (regenerates uploaded references)</label>
          <select value={settings.image_transform_model_id || ""} onChange={(e) => save({ image_transform_model_id: e.target.value || undefined })}
            className="mt-1 w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none">
            <option value="">— none selected —</option>
            {imageModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className="text-[11px] text-muted-foreground">Vision model (tags uploaded reference images)</label>
        <select value={settings.vision_model_id || ""} onChange={(e) => save({ vision_model_id: e.target.value || undefined })}
          className="mt-1 w-full max-w-xs rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none">
          {settings.vision_models.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        <div className="mt-2 space-y-1">
          {settings.vision_models.map((m: any) => (
            <div key={m.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <code className="rounded bg-slate-800/50 px-1.5 py-0.5">{m.model}</code>
              <span>{m.label}</span>
              <button onClick={() => removeVisionModel(m.id)} className="ml-auto text-muted-foreground hover:text-destructive">✕ remove</button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-2">
          <input value={newVisionLabel} onChange={(e) => setNewVisionLabel(e.target.value)} placeholder="Label, e.g. GPT-4o Vision"
            className="w-40 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <input value={newVisionModel} onChange={(e) => setNewVisionModel(e.target.value)} placeholder="OpenRouter slug, e.g. openai/gpt-4o"
            className="w-56 rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <button onClick={addVisionModel} disabled={addingVision} className="rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
            {addingVision ? "Adding…" : "+ Add"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function DeveloperSettings() {
  const allowed = useRequireDeveloperPermission("settings");
  if (!allowed) return null;

  return (
    <DeveloperShell title="Settings">
      <p className="mb-6 text-sm text-muted-foreground">
        Platform-wide settings that apply to every company — team size limits, media retention, and post retention. Per-platform video ratios moved to the Platforms tab, alongside everything else about each platform.
      </p>
      <TeamLimitCard />
      <DataRetentionCard />
      <PostRetentionCard />
      <VideoRatiosCard />
      <ThemeAiSettingsCard />
    </DeveloperShell>
  );
}
