import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/email")({
  component: DeveloperEmail,
  head: () => ({ meta: [{ title: "Email Health — NivaSpark" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Suppression = {
  id: number;
  email: string;
  reason: "bounce" | "complaint";
  detail: Record<string, any>;
  created_at: string;
};

type SuppressionList = {
  total: number;
  bounces: number;
  complaints: number;
  suppressions: Suppression[];
};

type EmailHealth = {
  total_suppressed: number;
  bounces: number;
  complaints: number;
  recent_events: { action: string; detail: Record<string, any>; created_at: string }[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ReasonBadge({ reason }: { reason: string }) {
  if (reason === "bounce") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-orange-600 dark:text-orange-400">
      ↩ Hard bounce
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-semibold text-destructive">
      🚩 Complaint
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  if (action === "email.bounce_suppressed") return <span className="text-orange-500 text-[11px] font-medium">Bounce suppressed</span>;
  if (action === "email.complaint_suppressed") return <span className="text-destructive text-[11px] font-medium">Complaint suppressed</span>;
  if (action === "email.suppression_removed") return <span className="text-green-500 text-[11px] font-medium">Suppression removed</span>;
  return <span className="text-muted-foreground text-[11px]">{action}</span>;
}

// ── Setup Guide ───────────────────────────────────────────────────────────────

function SetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-foreground">AWS SNS Setup</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Connect AWS SES to this endpoint to automatically track bounces and complaints.
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ring transition"
        >
          {open ? "Hide" : "Show setup steps"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3 text-[12px] text-foreground/80">
          <div className="rounded-lg bg-muted/60 p-3 space-y-2">
            <div className="font-semibold text-foreground">Step 1 — Create SNS Topic</div>
            <div>AWS Console → SNS → Topics → Create topic</div>
            <div>Type: <code className="bg-muted px-1 rounded">Standard</code> &nbsp;|&nbsp; Name: <code className="bg-muted px-1 rounded">nivaspark-ses-events</code></div>
          </div>

          <div className="rounded-lg bg-muted/60 p-3 space-y-2">
            <div className="font-semibold text-foreground">Step 2 — Subscribe this endpoint</div>
            <div>SNS → nivaspark-ses-events → Create subscription</div>
            <div>Protocol: <code className="bg-muted px-1 rounded">HTTPS</code></div>
            <div>Endpoint:</div>
            <code className="block bg-muted px-2 py-1 rounded text-[11px] break-all">
              https://nivaad-production.up.railway.app/webhooks/ses
            </code>
            <div className="text-muted-foreground">AWS will call this URL to confirm — the endpoint auto-confirms it.</div>
          </div>

          <div className="rounded-lg bg-muted/60 p-3 space-y-2">
            <div className="font-semibold text-foreground">Step 3 — Connect SES to the topic</div>
            <div>AWS SES → Verified Identities → nivatier.com → Notifications tab</div>
            <div>Bounce notifications → Edit → select <code className="bg-muted px-1 rounded">nivaspark-ses-events</code></div>
            <div>Complaint notifications → Edit → select <code className="bg-muted px-1 rounded">nivaspark-ses-events</code></div>
          </div>

          <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3">
            <div className="font-semibold text-green-600 dark:text-green-400">That's it</div>
            <div className="text-muted-foreground mt-1">
              From this point, every hard bounce and spam complaint automatically adds the address to the suppression list below. NivaSpark will never email a suppressed address again.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Suppression Table ─────────────────────────────────────────────────────────

function SuppressionTable({ handleAuthError }: { handleAuthError: (e: any) => boolean }) {
  const [data, setData] = useState<SuppressionList | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [removing, setRemoving] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  function load() {
    setLoading(true);
    devApi("/developer/email-suppressions")
      .then(setData)
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load suppressions"); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function remove(id: number, email: string) {
    if (!confirm(`Remove suppression for ${email}? They will be able to receive emails again.`)) return;
    setRemoving(id);
    try {
      await devApi(`/developer/email-suppressions/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      if (!handleAuthError(e)) alert(e.message || "Could not remove");
    }
    setRemoving(null);
  }

  const filtered = data?.suppressions.filter(s =>
    s.email.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-semibold text-sm text-foreground">
          Suppressed Addresses
          {data && <span className="ml-2 text-[11px] font-normal text-muted-foreground">({data.total} total)</span>}
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded-lg border border-border bg-input/40 px-3 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none w-48"
          />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ring disabled:opacity-50 transition"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {err && <div className="text-[11px] text-destructive mb-3">{err}</div>}

      {data?.total === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          ✅ No suppressed addresses — great sender reputation!
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Reason</th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Detail</th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-foreground">{s.email}</td>
                  <td className="px-3 py-2"><ReasonBadge reason={s.reason} /></td>
                  <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                    {s.reason === "bounce"
                      ? `${s.detail?.bounce_type || ""} ${s.detail?.bounce_subtype || ""}`.trim() || "—"
                      : s.detail?.feedback_type || "—"
                    }
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => remove(s.id, s.email)}
                      disabled={removing === s.id}
                      className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50 transition"
                    >
                      {removing === s.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {search && filtered.length === 0 && data && data.total > 0 && (
        <div className="text-center py-6 text-muted-foreground text-[11px]">
          No results for "{search}"
        </div>
      )}
    </div>
  );
}

// ── Recent Events ─────────────────────────────────────────────────────────────

function RecentEvents({ events }: { events: { action: string; detail: Record<string, any>; created_at: string }[] }) {
  if (events.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <h3 className="font-semibold text-sm text-foreground mb-4">Recent Activity</h3>
      <div className="space-y-2">
        {events.map((e, i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <ActionBadge action={e.action} />
              <span className="font-mono text-[11px] text-foreground truncate">
                {e.detail?.email || "—"}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {new Date(e.created_at).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function DeveloperEmail() {
  useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();
  const [health, setHealth] = useState<EmailHealth | null>(null);

  useEffect(() => {
    devApi("/developer/email-health")
      .then(setHealth)
      .catch(() => {});
  }, []);

  return (
    <DeveloperShell title="Email Health">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-foreground">Email Health</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor bounce and complaint rates. Suppressed addresses are never emailed again.
          </p>
        </div>

        {/* Stats */}
        {health && (
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="Total suppressed"
              value={health.total_suppressed}
              color={health.total_suppressed > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"}
            />
            <StatCard
              label="Hard bounces"
              value={health.bounces}
              color={health.bounces > 0 ? "text-orange-600 dark:text-orange-400" : "text-foreground"}
            />
            <StatCard
              label="Complaints"
              value={health.complaints}
              color={health.complaints > 0 ? "text-destructive" : "text-foreground"}
            />
          </div>
        )}

        {/* AWS SNS setup guide */}
        <SetupGuide />

        {/* Suppression table */}
        <SuppressionTable handleAuthError={handleAuthError} />

        {/* Recent events */}
        {health && <RecentEvents events={health.recent_events} />}

      </div>
    </DeveloperShell>
  );
}
