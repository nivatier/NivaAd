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

function LaunchControlCard() {
  const handleAuthError = useDevAuthErrorHandler();
  const [open, setOpen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/launch-control")
      .then((r) => setOpen(r.registration_open))
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load"); });
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



const SETTINGS_TABS = [
  { key: "launch",    label: "🚀 Launch" },
  { key: "billing",   label: "💳 Billing" },
  { key: "api",       label: "🔌 API Endpoints" },
  { key: "users",     label: "👥 Users" },
  { key: "retention", label: "🗄 Retention" },
  { key: "theme",     label: "🎨 Theme AI" },
  { key: "ratios",    label: "📐 Video Ratios" },
  { key: "railway",   label: "🚂 Railway" },
  { key: "legal",     label: "📄 Legal" },
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
      {tab === "railway"   && <RailwayTab />}
      {tab === "legal"     && <LegalLinksCard />}
    </DeveloperShell>
  );
}

