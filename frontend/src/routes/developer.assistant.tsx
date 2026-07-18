import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/assistant")({
  component: DeveloperAssistant,
  head: () => ({ meta: [{ title: "Assistant — NivaAd Developer" }] }),
});

type Hint = { id: string; key: string; label: string; message: string; audio_url: string | null };
type Settings = { typing_ms_per_char: number; tts_voice: string; tts_model: string; intro_audio_url: string | null };

const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
const INTRO_DEFAULT =
  "Hi there! I'm Nova — your in-app assistant! I'll guide you around, just click anything you'd like to know more about and I'll come right over and explain it. The blue button puts me to sleep when you need some space, and the green button wakes me back up whenever you need me. I'm always here for you!";

function SettingsCard({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const handleAuthError = useDevAuthErrorHandler();
  const [typing, setTyping] = useState(settings.typing_ms_per_char);
  const [voice, setVoice] = useState(settings.tts_voice);
  const [model, setModel] = useState(settings.tts_model || "openai/gpt-audio-mini");
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [introText, setIntroText] = useState(INTRO_DEFAULT);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    try {
      const s: Settings = await devApi("/developer/assistant-settings", { method: "PUT", body: { typing_ms_per_char: typing, tts_voice: voice, tts_model: model.trim() || "openai/gpt-audio-mini" } });
      onSave(s); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not save"); }
    setBusy(false);
  }

  async function generateIntroAudio() {
    setGenBusy(true); setErr("");
    try {
      const s: Settings = await devApi("/developer/assistant-intro/generate-audio", { method: "POST", body: { text: introText } });
      onSave(s);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Generation failed — check your OpenRouter key and model slug"); }
    setGenBusy(false);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-card/60 p-4 max-w-2xl">
      <div className="text-sm font-semibold text-foreground mb-1">Assistant settings</div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Audio is generated via OpenRouter — your existing key works. Model must support audio output modality
        (see <a href="https://openrouter.ai/models?output_modalities=audio" target="_blank" rel="noopener" className="text-primary hover:underline">openrouter.ai/models?output_modalities=audio</a>).
        If no audio has been generated yet, Nova speaks via the browser's built-in Speech Synthesis instead.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <div>
          <label className="text-[11px] text-muted-foreground">OpenRouter model slug</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="openai/gpt-audio-mini"
            className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none font-mono" />
          <div className="text-[10px] text-muted-foreground mt-0.5">Must support audio output modality</div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Voice</label>
          <select value={voice} onChange={(e) => setVoice(e.target.value)}
            className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none">
            {TTS_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Typing speed (ms / character)</label>
          <input type="number" min={8} max={120} value={typing} onChange={(e) => setTyping(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <div className="text-[10px] text-muted-foreground mt-0.5">Default 22 — higher = slower</div>
        </div>
        <div className="flex items-end pb-1">
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy}
              className="rounded-full bg-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
              {busy ? "Saving…" : "Save settings"}
            </button>
            {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
          </div>
        </div>
      </div>
      <div className="border-t border-slate-700/50 pt-3">
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">Nova's intro speech (plays on every login)</div>
        <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} rows={3}
          className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-slate-500 focus:outline-none mb-2" />
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={generateIntroAudio} disabled={genBusy || !introText.trim()}
            className="rounded-full border border-primary/50 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">
            {genBusy ? "Generating…" : "🔊 Generate intro audio"}
          </button>
          {settings.intro_audio_url && <audio controls src={settings.intro_audio_url} className="h-7" />}
        </div>
        {settings.intro_audio_url && <div className="mt-1 text-[10px] text-emerald-400">✓ Stored — plays on login</div>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function EditForm({ hint, busy, onSave, onCancel }: { hint: Hint; busy: boolean; onSave: (v: { label: string; message: string }) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(hint.label);
  const [message, setMessage] = useState(hint.message);
  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-slate-500 focus:outline-none" />
        <div className="text-[10px] text-muted-foreground mt-0.5">Changing the message clears the stored audio — regenerate after saving.</div>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy || !label.trim() || !message.trim()} onClick={() => onSave({ label: label.trim(), message: message.trim() })}
          className="rounded-full bg-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-slate-700/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

function AddForm({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (v: { key: string; label: string; message: string }) => void; onCancel: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] text-muted-foreground">Key — must match <code>data-robot-hint-key</code> in the frontend</label>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. field:some-new-thing"
          className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-slate-500 focus:outline-none" />
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy || !key.trim() || !label.trim() || !message.trim()} onClick={() => onAdd({ key: key.trim(), label: label.trim(), message: message.trim() })}
          className="rounded-full bg-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
          {busy ? "Adding…" : "Add"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-slate-700/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

function DeveloperAssistant() {
  const allowed = useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();
  const [hints, setHints] = useState<Hint[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generatingAudioId, setGeneratingAudioId] = useState<string | null>(null);

  async function load() {
    try {
      const [h, s] = await Promise.all([devApi("/developer/assistant-hints"), devApi("/developer/assistant-settings")]);
      setHints(h); setSettings(s);
    } catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not load"); }
  }
  useEffect(() => { load(); }, []);

  async function save(id: string, v: { label: string; message: string }) {
    setBusy(true); setErr("");
    try { setHints(await devApi(`/developer/assistant-hints/${id}`, { method: "PUT", body: v })); setEditingId(null); }
    catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not save"); }
    setBusy(false);
  }
  async function add(v: { key: string; label: string; message: string }) {
    setBusy(true); setErr("");
    try { setHints(await devApi("/developer/assistant-hints", { method: "POST", body: v })); setShowAdd(false); }
    catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not add"); }
    setBusy(false);
  }
  async function remove(id: string) {
    if (!confirm("Delete this message?")) return;
    try { setHints(await devApi(`/developer/assistant-hints/${id}`, { method: "DELETE" })); }
    catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Could not delete"); }
  }
  async function generateAudio(id: string) {
    setGeneratingAudioId(id); setErr("");
    try { setHints(await devApi(`/developer/assistant-hints/${id}/generate-audio`, { method: "POST" })); }
    catch (e: any) { if (!handleAuthError(e)) setErr(e.message || "Generation failed"); }
    setGeneratingAudioId(null);
  }

  if (!allowed) return null;
  if (!hints || !settings) return <DeveloperShell title="Assistant"><div className="text-xs text-muted-foreground">Loading…</div></DeveloperShell>;

  return (
    <DeveloperShell title="Assistant">
      <p className="mb-6 max-w-2xl text-xs text-muted-foreground">
        Configure Nova's typing speed, TTS voice, and the explanation messages she says at each hinted UI element.
        Generate audio per-hint — before audio is generated Nova speaks via the browser's built-in Speech Synthesis.
      </p>

      <SettingsCard settings={settings} onSave={setSettings} />

      <div className="text-sm font-semibold text-foreground mb-3">Hint messages</div>
      <div className="max-w-2xl space-y-2 mb-4">
        {hints.map((h) => (
          <div key={h.id} className="rounded-xl border border-slate-700/50 bg-card/60 p-3">
            {editingId === h.id ? (
              <EditForm hint={h} busy={busy} onCancel={() => setEditingId(null)} onSave={(v) => save(h.id, v)} />
            ) : (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-foreground">{h.label}</span>
                    <code className="rounded bg-slate-800/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">{h.key}</code>
                    {h.audio_url ? <span className="text-[10px] text-emerald-400">🔊 audio ready</span> : <span className="text-[10px] text-amber-400">⚠ no audio (uses browser voice)</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{h.message}</div>
                  {h.audio_url && <audio controls src={h.audio_url} className="mt-1.5 h-6" />}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => setEditingId(h.id)} className="rounded-full border border-slate-700/50 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">Edit</button>
                  <button onClick={() => generateAudio(h.id)} disabled={generatingAudioId === h.id}
                    className="rounded-full border border-primary/50 px-2.5 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50">
                    {generatingAudioId === h.id ? "…" : "🔊 Gen"}
                  </button>
                  <button onClick={() => remove(h.id)} className="rounded-full border border-destructive/50 px-2.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10">Del</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd ? (
        <div className="max-w-2xl rounded-xl border border-slate-700/50 bg-card/60 p-3">
          <AddForm busy={busy} onCancel={() => setShowAdd(false)} onAdd={add} />
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="rounded-full border border-dashed border-primary/50 px-4 py-1.5 text-xs text-primary hover:bg-primary/5">
          + Add message
        </button>
      )}
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </DeveloperShell>
  );
}
