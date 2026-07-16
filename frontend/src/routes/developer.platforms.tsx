import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi, type PlatformIntegration } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/platforms")({
  component: DeveloperPlatforms,
  head: () => ({ meta: [{ title: "Platforms — NivaAd Developer" }] }),
});

function PlatformRow({ entry, onSave, onDelete }: {
  entry: PlatformIntegration;
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(entry.label);
  const [clientId, setClientId] = useState(entry.client_id);
  const [clientSecret, setClientSecret] = useState(""); // never pre-filled — the real secret is never sent back from the server once saved
  const [scope, setScope] = useState(entry.scope || "");
  const [redirectUri, setRedirectUri] = useState(entry.redirect_uri || "");
  const [videoRatio, setVideoRatio] = useState(entry.video_ratio || "1:1");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = { label: label.trim(), client_id: clientId.trim(), scope: scope.trim() || null, redirect_uri: redirectUri.trim() || null, video_ratio: videoRatio };
    if (clientSecret.trim()) body.client_secret = clientSecret.trim(); // omit entirely if left blank — keeps the existing secret unchanged
    await onSave(entry.id, body);
    setSaving(false);
    setClientSecret("");
    setEditing(false);
  }

  async function toggleEnabled() {
    setTogglingEnabled(true);
    await onSave(entry.id, { enabled: !entry.enabled });
    setTogglingEnabled(false);
  }

  async function remove() {
    if (!confirm(`Remove ${entry.label}? Any company connected to it will need to reconnect if you add it back later.`)) return;
    setDeleting(true);
    await onDelete(entry.id);
    setDeleting(false);
  }

  return (
    <div className={`rounded-lg border border-slate-700/50 bg-background/40 p-3 ${!entry.enabled ? "opacity-50" : ""}`}>
      {editing ? (
        <div className="space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. LinkedIn" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" placeholder={entry.has_secret ? "Leave blank to keep the current secret" : "Client Secret"} className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder="Redirect URI, e.g. http://localhost:8000/connections/linkedin/callback" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="OAuth scope, e.g. openid profile w_member_social" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
          <div>
            <div className="mb-1 text-[10px] text-muted-foreground">Video posting ratio — what the reframe pipeline treats as this platform's required format</div>
            <select value={videoRatio} onChange={(e) => setVideoRatio(e.target.value)} className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none">
              {["1:1", "9:16", "16:9", "1.91:1", "4:5"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={saving || !label.trim() || !clientId.trim()} onClick={save} className="rounded-full bg-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setClientSecret(""); }} className="rounded-full border border-slate-700/50 px-3 py-1 text-[11px] text-muted-foreground">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">
              {entry.label}
              {!entry.built && <span className="ml-2 rounded-full bg-amber-900/40 px-2 py-0.5 text-[9px] font-normal text-amber-400">NO INTEGRATION CODE YET</span>}
              {!entry.enabled && <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[9px] font-normal text-slate-300">DISABLED</span>}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">Client ID: {entry.client_id || "—"} · Secret: {entry.has_secret ? "✓ set" : "not set"} · Ratio: {entry.video_ratio || "1:1"}</div>
            {entry.redirect_uri && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">Redirect: {entry.redirect_uri}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button disabled={togglingEnabled} onClick={toggleEnabled} title={entry.enabled ? "Disable — hide from every company's Connect list" : "Enable — offer this to companies again"}
              className={`text-[11px] disabled:opacity-50 ${entry.enabled ? "text-slate-400 hover:text-foreground" : "text-emerald-400 hover:text-emerald-300"}`}>
              {togglingEnabled ? "…" : entry.enabled ? "Disable" : "Enable"}
            </button>
            <button onClick={() => setEditing(true)} className="text-[11px] text-slate-400 hover:text-foreground">Edit</button>
            <button disabled={deleting} onClick={remove} className="text-[11px] text-destructive hover:text-destructive/80 disabled:opacity-30">{deleting ? "…" : "Remove"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPlatformForm({ onAdd }: { onAdd: (body: Record<string, unknown>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [scope, setScope] = useState("");
  const [videoRatio, setVideoRatio] = useState("1:1");
  const [saving, setSaving] = useState(false);

  async function add() {
    setSaving(true);
    await onAdd({
      id: id.trim().toLowerCase(), label: label.trim(), client_id: clientId.trim(), client_secret: clientSecret.trim(),
      redirect_uri: redirectUri.trim() || null, scope: scope.trim() || null, video_ratio: videoRatio,
    });
    setSaving(false);
    setId(""); setLabel(""); setClientId(""); setClientSecret(""); setRedirectUri(""); setScope(""); setVideoRatio("1:1");
    setOpen(false);
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="w-full rounded-lg border border-dashed border-slate-700/60 py-2.5 text-xs text-muted-foreground hover:border-slate-500 hover:text-foreground">＋ Add platform</button>;
  }
  return (
    <div className="rounded-lg border border-slate-600 bg-background/60 p-3 space-y-2">
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Platform id (lowercase, e.g. linkedin, tiktok)" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label shown to developers, e.g. LinkedIn" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" placeholder="Client Secret" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder="Redirect URI (must match what's registered with the platform)" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="OAuth scope" className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none" />
      <div>
        <div className="mb-1 text-[10px] text-muted-foreground">Video posting ratio</div>
        <select value={videoRatio} onChange={(e) => setVideoRatio(e.target.value)} className="w-full rounded-lg border border-slate-700/50 bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none">
          {["1:1", "9:16", "16:9", "1.91:1", "4:5"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={saving || !id.trim() || !label.trim() || !clientId.trim() || !clientSecret.trim()} onClick={add} className="rounded-full bg-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
        <button onClick={() => setOpen(false)} className="rounded-full border border-slate-700/50 px-3 py-1 text-[11px] text-muted-foreground">Cancel</button>
      </div>
    </div>
  );
}

function DeveloperPlatforms() {
  const allowed = useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();

  const [platforms, setPlatforms] = useState<PlatformIntegration[] | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setPlatforms(await devApi("/developer/platforms"));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load platforms");
    }
  }
  useEffect(() => { if (allowed) load(); }, [allowed]);

  async function handleAdd(body: Record<string, unknown>) {
    setErr("");
    try {
      setPlatforms(await devApi("/developer/platforms", { method: "POST", body }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add platform");
    }
  }

  async function handleSave(id: string, body: Record<string, unknown>) {
    setErr("");
    try {
      setPlatforms(await devApi(`/developer/platforms/${id}`, { method: "PUT", body }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
  }

  async function handleDelete(id: string) {
    setErr("");
    try {
      setPlatforms(await devApi(`/developer/platforms/${id}`, { method: "DELETE" }));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not remove");
    }
  }

  if (!allowed) return null;

  return (
    <DeveloperShell title="Platforms">
      <p className="mb-6 text-sm text-muted-foreground">
        Manage posting platform credentials here — client IDs and secrets never touch a company admin's screen, only the connect/disconnect status does, in their own Admin page. Enable/disable controls whether a platform is offered to companies at all, without deleting its credentials. Only platforms with real integration code (currently just LinkedIn) actually do anything once a company connects — adding others here holds a place for credentials ahead of that code being built.
      </p>
      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}
      {!platforms ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="max-w-2xl space-y-2">
          {platforms.map((p) => <PlatformRow key={p.id} entry={p} onSave={handleSave} onDelete={handleDelete} />)}
          <AddPlatformForm onAdd={handleAdd} />
        </div>
      )}
    </DeveloperShell>
  );
}
