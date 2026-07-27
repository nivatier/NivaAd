import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
    <div className="rounded-xl border border-border bg-card/60 p-5">
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
        <input value={newRatio} onChange={(e) => setNewRatio(e.target.value)} placeholder="e.g. 21:9" className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        <button onClick={add} disabled={busy === "add" || !newRatio.trim()} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
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

type CreatedUser = {
  company_id: string;
  company_name: string;
  email: string;
  full_name: string;
  user_id: string | null;
  tier: string;
  created_at: string;
};

type EditState = {
  company_id: string;
  company_name: string;
  email: string;
  full_name: string;
  tier: string;
};

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};

function LaunchControlCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [open, setOpen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<CreatedUser[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tier, setTier] = useState("free");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [createOk, setCreateOk] = useState("");
  const [err, setErr] = useState("");

  // Edit state
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [editOk, setEditOk] = useState("");

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function loadUsers() {
    devApi("/developer/created-users")
      .then((r: CreatedUser[]) => setUsers(r))
      .catch(() => {});
  }

  useEffect(() => {
    devApi("/developer/launch-control")
      .then((r) => setOpen(r.registration_open))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load"); });
    loadUsers();
  }, []);

  async function toggleOpen() {
    if (open === null) return;
    setSaving(true); setErr("");
    try {
      const r = await devApi("/developer/launch-control", { method: "PUT", body: { registration_open: !open } });
      setOpen(r.registration_open);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not save"); }
    setSaving(false);
  }

  async function createUser() {
    if (!companyName.trim()) { setCreateErr("Company name required"); return; }
    if (!email.trim() || !email.includes("@")) { setCreateErr("Valid email required"); return; }
    if (password.length < 8) { setCreateErr("Password must be at least 8 characters"); return; }
    setCreating(true); setCreateErr(""); setCreateOk("");
    try {
      const r = await devApi("/developer/create-user", {
        method: "POST",
        body: { company_name: companyName.trim(), email: email.trim(), password, full_name: fullName.trim(), tier },
      });
      setCreateOk(`✓ Created ${r.email} (${r.company}) — ${r.credits} credits on ${r.tier} plan`);
      setCompanyName(""); setEmail(""); setPassword(""); setFullName(""); setTier("free");
      loadUsers();
    } catch (e: any) { if (!handleAuthError(e)) setCreateErr(e.message || "Could not create user"); }
    setCreating(false);
  }

  function startEdit(u: CreatedUser) {
    setEditing({ company_id: u.company_id, company_name: u.company_name, email: u.email, full_name: u.full_name, tier: u.tier });
    setEditErr(""); setEditOk("");
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.company_name.trim()) { setEditErr("Company name required"); return; }
    if (!editing.email.trim() || !editing.email.includes("@")) { setEditErr("Valid email required"); return; }
    setEditSaving(true); setEditErr(""); setEditOk("");
    try {
      await devApi(`/developer/created-users/${editing.company_id}`, {
        method: "PUT",
        body: { company_name: editing.company_name.trim(), email: editing.email.trim(), full_name: editing.full_name.trim(), tier: editing.tier },
      });
      setEditOk("✓ Saved");
      setTimeout(() => { setEditing(null); setEditOk(""); }, 1000);
      loadUsers();
    } catch (e: any) { if (!handleAuthError(e)) setEditErr(e.message || "Could not save"); }
    setEditSaving(false);
  }

  async function deleteUser(u: CreatedUser) {
    if (!confirm(`Permanently delete "${u.company_name}" (${u.email}) and all their data? This cannot be undone.`)) return;
    setDeletingId(u.company_id);
    try {
      await devApi(`/developer/created-users/${u.company_id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((x) => x.company_id !== u.company_id));
      if (editing?.company_id === u.company_id) setEditing(null);
    } catch (e: any) { if (!handleAuthError(e)) alert(e.message || "Could not delete"); }
    setDeletingId(null);
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 sm:col-span-2">
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
        <button onClick={toggleOpen} disabled={saving || open === null}
          className={`relative shrink-0 h-7 w-12 rounded-full border-2 transition-colors focus:outline-none disabled:opacity-50 ${open ? "border-emerald-500 bg-emerald-500" : "border-border bg-muted/40"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${open ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}

      <div className="mt-5 border-t border-border/50 pt-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Add user directly</div>
        <p className="text-[11px] text-muted-foreground mb-3">Creates a company and admin user in the database. Works whether registration is open or closed.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Company name *</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acme.com"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Password * (min 8 chars)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Plan tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
              <option value="free">Free (3 credits)</option>
              <option value="starter">Starter (10 credits)</option>
              <option value="growth">Growth (30 credits)</option>
              <option value="pro">Pro (120 credits)</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={createUser} disabled={creating}
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
            {creating ? "Creating…" : "Create user"}
          </button>
          {createOk && <span className="text-xs text-emerald-400">{createOk}</span>}
        </div>
        {createErr && <div className="mt-1 text-xs text-destructive">{createErr}</div>}
      </div>

      {users.length > 0 && (
        <div className="mt-5 border-t border-border/50 pt-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Users added via developer panel</div>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.company_id} className="rounded-lg border border-border bg-background/40 overflow-hidden">
                {/* Row */}
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-foreground">{u.email}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{u.company_name}</span>
                    <span className="ml-2 rounded-full border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">{TIER_LABELS[u.tier] ?? u.tier}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</span>
                    <button
                      onClick={() => editing?.company_id === u.company_id ? setEditing(null) : startEdit(u)}
                      className="rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground border border-border hover:text-foreground hover:border-primary/40 transition-colors">
                      {editing?.company_id === u.company_id ? "Cancel" : "Edit"}
                    </button>
                    <button
                      onClick={() => deleteUser(u)}
                      disabled={deletingId === u.company_id}
                      className="rounded-md px-2 py-1 text-[10px] font-medium text-destructive/70 border border-destructive/30 hover:text-destructive hover:border-destructive transition-colors disabled:opacity-40">
                      {deletingId === u.company_id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>

                {/* Inline edit form */}
                {editing?.company_id === u.company_id && (
                  <div className="border-t border-border/50 bg-muted/10 px-3 py-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Company name *</label>
                        <input value={editing.company_name} onChange={(e) => setEditing({ ...editing, company_name: e.target.value })}
                          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Full name</label>
                        <input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Email *</label>
                        <input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Plan tier</label>
                        <select value={editing.tier} onChange={(e) => setEditing({ ...editing, tier: e.target.value })}
                          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
                          <option value="free">Free (3 credits)</option>
                          <option value="starter">Starter (10 credits)</option>
                          <option value="growth">Growth (30 credits)</option>
                          <option value="pro">Pro (120 credits)</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={saveEdit} disabled={editSaving}
                        className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
                        {editSaving ? "Saving…" : "Save changes"}
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                        Cancel
                      </button>
                      {editOk && <span className="text-xs text-emerald-400">{editOk}</span>}
                    </div>
                    {editErr && <div className="mt-1 text-xs text-destructive">{editErr}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformConfigCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [creditValue, setCreditValue] = useState("");
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
    const carousel = parseInt(carouselMax);
    if (isNaN(credit) || credit <= 0) { setErr("Credit value must be a positive number"); return; }
    if (isNaN(carousel) || carousel < 2 || carousel > 20) { setErr("Carousel max must be 2–20"); return; }
    try { JSON.parse(priceIds); } catch { setErr("Stripe Price IDs is not valid JSON"); return; }
    if (priceTopup && !priceTopup.startsWith("price_")) { setErr("Stripe Topup Price ID must start with price_"); return; }

    setSaving(true); setErr(""); setSaved(false);
    try {
      const r = await devApi("/developer/platform-config", {
        method: "PUT",
        body: {
          credit_value_usd: credit,
          carousel_max_images: carousel,
          stripe_price_ids: priceIds,
          stripe_price_topup: priceTopup,
          openrouter_base_url: openrouterUrl,
         
         
        },
      });
      setCreditValue(String(r.credit_value_usd));
      setCarouselMax(String(r.carousel_max_images));
      try {
        const parsed = typeof r.stripe_price_ids === "string" ? JSON.parse(r.stripe_price_ids) : r.stripe_price_ids;
        setPriceIds(JSON.stringify(parsed, null, 2));
      } catch { setPriceIds(r.stripe_price_ids ?? "{}"); }
      setPriceTopup(r.stripe_price_topup ?? "");
      setOpenrouterUrl(r.openrouter_base_url ?? "");
      setAnthropicUrl(r.anthropic_base_url ?? "");
      setLinkedinUrl(r.linkedin_api_url ?? "");
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
          <p className="mt-1 text-[10px] text-muted-foreground">Must match your Stripe top-up price per unit</p>
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
    const carousel = parseInt(carouselMax);
    if (isNaN(credit) || credit <= 0) { setErr("Credit value must be a positive number"); return; }
    if (isNaN(carousel) || carousel < 2 || carousel > 20) { setErr("Carousel max must be 2–20"); return; }
    try { JSON.parse(priceIds); } catch { setErr("Stripe Price IDs is not valid JSON"); return; }
    if (priceTopup && !priceTopup.startsWith("price_")) { setErr("Topup price ID must start with price_"); return; }
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/platform-config", {
        method: "PUT",
        body: { credit_value_usd: credit, carousel_max_images: carousel, stripe_price_ids: priceIds, stripe_price_topup: priceTopup },
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
            <p className="mt-1 text-[10px] text-muted-foreground">Must match your Stripe per-credit price</p>
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/platform-config")
      .then((r) => {
        setOpenrouterUrl(r.openrouter_base_url ?? "");
      })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load"); });
  }, []);

  async function save() {
    for (const [label, val] of [["OpenRouter", openrouterUrl]]) {
      if (val && !(val as string).startsWith("http")) { setErr(`${label} URL must start with http`); return; }
    }
    setSaving(true); setErr(""); setSaved(false);
    try {
      await devApi("/developer/platform-config", {
        method: "PUT",
        body: { openrouter_base_url: openrouterUrl, linkedin_api_url: linkedinUrl },
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
const SETTINGS_TABS = [
  { key: "launch",    label: "🚀 Launch" },
  { key: "billing",   label: "💳 Billing" },
  { key: "api",       label: "🔌 API Endpoints" },
  { key: "users",     label: "👥 Users" },
  { key: "retention", label: "🗄 Retention" },
  { key: "theme",     label: "🎨 Theme AI" },
  { key: "ratios",    label: "📐 Video Ratios" },
] as const;
type SettingsTab = typeof SETTINGS_TABS[number]["key"];

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
      {tab === "theme"     && <ThemeAiSettingsCard />}
      {tab === "ratios"    && <VideoRatiosCard />}
    </DeveloperShell>
  );
}

