import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel } from "@/components/app-shell";
import { api } from "@/lib/api";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/connections")({
  component: Connections,
  head: () => ({ meta: [{ title: "Connections — NivaAd" }] }),
});

const CONNECTION_META: Record<string, { initials: string; color: string }> = {
  linkedin_personal: { initials: "IN", color: "from-sky-600 to-sky-800" },
  linkedin_company: { initials: "IN", color: "from-sky-700 to-sky-900" },
  instagram: { initials: "IG", color: "from-pink-500 to-orange-400" },
  facebook: { initials: "FB", color: "from-blue-500 to-blue-700" },
  tiktok: { initials: "TT", color: "from-cyan-400 to-fuchsia-500" },
  x: { initials: "X", color: "from-neutral-700 to-neutral-900" },
  threads: { initials: "TH", color: "from-neutral-800 to-black" },
};

// Only platforms with a real backend route so far — an explicit
// per-platform mapping (not a generic /connections/{id}/connect guess)
// so adding a platform in Developer > Platforms without its
// integration code yet can never silently hit a 404 here; the
// "Coming soon" button is disabled for anything not in this map.
const BUILT_ROUTES: Record<string, string> = {
  linkedin_personal: "/connections/linkedin_personal/connect",
};

function Connections() {
  const allowed = useRequireCapability("admin-only");

  const [connections, setConnections] = useState<{ platform: string; status: string; connected_at: string | null }[] | null>(null);
  const [available, setAvailable] = useState<Record<string, { label: string; built: boolean; video_ratio: string }>>({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [conns, avail] = await Promise.all([api("/connections"), api("/connections/available")]);
      setConnections(conns);
      setAvailable(Object.fromEntries(avail.map((p: { id: string; label: string; built: boolean; video_ratio: string }) => [p.id, { label: p.label, built: p.built, video_ratio: p.video_ratio }])));
    } catch (e: any) {
      setErr(e.message || "Could not load connections");
    }
  }

  useEffect(() => {
    if (!allowed) return;
    // Pick up the redirect straight back from a platform's OAuth
    // callback (the backend redirects the browser here) once, then
    // clean the URL so a page refresh doesn't re-show the same message.
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("connection_error");
    if (connected) setMsg(`✓ Connected successfully.`);
    if (error) setErr(decodeURIComponent(error));
    if (connected || error) window.history.replaceState({}, "", window.location.pathname);
    load();
  }, [allowed]);

  async function connect(platform: string) {
    const route = BUILT_ROUTES[platform];
    if (!route) return;
    setBusy(platform); setErr(""); setMsg("");
    try {
      const res = await api(route);
      window.location.href = res.authorize_url; // full navigation to the platform's own consent screen, not a fetch
    } catch (e: any) {
      setErr(e.message || `Could not start the connection`);
      setBusy(null);
    }
  }

  async function disconnect(platform: string) {
    if (!confirm(`Disconnect ${available[platform]?.label || platform}? Scheduled posts to this platform will fail until you reconnect.`)) return;
    setBusy(platform); setErr(""); setMsg("");
    try {
      await api(`/connections/${platform}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setErr(e.message || "Could not disconnect");
    }
    setBusy(null);
  }

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  return (
    <AppShell eyebrow="Setup" title="Connections">
      <div className="max-w-2xl">
        <Panel>
          <div className="mb-1 text-sm font-semibold text-foreground">🔗 Platform connections</div>
          <p className="mb-4 text-xs text-muted-foreground">
            Connect your company's own social accounts so ads can actually publish, not just get marked posted. Only admins can connect or disconnect — credentials for these platforms are managed by the developer, never visible here.
          </p>
          {msg && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">{msg}</div>}
          {err && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{err}</div>}
          {!connections ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : connections.length === 0 ? (
            <div className="text-xs text-muted-foreground">No platforms have been configured by the developer yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {connections.map((c) => {
                const meta = CONNECTION_META[c.platform];
                const built = available[c.platform]?.built ?? false;
                const isConnected = c.status === "connected";
                return (
                  <li key={c.platform} className={`flex items-center justify-between py-3 ${built ? "" : "opacity-50"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br ${meta?.color || "from-slate-500 to-slate-700"} text-xs font-bold text-white`}>{meta?.initials || c.platform.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground">{available[c.platform]?.label || c.platform}</span>
                          {available[c.platform]?.video_ratio && (
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Posts at {available[c.platform].video_ratio}</span>
                          )}
                        </div>
                        {isConnected && <div className="text-[11px] text-emerald-400">✓ Connected{c.connected_at ? ` ${new Date(c.connected_at).toLocaleDateString()}` : ""}</div>}
                        {!built && <div className="text-[11px] text-muted-foreground">Coming soon</div>}
                      </div>
                    </div>
                    {built ? (
                      isConnected ? (
                        <button disabled={busy === c.platform} onClick={() => disconnect(c.platform)} className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive disabled:opacity-50">
                          {busy === c.platform ? "…" : "Disconnect"}
                        </button>
                      ) : (
                        <button disabled={busy === c.platform} onClick={() => connect(c.platform)} className="rounded-full bg-gold-gradient px-3 py-1 text-xs font-semibold text-background disabled:opacity-50">
                          {busy === c.platform ? "Connecting…" : "Connect"}
                        </button>
                      )
                    ) : (
                      <button disabled className="rounded-full border border-border px-3 py-1 text-xs">Connect</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
