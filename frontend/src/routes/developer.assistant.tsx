import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { NAV } from "@/components/app-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/assistant")({
  component: DeveloperAssistant,
  head: () => ({ meta: [{ title: "Assistant — NivaAd Developer" }] }),
});

type Hint = { id: string; key: string; label: string; message: string; audio_url: string | null };
type Settings = { assistant_name: string; typing_ms_per_char: number; tts_voice: string; tts_model: string; intro_audio_url: string | null; intro_text: string | null };

const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
const SYSTEM_SLEEP_KEY = "system:sleep";
const SYSTEM_WAKE_KEY = "system:wake";

// Human-friendly labels for known key prefixes — anything else falls back to
// a capitalized version of the prefix itself, so custom hints the developer
// adds under a new prefix still get their own sensibly-named group.
const GROUP_LABELS: Record<string, string> = {
  nav: "Navigation",
  field: "Create Ad",
};

function groupLabelFor(prefix: string) {
  return GROUP_LABELS[prefix] || (prefix.charAt(0).toUpperCase() + prefix.slice(1));
}

function introDefault(name: string) {
  return `Hi there! I'm ${name || "your assistant"} — your in-app assistant! I'll guide you around, just click anything you'd like to know more about and I'll come right over and explain it. The blue button puts me to sleep when you need some space, and the green button wakes me back up whenever you need me. I'm always here for you!`;
}

/** Inline editor for the two system hints (sleep / wake) — lives in the
 * Assistant settings card rather than the general hint-message groups below,
 * since they're intrinsic mascot behaviour, not a page/field explanation. */
function SystemMessageField({
  title, placeholder, hintKey, defaultLabel, hint, busy, generating, onSave, onAdd, onGenerateAudio,
}: {
  title: string;
  placeholder: string;
  hintKey: string;
  defaultLabel: string;
  hint: Hint | undefined;
  busy: boolean;
  generating: boolean;
  onSave: (id: string, v: { label: string; message: string }) => void;
  onAdd: (v: { key: string; label: string; message: string }) => void;
  onGenerateAudio: (id: string) => void;
}) {
  const [message, setMessage] = useState(hint?.message || "");
  const dirty = message.trim() !== (hint?.message || "").trim();

  function save() {
    if (!message.trim()) return;
    if (hint) onSave(hint.id, { label: hint.label, message: message.trim() });
    else onAdd({ key: hintKey, label: defaultLabel, message: message.trim() });
  }

  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{title}</label>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none" />
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={busy || !message.trim() || !dirty}
          className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={() => hint && onGenerateAudio(hint.id)} disabled={!hint || generating || dirty}
          title={!hint ? "Save the message first" : dirty ? "Save your changes first" : undefined}
          className="rounded-full border border-primary/50 px-3 py-1 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50">
          {generating ? "…" : "🔊 Gen"}
        </button>
        {hint?.audio_url ? <span className="text-[10px] text-emerald-400">🔊 audio ready</span> : <span className="text-[10px] text-amber-400">⚠ no audio (uses browser voice)</span>}
        {hint?.audio_url && <audio controls src={hint.audio_url} className="h-6" />}
      </div>
    </div>
  );
}

function SettingsCard({
  settings, onSave, sleepHint, wakeHint, hintBusy, generatingAudioId, onSaveHint, onAddHint, onGenerateAudio,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
  sleepHint: Hint | undefined;
  wakeHint: Hint | undefined;
  hintBusy: boolean;
  generatingAudioId: string | null;
  onSaveHint: (id: string, v: { label: string; message: string }) => void;
  onAddHint: (v: { key: string; label: string; message: string }) => void;
  onGenerateAudio: (id: string) => void;
}) {
  const handleAuthError = useDevAuthErrorHandler();
  const [name, setName] = useState(settings.assistant_name || "Nova");
  const [typing, setTyping] = useState(settings.typing_ms_per_char);
  const [voice, setVoice] = useState(settings.tts_voice);
  const [model, setModel] = useState(settings.tts_model || "openai/gpt-audio-mini");
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [introText, setIntroText] = useState(settings.intro_text?.trim() || introDefault(settings.assistant_name || "Nova"));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    try {
      const s: Settings = await devApi("/developer/assistant-settings", { method: "PUT", body: { assistant_name: name.trim() || "Nova", typing_ms_per_char: typing, tts_voice: voice, tts_model: model.trim() || "openai/gpt-audio-mini" } });
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
    <div className="mb-6 rounded-xl border border-border bg-card/60 p-4 max-w-2xl">
      <div className="text-sm font-semibold text-foreground mb-1">Assistant settings</div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Audio is generated via OpenRouter — your existing key works. Model must support audio output modality
        (see <a href="https://openrouter.ai/models?output_modalities=audio" target="_blank" rel="noopener" className="text-primary hover:underline">openrouter.ai/models?output_modalities=audio</a>).
        If no audio has been generated yet, the assistant speaks via the browser's built-in Speech Synthesis instead.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Assistant name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova" maxLength={40}
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <div className="text-[10px] text-muted-foreground mt-0.5">Shown in its own intro speech and throughout the panel</div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">OpenRouter model slug</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="openai/gpt-audio-mini"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none font-mono" />
          <div className="text-[10px] text-muted-foreground mt-0.5">Must support audio output modality</div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Voice</label>
          <select value={voice} onChange={(e) => setVoice(e.target.value)}
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
            {TTS_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Typing speed (ms / character)</label>
          <input type="number" min={8} max={120} value={typing} onChange={(e) => setTyping(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          <div className="text-[10px] text-muted-foreground mt-0.5">Default 22 — higher = slower</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={save} disabled={busy}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
      </div>

      <div className="border-t border-border pt-3 mb-3">
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">{(name || "Assistant")}'s intro speech (plays on every login)</div>
        <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} rows={3}
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none mb-2" />
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={generateIntroAudio} disabled={genBusy || !introText.trim()}
            className="rounded-full border border-primary/50 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">
            {genBusy ? "Generating…" : "🔊 Generate intro audio"}
          </button>
          {settings.intro_audio_url && <audio controls src={settings.intro_audio_url} className="h-7" />}
        </div>
        {settings.intro_audio_url && <div className="mt-1 text-[10px] text-emerald-400">✓ Stored — plays on login</div>}
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-[11px] font-semibold text-muted-foreground mb-2">System messages</div>
        <div className="space-y-3">
          <SystemMessageField
            title="Going to sleep"
            placeholder="Going to sleep now — wake me up by pressing the green button!"
            hintKey={SYSTEM_SLEEP_KEY}
            defaultLabel="System — Going to sleep"
            hint={sleepHint}
            busy={hintBusy}
            generating={generatingAudioId === sleepHint?.id}
            onSave={onSaveHint}
            onAdd={onAddHint}
            onGenerateAudio={onGenerateAudio}
          />
          <SystemMessageField
            title="Waking up"
            placeholder="I'm awake and ready to help!"
            hintKey={SYSTEM_WAKE_KEY}
            defaultLabel="System — Waking up"
            hint={wakeHint}
            busy={hintBusy}
            generating={generatingAudioId === wakeHint?.id}
            onSave={onSaveHint}
            onAdd={onAddHint}
            onGenerateAudio={onGenerateAudio}
          />
        </div>
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
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none" />
        <div className="text-[10px] text-muted-foreground mt-0.5">Changing the message clears the stored audio — regenerate after saving.</div>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy || !label.trim() || !message.trim()} onClick={() => onSave({ label: label.trim(), message: message.trim() })}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

/** `keyPrefix` locks the group a new hint belongs to — its key is always
 * `${keyPrefix}:${suffix}`, so a hint added from inside a group box can't
 * accidentally land in a different one. Omit it to let the developer type a
 * fully custom key (used for the very first hint in a brand-new group). */
function AddForm({ busy, keyPrefix, initialSuffix, initialLabel, onAdd, onCancel }: { busy: boolean; keyPrefix?: string; initialSuffix?: string; initialLabel?: string; onAdd: (v: { key: string; label: string; message: string }) => void; onCancel: () => void }) {
  const [key, setKey] = useState("");
  const [suffix, setSuffix] = useState(initialSuffix || "");
  const [label, setLabel] = useState(initialLabel || "");
  const [message, setMessage] = useState("");
  const finalKey = keyPrefix ? (suffix.trim() ? `${keyPrefix}:${suffix.trim()}` : "") : key.trim();
  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] text-muted-foreground">Key — must match <code>data-robot-hint-key</code> in the frontend</label>
        {keyPrefix ? (
          <div className="flex items-center rounded-lg border border-border bg-input/40 focus-within:border-ring overflow-hidden">
            <span className="pl-2.5 py-1.5 text-xs text-muted-foreground font-mono select-none">{keyPrefix}:</span>
            <input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="some-new-thing"
              className="min-w-0 flex-1 bg-transparent pr-2.5 py-1.5 text-xs text-foreground focus:outline-none font-mono" />
          </div>
        ) : (
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. field:some-new-thing"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        )}
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none" />
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy || !finalKey || !label.trim() || !message.trim()} onClick={() => onAdd({ key: finalKey, label: label.trim(), message: message.trim() })}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {busy ? "Adding…" : "Add"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

function HintRow({ hint, busy, editing, generating, onEdit, onCancelEdit, onSave, onGenerateAudio, onRemove }: {
  hint: Hint;
  busy: boolean;
  editing: boolean;
  generating: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (v: { label: string; message: string }) => void;
  onGenerateAudio: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      {editing ? (
        <EditForm hint={hint} busy={busy} onCancel={onCancelEdit} onSave={onSave} />
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-foreground">{hint.label}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{hint.key}</code>
              {hint.audio_url ? <span className="text-[10px] text-emerald-400">🔊 audio ready</span> : <span className="text-[10px] text-amber-400">⚠ no audio (uses browser voice)</span>}
            </div>
            <div className="text-[11px] text-muted-foreground">{hint.message}</div>
            {hint.audio_url && <audio controls src={hint.audio_url} className="mt-1.5 h-6" />}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={onEdit} className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">Edit</button>
            <button onClick={onGenerateAudio} disabled={generating}
              className="rounded-full border border-primary/50 px-2.5 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50">
              {generating ? "…" : "🔊 Gen"}
            </button>
            <button onClick={onRemove} className="rounded-full border border-destructive/50 px-2.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10">Del</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One collapsible box per hint group (Navigation, Create Ad, etc.), each
 * with its own "+ Add message" affordance that seeds new hints straight into
 * that group's key prefix. Boxes are meant to sit in a responsive grid —
 * side-by-side on wide screens, stacked on narrow ones. */
/** Compact inline add-form for one specific, fixed hint key — used by
 * the Navigation checklist below where the key is already known (it
 * comes straight from app-shell.tsx's NAV config, not typed by hand),
 * so there's nothing to get wrong or mismatch against
 * data-robot-hint-key in the frontend. */
function FixedKeyAddForm({ fixedKey, initialLabel, busy, onAdd, onCancel }: { fixedKey: string; initialLabel: string; busy: boolean; onAdd: (v: { key: string; label: string; message: string }) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initialLabel);
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground font-mono">{fixedKey}</div>
      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none" />
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy || !label.trim() || !message.trim()} onClick={() => onAdd({ key: fixedKey, label: label.trim(), message: message.trim() })}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
          {busy ? "Adding…" : "Add"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

/** Navigation gets its own checklist instead of the generic GroupBox:
 * every item in app-shell.tsx's NAV — not just ones that already have a
 * saved hint — is listed, so a sidebar entry with no mascot explanation
 * yet (like a newly-added page) is visible as a clear gap here instead
 * of silently having nothing to say when clicked. Existing hints render
 * exactly like any other group's HintRow; missing ones get a compact
 * "+ Add hint" row with the exact required key already filled in. */
function NavHintChecklist({
  navHints, expanded, onToggle, editingId, busy, generatingAudioId,
  addingKey, onStartAdd, onCancelAdd, onAddHint,
  onEdit, onCancelEdit, onSaveHint, onGenerateAudio, onRemove,
}: {
  navHints: Hint[];
  expanded: boolean;
  onToggle: () => void;
  editingId: string | null;
  busy: boolean;
  generatingAudioId: string | null;
  addingKey: string | null;
  onStartAdd: (key: string) => void;
  onCancelAdd: () => void;
  onAddHint: (v: { key: string; label: string; message: string }) => void;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveHint: (id: string, v: { label: string; message: string }) => void;
  onGenerateAudio: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const items = NAV.flatMap((g) => g.items).filter((it) => it.hintKey);
  const missingCount = items.filter((it) => !navHints.some((h) => h.key === it.hintKey)).length;

  return (
    <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-card/60 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          <span className={`inline-block text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
          <span className="text-sm font-semibold text-foreground truncate">Navigation</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{items.length - missingCount}/{items.length}</span>
        </span>
        {missingCount > 0 && <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">{missingCount} missing</span>}
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {items.map((it) => {
            const hint = navHints.find((h) => h.key === it.hintKey);
            if (hint) {
              return (
                <HintRow
                  key={it.hintKey}
                  hint={hint}
                  busy={busy}
                  editing={editingId === hint.id}
                  generating={generatingAudioId === hint.id}
                  onEdit={() => onEdit(hint.id)}
                  onCancelEdit={onCancelEdit}
                  onSave={(v) => onSaveHint(hint.id, v)}
                  onGenerateAudio={() => onGenerateAudio(hint.id)}
                  onRemove={() => onRemove(hint.id)}
                />
              );
            }
            return (
              <div key={it.hintKey} className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-3">
                {addingKey === it.hintKey ? (
                  <FixedKeyAddForm fixedKey={it.hintKey!} initialLabel={it.label} busy={busy} onCancel={onCancelAdd} onAdd={onAddHint} />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-foreground">{it.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{it.hintKey} — no message yet</div>
                    </div>
                    <button onClick={() => onStartAdd(it.hintKey!)} className="shrink-0 rounded-full border border-dashed border-primary/50 px-3 py-1 text-[11px] text-primary hover:bg-primary/5">
                      + Add hint
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupBox({
  prefix, label, hints, expanded, onToggle, editingId, busy, generatingAudioId,
  addingGroup, onStartAdd, onCancelAdd, onAddHint,
  onEdit, onCancelEdit, onSaveHint, onGenerateAudio, onRemove,
}: {
  prefix: string;
  label: string;
  hints: Hint[];
  expanded: boolean;
  onToggle: () => void;
  editingId: string | null;
  busy: boolean;
  generatingAudioId: string | null;
  addingGroup: string | null;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAddHint: (v: { key: string; label: string; message: string }) => void;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveHint: (id: string, v: { label: string; message: string }) => void;
  onGenerateAudio: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const isAdding = addingGroup === prefix;
  return (
    <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-card/60 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          <span className={`inline-block text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
          <span className="text-sm font-semibold text-foreground truncate">{label}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{hints.length}</span>
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="mb-3">
            {isAdding ? (
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <AddForm busy={busy} keyPrefix={prefix} onCancel={onCancelAdd} onAdd={onAddHint} />
              </div>
            ) : (
              <button onClick={onStartAdd}
                className="rounded-full border border-dashed border-primary/50 px-3 py-1 text-[11px] text-primary hover:bg-primary/5">
                + Add message
              </button>
            )}
          </div>
          <div className="space-y-2">
            {hints.map((h) => (
              <HintRow
                key={h.id}
                hint={h}
                busy={busy}
                editing={editingId === h.id}
                generating={generatingAudioId === h.id}
                onEdit={() => onEdit(h.id)}
                onCancelEdit={onCancelEdit}
                onSave={(v) => onSaveHint(h.id, v)}
                onGenerateAudio={() => onGenerateAudio(h.id)}
                onRemove={() => onRemove(h.id)}
              />
            ))}
            {hints.length === 0 && <div className="text-[11px] text-muted-foreground">No messages in this group yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function DeveloperAssistant() {
  const allowed = useRequireDeveloperPermission("assistant");
  const handleAuthError = useDevAuthErrorHandler();
  const [hints, setHints] = useState<Hint[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatingAudioId, setGeneratingAudioId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  const [addingNavKey, setAddingNavKey] = useState<string | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);

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
    try { setHints(await devApi("/developer/assistant-hints", { method: "POST", body: v })); setAddingGroup(null); setShowNewGroup(false); }
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

  // System hints (sleep/wake) are edited inline in the settings card above,
  // not shown as part of the grouped hint-message list below.
  const sleepHint = hints?.find((h) => h.key === SYSTEM_SLEEP_KEY);
  const wakeHint = hints?.find((h) => h.key === SYSTEM_WAKE_KEY);

  const groups = useMemo(() => {
    if (!hints) return [];
    const rest = hints.filter((h) => h.key !== SYSTEM_SLEEP_KEY && h.key !== SYSTEM_WAKE_KEY && !h.key.startsWith("nav:"));
    const byPrefix = new Map<string, Hint[]>();
    for (const h of rest) {
      const prefix = h.key.includes(":") ? h.key.split(":")[0] : "other";
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix)!.push(h);
    }
    // Stable, sensible ordering: Navigation, Create Ad, then anything else alphabetically.
    const order = ["nav", "field"];
    return Array.from(byPrefix.entries())
      .sort(([a], [b]) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return a.localeCompare(b);
      })
      .map(([prefix, groupHints]) => ({ prefix, label: groupLabelFor(prefix), hints: groupHints }));
  }, [hints]);

  function isExpanded(prefix: string) {
    return expandedGroups[prefix] ?? true; // default open
  }
  function toggleGroup(prefix: string) {
    setExpandedGroups((m) => ({ ...m, [prefix]: !isExpanded(prefix) }));
  }

  if (!allowed) return null;
  if (!hints || !settings) return <DeveloperShell title="Assistant"><div className="text-xs text-muted-foreground">Loading…</div></DeveloperShell>;

  return (
    <DeveloperShell title="Assistant">
      <p className="mb-6 max-w-2xl text-xs text-muted-foreground">
        Configure {settings.assistant_name || "your assistant"}'s name, typing speed, TTS voice, and the explanation messages it says at each hinted UI element.
        Generate audio per-hint — before audio is generated it speaks via the browser's built-in Speech Synthesis.
      </p>

      <SettingsCard
        settings={settings}
        onSave={setSettings}
        sleepHint={sleepHint}
        wakeHint={wakeHint}
        hintBusy={busy}
        generatingAudioId={generatingAudioId}
        onSaveHint={save}
        onAddHint={add}
        onGenerateAudio={generateAudio}
      />

      <div className="text-sm font-semibold text-foreground mb-3">Hint messages</div>
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <NavHintChecklist
          navHints={hints.filter((h) => h.key.startsWith("nav:"))}
          expanded={isExpanded("nav")}
          onToggle={() => toggleGroup("nav")}
          editingId={editingId}
          busy={busy}
          generatingAudioId={generatingAudioId}
          addingKey={addingNavKey}
          onStartAdd={setAddingNavKey}
          onCancelAdd={() => setAddingNavKey(null)}
          onAddHint={async (v) => { await add(v); setAddingNavKey(null); }}
          onEdit={setEditingId}
          onCancelEdit={() => setEditingId(null)}
          onSaveHint={save}
          onGenerateAudio={generateAudio}
          onRemove={remove}
        />
        {groups.map((g) => (
          <GroupBox
            key={g.prefix}
            prefix={g.prefix}
            label={g.label}
            hints={g.hints}
            expanded={isExpanded(g.prefix)}
            onToggle={() => toggleGroup(g.prefix)}
            editingId={editingId}
            busy={busy}
            generatingAudioId={generatingAudioId}
            addingGroup={addingGroup}
            onStartAdd={() => setAddingGroup(g.prefix)}
            onCancelAdd={() => setAddingGroup(null)}
            onAddHint={add}
            onEdit={setEditingId}
            onCancelEdit={() => setEditingId(null)}
            onSaveHint={save}
            onGenerateAudio={generateAudio}
            onRemove={remove}
          />
        ))}
      </div>

      {showNewGroup ? (
        <div className="max-w-2xl rounded-xl border border-border bg-card/60 p-3">
          <AddForm busy={busy} onCancel={() => setShowNewGroup(false)} onAdd={add} />
        </div>
      ) : (
        <button onClick={() => setShowNewGroup(true)} className="rounded-full border border-dashed border-primary/50 px-4 py-1.5 text-xs text-primary hover:bg-primary/5">
          + Add message in a new group
        </button>
      )}
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
    </DeveloperShell>
  );
}
