import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/settings")({
  component: DeveloperSettings,
  head: () => ({ meta: [{ title: "Developer Settings — NivaSpark" }] }),
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
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="text-sm font-semibold text-foreground">Team size limit</div>
      <p className="mt-1 text-xs text-muted-foreground">How many non-admin members (editor/poster) a single company can add, on top of its admin(s). Applies to every company the same way. Pending invites count too, so this genuinely caps what's in the database, not just active accounts.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
        <span className="text-xs text-muted-foreground">extra users per company</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
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
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="text-sm font-semibold text-foreground">Media retention period</div>
      <p className="mt-1 text-xs text-muted-foreground">How long a generated ad's image/video stays in storage before automatic cleanup. Only the media files are removed — the ad's caption, metadata, and analytics stay forever. Also caps how far out a post can be scheduled (measured from each ad's own creation date), so the two settings can never drift apart.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
        <span className="text-xs text-muted-foreground">months</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
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
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="text-sm font-semibold text-foreground">Post retention period</div>
      <p className="mt-1 text-xs text-muted-foreground">How long an ad's ENTIRE RECORD — caption, metadata, everything, not just its media — stays in the database before being permanently deleted. Separate from and longer than media retention above, since this is the real bound on long-term database growth. Default 2 years.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
        <span className="text-xs text-muted-foreground">months</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
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
  const [ratios, setRatios] = useState<{ ratio: string; platforms: string[] }[] | null>(null);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [newRatio, setNewRatio] = useState("");
  const [newPlatforms, setNewPlatforms] = useState<string[]>([]);
  const [editingRatio, setEditingRatio] = useState<string | null>(null);
  const [editPlatforms, setEditPlatforms] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [r, p] = await Promise.all([
        devApi("/developer/video-ratios"),
        devApi("/developer/platforms"),
      ]);
      setRatios(r.ratios);
      setPlatforms(p.map((pl: any) => pl.id));
      setNewPlatforms(p.map((pl: any) => pl.id)); // default all selected
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load");
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!newRatio.trim()) return;
    setBusy("add"); setErr("");
    try {
      const r = await devApi("/developer/video-ratios", {
        method: "POST",
        body: { ratio: newRatio.trim(), platforms: newPlatforms },
      });
      setRatios(r.ratios);
      setNewRatio("");
      setNewPlatforms(platforms);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add that ratio — check the format (e.g. 21:9)");
    }
    setBusy(null);
  }

  async function saveEdit(ratio: string) {
    setBusy(`edit-${ratio}`); setErr("");
    try {
      const r = await devApi(`/developer/video-ratios/${encodeURIComponent(ratio)}/platforms`, {
        method: "PUT",
        body: { platforms: editPlatforms },
      });
      setRatios(r.ratios);
      setEditingRatio(null);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
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
        ? `"${ratio}" is currently used by ${usedBy.join(" and ")}. Deleting it won't break anything — they'll silently fall back to a default ratio. Delete anyway?`
        : `Delete "${ratio}"? Nothing currently references it.`;
      if (!confirm(warning)) { setBusy(null); return; }
      const r = await devApi(`/developer/video-ratios/${encodeURIComponent(ratio)}`, { method: "DELETE" });
      setRatios(r.ratios);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not delete that ratio");
    }
    setBusy(null);
  }

  function togglePlatform(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((p) => p !== id) : [...list, id]);
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="text-sm font-semibold text-foreground">Aspect ratios</div>
      <p className="mt-1 text-xs text-muted-foreground">
        The aspect ratios available for platforms and company overrides. Each ratio can be restricted to specific platforms — click Edit to update. Actual pixel dimensions are computed per generation from each source media's own resolution.
      </p>

      {!ratios ? (
        <div className="mt-3 text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="mt-3 space-y-2">
          {ratios.map((r) => (
            <div key={r.ratio} className="rounded-lg border border-border bg-background/40 px-3 py-2">
              {editingRatio === r.ratio ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground">{r.ratio}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {platforms.map((pid) => (
                      <label key={pid} className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary">
                        <input
                          type="checkbox"
                          checked={editPlatforms.includes(pid)}
                          onChange={() => togglePlatform(editPlatforms, setEditPlatforms, pid)}
                          className="h-2.5 w-2.5 accent-primary"
                        />
                        {pid}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(r.ratio)}
                      disabled={busy === `edit-${r.ratio}`}
                      className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background disabled:opacity-50"
                    >
                      {busy === `edit-${r.ratio}` ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingRatio(null)}
                      className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-foreground">{r.ratio}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.platforms.length === platforms.length ? (
                        <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">All platforms</span>
                      ) : r.platforms.length === 0 ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">No platforms</span>
                      ) : (
                        r.platforms.map((pid) => (
                          <span key={pid} className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">{pid}</span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => { setEditingRatio(r.ratio); setEditPlatforms([...r.platforms]); }}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(r.ratio)}
                      disabled={busy === r.ratio}
                      className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new ratio */}
      <div className="mt-4 space-y-2">
        <div className="text-[11px] font-semibold text-muted-foreground">Add aspect ratio</div>
        <div className="flex gap-2">
          <input
            value={newRatio}
            onChange={(e) => setNewRatio(e.target.value)}
            placeholder="e.g. 21:9"
            className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
          />
          <button
            onClick={add}
            disabled={busy === "add" || !newRatio.trim()}
            className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            {busy === "add" ? "Adding…" : "+ Add"}
          </button>
        </div>
        {platforms.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] text-muted-foreground">Applies to platforms:</div>
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((pid) => (
                <label key={pid} className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary">
                  <input
                    type="checkbox"
                    checked={newPlatforms.includes(pid)}
                    onChange={() => togglePlatform(newPlatforms, setNewPlatforms, pid)}
                    className="h-2.5 w-2.5 accent-primary"
                  />
                  {pid}
                </label>
              ))}
            </div>
          </div>
        )}
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
    <div className="mb-6 rounded-xl border border-border bg-card/60 p-5 max-w-2xl">
      <div className="text-sm font-semibold text-foreground">Theme AI models</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Dedicated models used by Developer &gt; Themes &gt; Image Theme's AI assistance — writing draft prompts for
        new tags, and analyzing/tagging uploaded reference images. Separate from the video shot-review model.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-[11px] text-muted-foreground">Text model (writes tag prompts)</label>
          <select value={settings.text_model_id || ""} onChange={(e) => save({ text_model_id: e.target.value || undefined })}
            className="mt-1 w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
            <option value="">— none selected —</option>
            {textModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Image model (regenerates uploaded references)</label>
          <select value={settings.image_transform_model_id || ""} onChange={(e) => save({ image_transform_model_id: e.target.value || undefined })}
            className="mt-1 w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
            <option value="">— none selected —</option>
            {imageModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className="text-[11px] text-muted-foreground">Vision model (tags uploaded reference images)</label>
        <select value={settings.vision_model_id || ""} onChange={(e) => save({ vision_model_id: e.target.value || undefined })}
          className="mt-1 w-full max-w-xs rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
          {settings.vision_models.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        <div className="mt-2 space-y-1">
          {settings.vision_models.map((m: any) => (
            <div key={m.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5">{m.model}</code>
              <span>{m.label}</span>
              <button onClick={() => removeVisionModel(m.id)} className="ml-auto text-muted-foreground hover:text-destructive">✕ remove</button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-2">
          <input value={newVisionLabel} onChange={(e) => setNewVisionLabel(e.target.value)} placeholder="Label, e.g. GPT-4o Vision"
            className="w-40 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <input value={newVisionModel} onChange={(e) => setNewVisionModel(e.target.value)} placeholder="OpenRouter slug, e.g. openai/gpt-4o"
            className="w-56 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <button onClick={addVisionModel} disabled={addingVision} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
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

function LaunchControlCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [open, setOpen] = useState<boolean | null>(null);
  const [mockPosting, setMockPosting] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/launch-control")
      .then((r) => { setOpen(r.registration_open); setMockPosting(r.mock_posting); })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load"); });
  }, []);

  async function toggle(field: "registration_open" | "mock_posting", currentValue: boolean | null) {
    if (currentValue === null) return;
    setSaving(true); setErr("");
    try {
      const r = await devApi("/developer/launch-control", { method: "PUT", body: { [field]: !currentValue } });
      setOpen(r.registration_open);
      setMockPosting(r.mock_posting);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not save"); }
    setSaving(false);
  }

  return (
    <div className="space-y-3 sm:col-span-2">
      {/* Registration toggle */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-foreground">🚀 Registration</div>
              {open === true  && <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-400">OPEN</span>}
              {open === false && <span className="rounded-full bg-destructive/15 border border-destructive/40 px-2 py-0.5 text-[10px] font-bold text-destructive">DISABLED</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {open ? "Anyone can register a new account." : "Registration is disabled — no one can sign up via the public form. Use the form below to add users directly."}
            </p>
          </div>
          <button onClick={() => toggle("registration_open", open)} disabled={saving || open === null}
            className={`relative shrink-0 h-7 w-12 rounded-full border-2 transition-colors focus:outline-none disabled:opacity-50 ${open ? "border-emerald-500 bg-emerald-500" : "border-border bg-muted/40"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${open ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {/* Mock Posting toggle */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-foreground">🎭 Mock Posting</div>
              {mockPosting === true  && <span className="rounded-full bg-amber-500/15 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-400">SIMULATED</span>}
              {mockPosting === false && <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-400">LIVE</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {mockPosting
                ? "Posts are simulated — nothing is actually published to any platform. Safe for testing."
                : "Posts are LIVE — ads will actually be published to connected platforms when posted."}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Overrides the <code className="rounded bg-muted px-1 py-0.5">MOCK_POSTING</code> environment variable. Takes effect immediately — no restart needed.
            </p>
          </div>
          <button onClick={() => toggle("mock_posting", mockPosting)} disabled={saving || mockPosting === null}
            className={`relative shrink-0 h-7 w-12 rounded-full border-2 transition-colors focus:outline-none disabled:opacity-50 ${mockPosting ? "border-amber-500 bg-amber-500" : "border-emerald-500 bg-emerald-500"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${mockPosting ? "translate-x-0.5" : "translate-x-5"}`} />
          </button>
        </div>
      </div>

      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}

function PlatformConfigCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [creditValue, setCreditValue] = useState("");
  const [markupMultiplier, setMarkupMultiplier] = useState("");
  const [carouselMax, setCarouselMax] = useState("");
  const [priceIds, setPriceIds] = useState("");
  const [priceTopup, setPriceTopup] = useState("");
  const [openrouterUrl, setOpenrouterUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/platform-config")
      .then((r) => {
        setCreditValue(String(r.credit_value_usd));
        setMarkupMultiplier(String(r.markup_multiplier ?? 2.5));
        setCarouselMax(String(r.carousel_max_images));
        try {
          const parsed = typeof r.stripe_price_ids === "string" ? JSON.parse(r.stripe_price_ids) : r.stripe_price_ids;
          setPriceIds(JSON.stringify(parsed, null, 2));
        } catch { setPriceIds(r.stripe_price_ids ?? "{}"); }
        setPriceTopup(r.stripe_price_topup ?? "");
        setOpenrouterUrl(r.openrouter_base_url ?? "");
      })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load config"); });
  }, []);

  async function save() {
    const credit = parseFloat(creditValue);
    const markup = parseFloat(markupMultiplier);
    const carousel = parseInt(carouselMax);
    if (isNaN(credit) || credit <= 0) { setErr("Credit value must be a positive number"); return; }
    if (isNaN(markup) || markup < 1) { setErr("Markup multiplier must be at least 1.0"); return; }
    if (isNaN(carousel) || carousel < 2 || carousel > 20) { setErr("Carousel max must be 2–20"); return; }
    try { JSON.parse(priceIds); } catch { setErr("Stripe Price IDs is not valid JSON"); return; }
    if (priceTopup && !priceTopup.startsWith("price_")) { setErr("Stripe Topup Price ID must start with price_"); return; }

    setSaving(true); setErr(""); setSaved(false);
    try {
      const r = await devApi("/developer/platform-config", {
        method: "PUT",
        body: {
          credit_value_usd: credit,
          markup_multiplier: markup,
          carousel_max_images: carousel,
          stripe_price_ids: priceIds,
          stripe_price_topup: priceTopup,
          openrouter_base_url: openrouterUrl,
        },
      });
      setCreditValue(String(r.credit_value_usd));
      setMarkupMultiplier(String(r.markup_multiplier ?? 2.5));
      setCarouselMax(String(r.carousel_max_images));
      try {
        const parsed = typeof r.stripe_price_ids === "string" ? JSON.parse(r.stripe_price_ids) : r.stripe_price_ids;
        setPriceIds(JSON.stringify(parsed, null, 2));
      } catch { setPriceIds(r.stripe_price_ids ?? "{}"); }
      setPriceTopup(r.stripe_price_topup ?? "");
      setOpenrouterUrl(r.openrouter_base_url ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 sm:col-span-2">
      <div className="text-sm font-semibold text-foreground">Platform config</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Business values and API endpoints editable without a redeploy. Overrides your <code className="rounded bg-muted px-1 py-0.5 text-[10px]">.env</code> defaults at runtime — changes take effect immediately.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Credit value */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Credit value (USD per credit)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input type="number" min="0.01" step="0.01" value={creditValue} onChange={(e) => setCreditValue(e.target.value)}
              className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Must match your Stripe top-up price per unit. Currently $0.10 = 1 credit.</p>
        </div>

        {/* Markup multiplier */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Markup multiplier</label>
          <div className="flex items-center gap-2">
            <input type="number" min="1" max="10" step="0.1" value={markupMultiplier} onChange={(e) => setMarkupMultiplier(e.target.value)}
              className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
            <span className="text-xs text-muted-foreground">×</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Applied to raw OpenRouter cost before converting to credits. Drop for Black Friday etc. Min 1.0.</p>
        </div>

        {/* Carousel max */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Carousel max images</label>
          <div className="flex items-center gap-2">
            <input type="number" min="2" max="20" step="1" value={carouselMax} onChange={(e) => setCarouselMax(e.target.value)}
              className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
            <span className="text-xs text-muted-foreground">images (2–20)</span>
          </div>
        </div>

        {/* Stripe topup price */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Stripe top-up price ID</label>
          <input value={priceTopup} onChange={(e) => setPriceTopup(e.target.value)} placeholder="price_xxx"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-ring focus:outline-none" />
          <p className="mt-1 text-[10px] text-muted-foreground">Per-credit Stripe price for credit top-ups</p>
        </div>
      </div>

      {/* Stripe price IDs */}
      <div className="mt-4">
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
          Stripe subscription price IDs
          <span className="ml-2 font-normal opacity-70">JSON object mapping tier → term_months → price_id</span>
        </label>
        <textarea rows={5} value={priceIds} onChange={(e) => setPriceIds(e.target.value)} spellCheck={false}
          className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-xs font-mono text-foreground focus:border-ring focus:outline-none resize-y"
          placeholder={'{\n  "starter": { "1": "price_xxx", "3": "price_yyy" },\n  "growth":  { "1": "price_xxx" },\n  "pro":     { "1": "price_xxx" }\n}'} />
      </div>

      {/* API base URLs */}
      <div className="mt-4 border-t border-border/50 pt-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">API base URLs</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">OpenRouter base URL</label>
            <input value={openrouterUrl} onChange={(e) => setOpenrouterUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-ring focus:outline-none" />
            <p className="mt-1 text-[10px] text-muted-foreground">Used for all text, image and video generation</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Anthropic base URL</label>
            <input value={anthropicUrl} onChange={(e) => setAnthropicUrl(e.target.value)}
              placeholder="https://api.anthropic.com/v1"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-ring focus:outline-none" />
            <p className="mt-1 text-[10px] text-muted-foreground">Used for Quick Spark draft generation (frontend)</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">LinkedIn API URL</label>
            <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://api.linkedin.com/rest/posts"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-ring focus:outline-none" />
            <p className="mt-1 text-[10px] text-muted-foreground">LinkedIn post endpoint — update if API version changes</p>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-amber-400/80">⚠ URL changes take effect immediately in the API process. Workers need a restart to pick up URL changes.</p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button disabled={saving} onClick={save}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {saving ? "Saving…" : "Save all"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved — API updated immediately</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

// ── Billing settings (split from PlatformConfigCard) ─────────────────────────
function BillingSettingsTab() {
  const handleAuthError = useDevAuthErrorHandler();
  const [creditValue, setCreditValue] = useState("");
  const [markupMultiplier, setMarkupMultiplier] = useState("");
  const [carouselMax, setCarouselMax] = useState("");
  const [priceIds, setPriceIds] = useState("");
  const [priceTopup, setPriceTopup] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/platform-config")
      .then((r) => {
        setCreditValue(String(r.credit_value_usd));
        setMarkupMultiplier(String(r.markup_multiplier ?? 2.5));
        setCarouselMax(String(r.carousel_max_images));
        try {
          const parsed = typeof r.stripe_price_ids === "string" ? JSON.parse(r.stripe_price_ids) : r.stripe_price_ids;
          setPriceIds(JSON.stringify(parsed, null, 2));
        } catch { setPriceIds(r.stripe_price_ids ?? "{}"); }
        setPriceTopup(r.stripe_price_topup ?? "");
      })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load"); });
  }, []);

  async function save() {
    const credit = parseFloat(creditValue);
    const markup = parseFloat(markupMultiplier);
    const carousel = parseInt(carouselMax);
    if (isNaN(credit) || credit <= 0) { setErr("Credit value must be a positive number"); return; }
    if (isNaN(markup) || markup < 1) { setErr("Markup multiplier must be at least 1.0"); return; }
    if (isNaN(carousel) || carousel < 2 || carousel > 20) { setErr("Carousel max must be 2–20"); return; }
    try { JSON.parse(priceIds); } catch { setErr("Stripe Price IDs is not valid JSON"); return; }
    if (priceTopup && !priceTopup.startsWith("price_")) { setErr("Topup price ID must start with price_"); return; }
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/platform-config", {
        method: "PUT",
        body: { credit_value_usd: credit, markup_multiplier: markup, carousel_max_images: carousel, stripe_price_ids: priceIds, stripe_price_topup: priceTopup },
      });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not save"); }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="text-sm font-semibold text-foreground mb-4">Credits</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Credit value (USD per credit)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <input type="number" min="0.01" step="0.01" value={creditValue} onChange={(e) => setCreditValue(e.target.value)}
                className="w-28 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Must match your Stripe per-credit price. Currently $0.10 = 1 credit.</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Markup multiplier</label>
            <div className="flex items-center gap-2">
              <input type="number" min="1" max="10" step="0.1" value={markupMultiplier} onChange={(e) => setMarkupMultiplier(e.target.value)}
                className="w-28 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
              <span className="text-xs text-muted-foreground">×</span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Applied to raw OpenRouter cost before converting to credits. Drop for promotions (e.g. Black Friday). Min 1.0.</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Carousel max images</label>
            <div className="flex items-center gap-2">
              <input type="number" min="2" max="20" step="1" value={carouselMax} onChange={(e) => setCarouselMax(e.target.value)}
                className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
              <span className="text-xs text-muted-foreground">images (2–20)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="text-sm font-semibold text-foreground mb-1">Stripe</div>
        <p className="text-xs text-muted-foreground mb-4">Changes take effect immediately — no restart needed.</p>
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Top-up price ID</label>
            <input value={priceTopup} onChange={(e) => setPriceTopup(e.target.value)} placeholder="price_xxx"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-ring focus:outline-none" />
            <p className="mt-1 text-[10px] text-muted-foreground">Per-credit Stripe price used for top-up purchases</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
              Subscription price IDs
              <span className="ml-2 font-normal opacity-60">JSON: {"{"}"tier": {"{"}"months": "price_id"{"}"}{"}"}</span>
            </label>
            <textarea rows={6} value={priceIds} onChange={(e) => setPriceIds(e.target.value)} spellCheck={false}
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-xs font-mono text-foreground focus:border-ring focus:outline-none resize-y"
              placeholder={'{\n  "starter": { "1": "price_xxx", "3": "price_yyy" },\n  "growth":  { "1": "price_xxx" },\n  "pro":     { "1": "price_xxx" }\n}'} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {saving ? "Saving…" : "Save billing settings"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved — takes effect immediately</span>}
      </div>
      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}

// ── API Endpoints tab ─────────────────────────────────────────────────────────
function ApiEndpointsTab() {
  const handleAuthError = useDevAuthErrorHandler();
  const [openrouterUrl, setOpenrouterUrl] = useState("");
  const [heroVimeoId, setHeroVimeoId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/platform-config")
      .then((r) => {
        setOpenrouterUrl(r.openrouter_base_url ?? "");
        setHeroVimeoId(r.hero_vimeo_id ?? "");
      })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load"); });
  }, []);

  async function save() {
    if (openrouterUrl && !openrouterUrl.startsWith("http")) { setErr("OpenRouter URL must start with http"); return; }
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/platform-config", {
        method: "PUT",
        body: { openrouter_base_url: openrouterUrl, hero_vimeo_id: heroVimeoId },
      });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not save"); }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      {/* AI generation */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="text-sm font-semibold text-foreground mb-1">AI generation</div>
        <p className="text-xs text-muted-foreground mb-4">
          OpenRouter handles all AI generation — text ads, image generation, video generation, model catalog, and credit balance checks. Change this base URL to point at a proxy or alternate endpoint without touching any other config.
        </p>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">OpenRouter base URL</label>
          <input value={openrouterUrl} onChange={(e) => setOpenrouterUrl(e.target.value)}
            placeholder="https://openrouter.ai/api/v1"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-ring focus:outline-none" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["→ /chat/completions (text ads, Agent Niva hints)", "→ /images (image generation)", "→ /videos (video generation)", "→ /credits (balance check)", "→ /images/models, /videos/models (model catalog)"].map((u) => (
              <span key={u} className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">{u}</span>
            ))}
          </div>
        </div>
        {/* Hero / launch video */}
        <div className="mt-4">
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Hero / launch video Vimeo ID</label>
          <input value={heroVimeoId} onChange={(e) => setHeroVimeoId(e.target.value)}
            placeholder="e.g. 1213550777 or https://vimeo.com/1213550777"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-ring focus:outline-none" />
          <div className="mt-1 text-[10px] text-muted-foreground">Paste a Vimeo ID or full URL — shown as the product demo video on the public home page.</div>
        </div>
      </div>

      {/* Social platform APIs — managed in Platforms tab */}
      <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">📡 Social platform API URLs</div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Each platform's posting API URL is configured directly on that platform's entry in the <strong className="text-foreground">Platforms</strong> tab — alongside its OAuth credentials and video ratio. This keeps everything platform-specific in one place.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {saving ? "Saving…" : "Save API endpoints"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved — API updated immediately</span>}
      </div>
      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────
function UsersTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TeamLimitCard />
    </div>
  );
}


// ── Retention tab ─────────────────────────────────────────────────────────────
function LogRetentionCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [days, setDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/logs/retention")
      .then((r) => setDays(String(r.log_retention_days)))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load"); });
  }, []);

  async function save() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) { setErr("Must be 1–365 days"); return; }
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/logs/retention", { method: "PUT", body: { log_retention_days: n } });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not save"); }
    setSaving(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="text-sm font-semibold text-foreground">System log retention</div>
      <p className="mt-1 text-xs text-muted-foreground">How many days API, worker, and beat logs are kept in the database before automatic daily cleanup. Logs older than this are deleted at 2 AM UTC.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} max={365} step={1} value={days} onChange={(e) => setDays(e.target.value)}
          className="w-20 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
        <span className="text-xs text-muted-foreground">days (1–365)</span>
        <button disabled={saving} onClick={save} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function RetentionTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <DataRetentionCard />
      <PostRetentionCard />
      <LogRetentionCard />
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
// ── Railway tab ───────────────────────────────────────────────────────────────
type RailwayService = {
  id: string;
  name: string;
  region: string | null;
  status: string;
  deployed_at: string | null;
};

type RailwayUsage = {
  estimated_monthly_usd: number | null;
  current_period_usd: number | null;
  credit_balance_usd: number | null;
  project_name: string | null;
  services: RailwayService[];
};

const STATUS_COLOR: Record<string, string> = {
  SUCCESS:    "text-emerald-400",
  DEPLOYING:  "text-amber-400",
  FAILED:     "text-destructive",
  CRASHED:    "text-destructive",
  REMOVED:    "text-muted-foreground",
  UNKNOWN:    "text-muted-foreground",
};

function RailwayTab() {
  const handleAuthError = useDevAuthErrorHandler();
  const [data, setData] = useState<RailwayUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      const r = await devApi("/developer/railway-usage");
      setData(r);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load Railway data");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const fmt = (v: number | null | undefined) =>
    v == null ? "—" : `$${Number(v).toFixed(2)}`;

  if (loading) return <div className="text-xs text-muted-foreground">Loading Railway data…</div>;
  if (err) return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
      {err}
      {err.includes("RAILWAY_API_TOKEN") && (
        <div className="mt-2 text-muted-foreground">
          Go to <strong className="text-foreground">Railway → api service → Variables</strong> and add:<br />
          <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-[10px]">RAILWAY_API_TOKEN=your_token_here</code>
          <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-[10px]">RAILWAY_PROJECT_ID=your_project_id_here</code>
          Get your token at <a href="https://railway.com/account/tokens" target="_blank" rel="noreferrer" className="underline">railway.com/account/tokens</a>.
        </div>
      )}
    </div>
  );
  if (!data) return null;

  const hobbyIncluded = 5.00;
  const currentUsage = data.current_period_usd ?? 0;
  const pct = Math.min(100, (currentUsage / hobbyIncluded) * 100);
  const overLimit = currentUsage > hobbyIncluded;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Usage overview */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold text-foreground">
            {data.project_name ?? "Railway project"} — billing
          </div>
          <button onClick={load} className="text-[10px] text-muted-foreground hover:text-foreground">↻ Refresh</button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Hobby plan includes $5/month. Usage beyond that is billed at resource rates.</p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">This period</div>
            <div className={`text-lg font-bold ${overLimit ? "text-destructive" : "text-foreground"}`}>{fmt(data.current_period_usd)}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">Est. monthly</div>
            <div className="text-lg font-bold text-foreground">{fmt(data.estimated_monthly_usd)}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">Credit balance</div>
            <div className={`text-lg font-bold ${(data.credit_balance_usd ?? 0) < 1 ? "text-destructive" : "text-emerald-400"}`}>{fmt(data.credit_balance_usd)}</div>
          </div>
        </div>

        {/* Progress bar vs $5 included */}
        <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
          <span>Usage vs $5 included credit</span>
          <span className={overLimit ? "text-destructive font-semibold" : ""}>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${overLimit ? "bg-destructive" : pct > 80 ? "bg-amber-400" : "bg-emerald-500"}`}
            style={{ width: `${pct}%` }} />
        </div>
        {overLimit && (
          <div className="mt-2 text-[10px] text-destructive font-medium">
            ⚠ You've exceeded the $5 included credit — extra usage is being billed.
          </div>
        )}
      </div>

      {/* Services */}
      {data.services.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-5">
          <div className="text-sm font-semibold text-foreground mb-3">Services</div>
          <div className="space-y-2">
            {data.services.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold ${STATUS_COLOR[s.status] ?? "text-muted-foreground"}`}>●</span>
                  <span className="text-xs font-medium text-foreground">{s.name}</span>
                  {s.region && <span className="text-[10px] text-muted-foreground">{s.region}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-medium ${STATUS_COLOR[s.status] ?? "text-muted-foreground"}`}>{s.status}</span>
                  {s.deployed_at && (
                    <span className="text-[10px] text-muted-foreground">{new Date(s.deployed_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Full billing details at <a href="https://railway.com/workspace/billing" target="_blank" rel="noreferrer" className="underline">railway.com/workspace/billing</a>
      </p>
    </div>
  );
}


function LegalLinksCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [terms, setTerms] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [acceptableUse, setAcceptableUse] = useState("");
  const [cookies, setCookies] = useState("");
  const [active, setActive] = useState<"terms"|"privacy"|"acceptable_use"|"cookies">("terms");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/legal-content")
      .then((r: any) => {
        setTerms(r.terms || "");
        setPrivacy(r.privacy || "");
        setAcceptableUse(r.acceptable_use || "");
        setCookies(r.cookies || "");
      })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load legal content"); });
  }, []);

  async function save() {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/legal-content", {
        method: "PUT",
        body: { terms, privacy, acceptable_use: acceptableUse, cookies },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  const tabs = [
    { key: "terms" as const,           label: "Terms of Service",      value: terms,         set: setTerms },
    { key: "privacy" as const,         label: "Privacy Policy",         value: privacy,       set: setPrivacy },
    { key: "acceptable_use" as const,  label: "Acceptable Use",         value: acceptableUse, set: setAcceptableUse },
    { key: "cookies" as const,         label: "Cookie Notice",          value: cookies,       set: setCookies },
  ];

  const current = tabs.find(t => t.key === active)!;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 flex flex-col gap-4">
      <div>
        <div className="text-sm font-semibold text-foreground">Legal content</div>
        <p className="mt-1 text-xs text-muted-foreground">
          This text appears in popup modals on the landing page when users click Terms, Privacy, Acceptable Use or the cookie notice.
          Plain text or basic markdown supported.
        </p>
      </div>
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActive(t.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${active === t.key
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {/* Textarea */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{current.label} content</label>
        <textarea
          value={current.value}
          onChange={(e) => current.set(e.target.value)}
          rows={14}
          placeholder={`Enter ${current.label} content here…`}
          className="w-full rounded-lg border border-border bg-input/40 px-3 py-2.5 text-sm text-foreground focus:border-ring focus:outline-none resize-y font-mono leading-relaxed"
        />
        <p className="text-[11px] text-muted-foreground">
          {current.value.length} characters · use blank lines to separate paragraphs
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          disabled={saving}
          onClick={save}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save all"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}



// ── RSS Feeds Catalogue tab ────────────────────────────────────────────────────

// ── RSS Feeds Catalogue tab ─────────────────────────────────────────────────

type DevRssFeed = {
  id: string; name: string; url: string; category: string; description: string;
  enabled: boolean; created_at: string;
  last_checked_at: string | null; last_status: string | null;
  last_error: string | null; last_article_count: number | null;
};

const RSS_CATEGORIES = [
  "Aerospace & Defense","Agriculture & AgriTech","Artificial Intelligence",
  "Automotive & Mobility","Construction & Architecture","Cybersecurity",
  "Education & EdTech","Energy & Sustainability","Finance & Banking",
  "Fintech","Food & Beverage","Government & Public Sector","HR & Workforce",
  "Healthcare","Insurance","Legal","Manufacturing","Marketing",
  "Media & Entertainment","Mental Health & Wellness","Non-profit & Social Impact",
  "Pharmaceuticals & Biotech","Real Estate","Retail & E-commerce",
  "Science & Research","Small Business","Startups & VC",
  "Supply Chain & Logistics","Technology","Travel & Hospitality","General",
];

function HealthDot({ feed }: { feed: DevRssFeed }) {
  const checkedDate = feed.last_checked_at
    ? new Date(feed.last_checked_at).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  if (!feed.last_status) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50">
        <span className="inline-block h-2 w-2 rounded-full bg-muted/60" />
        Never checked
      </span>
    );
  }
  const ok = feed.last_status === "ok";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${ok ? "text-emerald-400" : "text-red-400"}`}>
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
      {ok
        ? `OK · ${feed.last_article_count ?? 0} articles`
        : `Error · ${feed.last_error ?? "unknown"}`}
      {checkedDate && (
        <span className="text-muted-foreground/50 font-normal">· {checkedDate}</span>
      )}
    </span>
  );
}

function RssFeedsCatalogueTab() {
  const handleAuthError = useDevAuthErrorHandler();
  const [feeds, setFeeds] = useState<DevRssFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", category: "Technology", description: "", enabled: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", url: "", category: "Technology", description: "", enabled: true });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState<"__all__" | "ok" | "error" | "unchecked">("__all__");
  const [intervalDays, setIntervalDays] = useState(7);
  const [savingInterval, setSavingInterval] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkRechecking, setBulkRechecking] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [feedsRes, settingsRes] = await Promise.all([
        devApi("/developer/rss/feeds"),
        devApi("/developer/rss/settings"),
      ]);
      setFeeds(feedsRes);
      setIntervalDays(settingsRes.health_check_interval_days ?? 7);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load feeds");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addFeed() {
    if (!form.name.trim() || !form.url.trim()) { setErr("Name and URL are required."); return; }
    setSaving(true); setErr("");
    try {
      await devApi("/developer/rss/feeds", { method: "POST", body: form });
      setForm({ name: "", url: "", category: "Technology", description: "", enabled: true });
      setShowAdd(false);
      load();
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add feed");
    }
    setSaving(false);
  }

  async function updateFeed() {
    if (!editingId) return;
    setSaving(true); setErr("");
    try {
      await devApi(`/developer/rss/feeds/${editingId}`, { method: "PATCH", body: editForm });
      setEditingId(null);
      load();
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not update feed");
    }
    setSaving(false);
  }

  async function deleteFeed(id: string) {
    setErr("");
    try {
      await devApi(`/developer/rss/feeds/${id}`, { method: "DELETE" });
      setDeleteId(null);
      load();
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not delete feed");
    }
  }

  async function recheckFeed(id: string) {
    setCheckingId(id);
    try {
      const result = await devApi(`/developer/rss/feeds/${id}/check`, { method: "POST" });
      setFeeds(prev => prev.map(f => f.id !== id ? f : {
        ...f,
        last_checked_at: result.checked_at,
        last_status: result.ok ? "ok" : "error",
        last_error: result.error ?? null,
        last_article_count: result.ok ? result.article_count : f.last_article_count,
      }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Check failed");
    }
    setCheckingId(null);
  }

  async function recheckAll() {
    setCheckingAll(true);
    setErr("");
    for (const feed of feeds.filter(f => f.enabled)) {
      setCheckingId(feed.id);
      try {
        const result = await devApi(`/developer/rss/feeds/${feed.id}/check`, { method: "POST" });
        setFeeds(prev => prev.map(f => f.id !== feed.id ? f : {
          ...f,
          last_checked_at: result.checked_at,
          last_status: result.ok ? "ok" : "error",
          last_error: result.error ?? null,
          last_article_count: result.ok ? result.article_count : f.last_article_count,
        }));
      } catch {
        // continue to next feed even if one fails
      }
    }
    setCheckingId(null);
    setCheckingAll(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(f => f.id)));
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} feed${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    setErr("");
    for (const id of Array.from(selectedIds)) {
      try {
        await devApi(`/developer/rss/feeds/${id}`, { method: "DELETE" });
      } catch {
        // continue
      }
    }
    setSelectedIds(new Set());
    setBulkDeleting(false);
    load();
  }

  async function bulkRecheck() {
    if (selectedIds.size === 0) return;
    setBulkRechecking(true);
    setErr("");
    const ids = Array.from(selectedIds);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setCheckingId(id);
      try {
        const result = await devApi(`/developer/rss/feeds/${id}/check`, { method: "POST" });
        setFeeds(prev => prev.map(f => f.id !== id ? f : {
          ...f,
          last_checked_at: result.checked_at,
          last_status: result.ok ? "ok" : "error",
          last_error: result.error ?? null,
          last_article_count: result.ok ? result.article_count : f.last_article_count,
        }));
      } catch {
        // continue to next
      }
    }
    setCheckingId(null);
    setBulkRechecking(false);
  }

  async function bulkImport(file: File) {
    setBulkUploading(true);
    setBulkResult(null);
    setErr("");
    try {
      const text = await file.text();
      let items: any[];
      try {
        items = JSON.parse(text);
        if (!Array.isArray(items)) throw new Error("JSON must be an array of feed objects.");
      } catch (e: any) {
        setErr(`Invalid JSON: ${e.message}`);
        setBulkUploading(false);
        return;
      }
      let added = 0, skipped = 0;
      const errors: string[] = [];
      for (const item of items) {
        if (!item.name || !item.url) { errors.push(`Skipped: missing name or url (${JSON.stringify(item).slice(0, 60)})`); skipped++; continue; }
        try {
          await devApi("/developer/rss/feeds", {
            method: "POST",
            body: {
              name: item.name,
              url: item.url,
              category: item.category || "General",
              description: item.description || "",
              enabled: item.enabled !== false,
            },
          });
          added++;
        } catch (e: any) {
          if (e.status === 409) { skipped++; }  // already exists
          else { errors.push(`${item.name}: ${e.message || "unknown error"}`); skipped++; }
        }
      }
      setBulkResult({ added, skipped, errors });
      load();
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Bulk import failed");
    }
    setBulkUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function exportFeeds() {
    const exportable = feeds.map(f => ({
      name: f.name,
      url: f.url,
      category: f.category,
      description: f.description,
      enabled: f.enabled,
    }));
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rss_feeds_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveInterval() {
    setSavingInterval(true);
    try {
      await devApi("/developer/rss/settings", { method: "PUT", body: { health_check_interval_days: intervalDays } });
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save interval");
    }
    setSavingInterval(false);
  }

  function startEdit(feed: DevRssFeed) {
    setEditingId(feed.id);
    setEditForm({ name: feed.name, url: feed.url, category: feed.category, description: feed.description, enabled: feed.enabled });
  }

  const inputCls = "w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none";
  const selCls = "w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none";

  const uniqueCategories = Array.from(new Set(feeds.map(f => f.category))).sort();
  const filtered = feeds.filter(f => {
    if (categoryFilter !== "__all__" && f.category !== categoryFilter) return false;
    if (statusFilter === "ok")        return f.last_status === "ok";
    if (statusFilter === "error")     return f.last_status === "error";
    if (statusFilter === "unchecked") return !f.last_status;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header + add button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-foreground">RSS Feed Catalogue</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add curated RSS feeds here — they appear in Agent Niva for all users to subscribe to.
            Pro users can also add their own custom URLs on top of these.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Hidden file input for JSON import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) bulkImport(e.target.files[0]); }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={bulkUploading}
            className="rounded-full border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-40">
            {bulkUploading ? "Importing…" : "⬆ Import JSON"}
          </button>
          <button
            onClick={exportFeeds}
            disabled={feeds.length === 0}
            className="rounded-full border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-40">
            ⬇ Export JSON
          </button>
          <button onClick={() => { setShowAdd(true); setErr(""); setBulkResult(null); }}
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90">
            + Add feed
          </button>
        </div>
      </div>

      {/* Bulk import result banner */}
      {bulkResult && (
        <div className={`rounded-xl border px-4 py-3 text-xs ${bulkResult.errors.length > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={bulkResult.errors.length > 0 ? "text-amber-300" : "text-emerald-400"}>
              ✓ Import complete — {bulkResult.added} added, {bulkResult.skipped} skipped
            </span>
            <button onClick={() => setBulkResult(null)} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
          {bulkResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-amber-300/80">
              {bulkResult.errors.map((e, i) => <li key={i}>· {e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Health check interval setting */}
      <div className="rounded-xl border border-border/40 bg-card/50 p-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground">Health check interval</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            How often the scheduled task re-checks each feed. Manual re-check always works immediately.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="number" min={1} max={365} value={intervalDays}
            onChange={e => setIntervalDays(Number(e.target.value))}
            className="w-16 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground text-center focus:border-ring focus:outline-none"
          />
          <span className="text-xs text-muted-foreground">days</span>
          <button onClick={saveInterval} disabled={savingInterval}
            className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
            {savingInterval ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {err && <div className="text-xs text-destructive">{err}</div>}

      {/* Add form */}
      {showAdd && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="text-xs font-semibold text-foreground">New feed</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="TechCrunch" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={selCls}>
                {RSS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">URL *</label>
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://techcrunch.com/feed/" className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Description (shown to users)</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Latest technology news and startup coverage" className={inputCls} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="accent-primary" />
              Enabled (visible to users)
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(false); setErr(""); }} className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={addFeed} disabled={saving} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
              {saving ? "Adding…" : "Add feed"}
            </button>
          </div>
        </div>
      )}

      {/* Filters + Check All */}
      {!loading && feeds.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground shrink-0">Filter:</span>

          {/* Category */}
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
            <option value="__all__">All categories ({feeds.length})</option>
            {uniqueCategories.map(c => (
              <option key={c} value={c}>{c} ({feeds.filter(f => f.category === c).length})</option>
            ))}
          </select>

          {/* Status */}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
            className="rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
            <option value="__all__">All statuses</option>
            <option value="ok">🟢 OK ({feeds.filter(f => f.last_status === "ok").length})</option>
            <option value="error">🔴 Error ({feeds.filter(f => f.last_status === "error").length})</option>
            <option value="unchecked">⚪ Never checked ({feeds.filter(f => !f.last_status).length})</option>
          </select>

          {/* Clear filters */}
          {(categoryFilter !== "__all__" || statusFilter !== "__all__") && (
            <button onClick={() => { setCategoryFilter("__all__"); setStatusFilter("__all__"); }}
              className="text-[11px] text-primary hover:underline">
              Clear
            </button>
          )}

          {/* Result count */}
          <span className="text-[11px] text-muted-foreground">
            {filtered.length} of {feeds.length} feed{feeds.length !== 1 ? "s" : ""}
          </span>

          {/* Check All button */}
          <button
            onClick={recheckAll}
            disabled={checkingAll || checkingId !== null}
            className="ml-auto rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-40 flex items-center gap-1.5">
            {checkingAll ? (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Checking {feeds.findIndex(f => f.id === checkingId) + 1}/{feeds.filter(f => f.enabled).length}…
              </>
            ) : "Check all feeds"}
          </button>
        </div>
      )}

      {/* Bulk action bar — shown when any feeds are selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/80 px-4 py-2.5">
          <span className="text-xs font-semibold text-foreground">
            {selectedIds.size} feed{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground">
            Clear
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={bulkRecheck}
              disabled={bulkRechecking || bulkDeleting || checkingAll}
              className="rounded-full border border-border/50 px-4 py-1.5 text-xs font-semibold text-foreground hover:border-border transition-all disabled:opacity-40 flex items-center gap-1.5">
              {bulkRechecking ? (
                <>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Checking {Array.from(selectedIds).indexOf(checkingId ?? "") + 1}/{selectedIds.size}…
                </>
              ) : `Re-check ${selectedIds.size} selected`}
            </button>
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting || bulkRechecking}
              className="rounded-full bg-destructive px-4 py-1.5 text-xs font-semibold text-white hover:bg-destructive/80 disabled:opacity-50">
              {bulkDeleting ? "Deleting…" : `Delete ${selectedIds.size} selected`}
            </button>
          </div>
        </div>
      )}

      {/* Feed list */}
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 p-8 text-center">
          <div className="text-2xl mb-2">📰</div>
          <div className="text-xs text-muted-foreground">
            {feeds.length === 0 ? "No feeds yet. Add one above." : "No feeds match this filter."}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select-all row */}
          <div className="flex items-center gap-3 px-1 pb-1">
            <input
              type="checkbox"
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              onChange={toggleSelectAll}
              className="accent-primary h-3.5 w-3.5 cursor-pointer"
            />
            <span className="text-[11px] text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
            </span>
          </div>

          {filtered.map(feed => (
            <div key={feed.id} className={`rounded-xl border p-3 ${selectedIds.has(feed.id) ? "border-primary/40 bg-primary/5" : feed.enabled ? "border-border/40 bg-card/50" : "border-border/20 bg-muted/10 opacity-60"}`}>
              {editingId === feed.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">Name</label>
                      <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">Category</label>
                      <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className={selCls}>
                        {RSS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">URL</label>
                    <input value={editForm.url} onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Description</label>
                    <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                      <input type="checkbox" checked={editForm.enabled} onChange={e => setEditForm(f => ({ ...f, enabled: e.target.checked }))} className="accent-primary" />
                      Enabled
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingId(null)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    <button onClick={updateFeed} disabled={saving} className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              ) : deleteId === feed.id ? (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-destructive">Delete <span className="font-semibold">{feed.name}</span>? Existing subscriptions will lose this feed.</p>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => setDeleteId(null)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    <button onClick={() => deleteFeed(feed.id)} className="rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-white hover:bg-destructive/80">Delete</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  {/* Row checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedIds.has(feed.id)}
                    onChange={() => toggleSelect(feed.id)}
                    className="accent-primary h-3.5 w-3.5 mt-0.5 shrink-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-foreground">{feed.name}</span>
                      <span className="rounded-full bg-muted/40 border border-border/30 px-2 py-0.5 text-[10px] text-muted-foreground">{feed.category}</span>
                      {!feed.enabled && <span className="rounded-full bg-muted/20 border border-border/20 px-2 py-0.5 text-[10px] text-muted-foreground/50">Disabled</span>}
                    </div>
                    {feed.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{feed.description}</p>}
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5 truncate">{feed.url}</p>
                    <div className="mt-1.5">
                      <HealthDot feed={feed} />
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 items-center">
                    <button
                      onClick={() => recheckFeed(feed.id)}
                      disabled={checkingId === feed.id}
                      title="Re-check feed health now"
                      className="rounded-full border border-border/40 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-40">
                      {checkingId === feed.id ? "Checking…" : "Re-check"}
                    </button>
                    <button onClick={() => startEdit(feed)} className="rounded-full border border-border/40 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-all">Edit</button>
                    <button onClick={() => setDeleteId(feed.id)} className="rounded-full border border-border/30 px-3 py-1 text-[11px] text-destructive/60 hover:text-destructive hover:border-destructive/30 transition-all">Delete</button>
                  </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SETTINGS_TABS = [
  { key: "launch",    label: "🚀 Launch" },
  { key: "billing",   label: "💳 Billing" },
  { key: "api",       label: "🔌 API Endpoints" },
  { key: "users",     label: "👥 Users" },
  { key: "retention", label: "🗄 Retention" },
  { key: "scraper",   label: "🕷 Web Scraper" },
  { key: "theme",     label: "🎨 Theme AI" },
  { key: "ratios",    label: "📐 Aspect Ratios" },
  { key: "railway",   label: "🚂 Railway" },
  { key: "legal",     label: "📄 Legal" },
  { key: "rss",       label: "📰 RSS Feeds" },
] as const;
type SettingsTab = typeof SETTINGS_TABS[number]["key"];

// ── Web Scraper tab ───────────────────────────────────────────────────────────
function WebScraperTab() {
  const handleAuthError = useDevAuthErrorHandler();
  const [maxPages, setMaxPages]           = useState("12");
  const [maxDepth, setMaxDepth]           = useState("2");
  const [pageTimeoutMs, setPageTimeoutMs] = useState("20000");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [err, setErr]         = useState("");

  useEffect(() => {
    devApi("/developer/scraper-settings")
      .then((r: any) => {
        setMaxPages(String(r.max_pages));
        setMaxDepth(String(r.max_depth));
        setPageTimeoutMs(String(r.page_timeout_ms));
      })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load scraper settings"); });
  }, []);

  async function save() {
    const pages   = parseInt(maxPages);
    const depth   = parseInt(maxDepth);
    const timeout = parseInt(pageTimeoutMs);
    if (isNaN(pages)   || pages < 1   || pages > 200)    { setErr("Max pages must be 1–200"); return; }
    if (isNaN(depth)   || depth < 1   || depth > 10)     { setErr("Max depth must be 1–10"); return; }
    if (isNaN(timeout) || timeout < 3000 || timeout > 120000) { setErr("Page timeout must be 3000–120000 ms"); return; }
    setSaving(true); setErr(""); setSaved(false);
    try {
      const r = await devApi("/developer/scraper-settings", {
        method: "PUT",
        body: { max_pages: pages, max_depth: depth, page_timeout_ms: timeout },
      });
      setMaxPages(String(r.max_pages));
      setMaxDepth(String(r.max_depth));
      setPageTimeoutMs(String(r.page_timeout_ms));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="text-sm font-semibold text-foreground mb-1">Web scraper settings</div>
        <p className="text-xs text-muted-foreground mb-5">
          Controls how Agent Niva crawls company websites during Quick Start. Changes take effect immediately on the
          next scrape — no restart needed. Higher values mean more thorough scraping but slower results.
        </p>

        <div className="space-y-5">
          {/* Max pages */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
              Max pages <span className="font-normal">(1–200)</span>
            </label>
            <div className="flex items-center gap-3">
              <input type="number" min={1} max={200} step={1} value={maxPages} onChange={(e) => setMaxPages(e.target.value)}
                className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
              <span className="text-xs text-muted-foreground">pages per crawl</span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Maximum number of pages to visit from a single domain. Default 12 — enough for most company sites
              without long wait times. Raise to 30–50 for large sites with many product pages.
            </p>
          </div>

          {/* Max depth */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
              Max depth <span className="font-normal">(1–10)</span>
            </label>
            <div className="flex items-center gap-3">
              <input type="number" min={1} max={10} step={1} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)}
                className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
              <span className="text-xs text-muted-foreground">link levels from homepage</span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              How many clicks deep from the homepage to follow links. Depth 1 = homepage + direct links only.
              Depth 2 (default) also follows links found on those pages. Rarely needs to go above 3.
            </p>
          </div>

          {/* Page timeout */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
              Page timeout <span className="font-normal">(3000–120000 ms)</span>
            </label>
            <div className="flex items-center gap-3">
              <input type="number" min={3000} max={120000} step={1000} value={pageTimeoutMs} onChange={(e) => setPageTimeoutMs(e.target.value)}
                className="w-28 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" />
              <span className="text-xs text-muted-foreground">ms ({(parseInt(pageTimeoutMs) / 1000 || 0).toFixed(0)}s)</span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              How long to wait for each page to fully load before moving on. Default 20,000ms (20s). Increase for
              slow or JavaScript-heavy sites; decrease if scrapes are timing out on fast sites.
            </p>
          </div>
        </div>

        {/* Reference table */}
        <div className="mt-5 rounded-lg border border-border/50 bg-muted/20 p-3">
          <div className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Quick reference</div>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
            <div><span className="font-semibold text-foreground">Small site</span><br />pages: 10, depth: 2</div>
            <div><span className="font-semibold text-foreground">Medium site</span><br />pages: 20, depth: 3</div>
            <div><span className="font-semibold text-foreground">Large site</span><br />pages: 50, depth: 4</div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
            {saving ? "Saving…" : "Save scraper settings"}
          </button>
          {saved && <span className="text-xs text-emerald-400">✓ Saved — takes effect on next scrape</span>}
        </div>
        {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
      </div>
    </div>
  );
}

function DeveloperSettings() {
  const allowed = useRequireDeveloperPermission("settings");
  const [tab, setTab] = useState<SettingsTab>("launch");
  if (!allowed) return null;

  return (
    <DeveloperShell title="Settings">
      {/* Tab strip */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {SETTINGS_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${tab === t.key
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "launch"    && <LaunchControlCard />}
      {tab === "billing"   && <BillingSettingsTab />}
      {tab === "api"       && <ApiEndpointsTab />}
      {tab === "users"     && <UsersTab />}
      {tab === "retention" && <RetentionTab />}
      {tab === "scraper"   && <WebScraperTab />}
      {tab === "theme"     && <ThemeAiSettingsCard />}
      {tab === "ratios"    && <VideoRatiosCard />}
      {tab === "railway"   && <RailwayTab />}
      {tab === "legal"     && <LegalLinksCard />}
      {tab === "rss"       && <RssFeedsCatalogueTab />}
    </DeveloperShell>
  );
}

