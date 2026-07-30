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

function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
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
  if (action === "email.bounce_suppressed") return <span className="text-orange-500 text-[11px] font-medium">Hard bounce suppressed</span>;
  if (action === "email.soft_bounce") return <span className="text-yellow-600 dark:text-yellow-400 text-[11px] font-medium">Soft bounce (logged)</span>;
  if (action === "email.complaint_suppressed") return <span className="text-destructive text-[11px] font-medium">Complaint suppressed</span>;
  if (action === "email.suppression_removed") return <span className="text-green-500 text-[11px] font-medium">Suppression removed</span>;
  if (action === "email.manually_suppressed") return <span className="text-muted-foreground text-[11px] font-medium">Manually suppressed</span>;
  return <span className="text-muted-foreground text-[11px]">{action}</span>;
}

// ── AWS SES rates info panel ──────────────────────────────────────────────────

function SesRatesPanel({ bounces, complaints, total }: { bounces: number; complaints: number; total: number }) {
  // AWS SES guidelines: bounce < 5% (warning at 2%), complaint < 0.1% (warning at 0.08%)
  // We can't compute true rates without knowing total sends, so we show the raw counts
  // with colour-coded thresholds and link to the SES console for real rates.
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-sm text-foreground">AWS SES Sending Reputation</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            AWS requires bounce rate &lt;5% and complaint rate &lt;0.1%. Check real-time rates in the SES console.
          </p>
        </div>
        <a
          href="https://ap-northeast-1.console.aws.amazon.com/ses/home?region=ap-northeast-1#/account"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ring hover:text-foreground transition"
        >
          SES Console ↗
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={`rounded-lg p-3 border ${bounces === 0 ? "border-green-500/20 bg-green-500/5" : bounces < 10 ? "border-yellow-500/20 bg-yellow-500/5" : "border-destructive/20 bg-destructive/5"}`}>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hard bounces suppressed</div>
          <div className={`text-2xl font-bold mt-1 ${bounces === 0 ? "text-green-600 dark:text-green-400" : bounces < 10 ? "text-yellow-600 dark:text-yellow-400" : "text-destructive"}`}>
            {bounces}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">AWS threshold: &lt;5% of total sends</div>
        </div>
        <div className={`rounded-lg p-3 border ${complaints === 0 ? "border-green-500/20 bg-green-500/5" : "border-destructive/20 bg-destructive/5"}`}>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spam complaints suppressed</div>
          <div className={`text-2xl font-bold mt-1 ${complaints === 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
            {complaints}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">AWS threshold: &lt;0.1% of total sends</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
        💡 These counts reflect permanent suppressions only. View real-time bounce/complaint <em>rates</em> (as a % of all sends)
        in the SES console under <strong>Account dashboard → Sending statistics</strong>. NivaSpark auto-suppresses
        every hard bounce and spam complaint the moment AWS notifies us via SNS.
      </div>
    </div>
  );
}

// ── Setup Guide ───────────────────────────────────────────────────────────────

function SetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-foreground">AWS SNS → Bounce/Complaint Pipeline</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Connect AWS SES to this endpoint to automatically suppress hard bounces and complaints.
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
            <div className="text-muted-foreground">AWS will call this URL to confirm — the endpoint auto-confirms it and verifies the SNS signature.</div>
          </div>

          <div className="rounded-lg bg-muted/60 p-3 space-y-2">
            <div className="font-semibold text-foreground">Step 3 — Connect SES to the topic</div>
            <div>AWS SES → Verified Identities → nivatier.com → Notifications tab</div>
            <div>Bounce notifications → Edit → select <code className="bg-muted px-1 rounded">nivaspark-ses-events</code></div>
            <div>Complaint notifications → Edit → select <code className="bg-muted px-1 rounded">nivaspark-ses-events</code></div>
          </div>

          <div className="rounded-lg bg-muted/60 p-3 space-y-2">
            <div className="font-semibold text-foreground">Step 4 — Verify it's working</div>
            <div>Use the <a href="https://ap-northeast-1.console.aws.amazon.com/ses/home?region=ap-northeast-1#/simulator" target="_blank" rel="noopener noreferrer" className="underline">SES mailbox simulator</a> to send a test bounce:</div>
            <div>Send to <code className="bg-muted px-1 rounded">bounce@simulator.amazonses.com</code> — the address should appear in the suppression list within seconds.</div>
          </div>

          <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3">
            <div className="font-semibold text-green-600 dark:text-green-400">How it works</div>
            <div className="text-muted-foreground mt-1">
              Every <strong>hard bounce</strong> (Permanent) is permanently added to the suppression list.
              <strong> Soft bounces</strong> (Transient — mailbox full, temporary failure) are logged in the audit trail but <em>not</em> suppressed, because the address is still valid.
              Every <strong>spam complaint</strong> is permanently suppressed.
              All SNS messages are signature-verified before any action is taken.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manual Add Suppression ────────────────────────────────────────────────────

function ManualSuppress({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState<"bounce" | "complaint">("bounce");
  const [state, setState] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function add() {
    const addr = email.trim().toLowerCase();
    if (!addr || !addr.includes("@")) { setMsg("Enter a valid email"); setState("error"); return; }
    setState("saving");
    setMsg("");
    try {
      await devApi("/developer/email-suppressions", { method: "POST", body: JSON.stringify({ email: addr, reason }) });
      setEmail("");
      setState("ok");
      setMsg(`${addr} suppressed.`);
      onAdded();
      setTimeout(() => { setState("idle"); setMsg(""); setOpen(false); }, 1800);
    } catch (e: any) {
      setState("error");
      setMsg(e.message || "Could not add suppression");
    }
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ring hover:text-foreground transition"
    >
      + Add manually
    </button>
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="email"
        placeholder="address@example.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === "Enter" && add()}
        autoFocus
        className="rounded-lg border border-border bg-input/40 px-2.5 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none w-52"
      />
      <select
        value={reason}
        onChange={e => setReason(e.target.value as "bounce" | "complaint")}
        className="rounded-lg border border-border bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none"
      >
        <option value="bounce">Hard bounce</option>
        <option value="complaint">Complaint</option>
      </select>
      <button
        onClick={add}
        disabled={state === "saving"}
        className="rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
      >
        {state === "saving" ? "Saving…" : "Add"}
      </button>
      <button
        onClick={() => { setOpen(false); setEmail(""); setState("idle"); setMsg(""); }}
        className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ring transition"
      >
        Cancel
      </button>
      {msg && (
        <span className={`text-[11px] ${state === "ok" ? "text-green-500" : "text-destructive"}`}>{msg}</span>
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
  const [filterReason, setFilterReason] = useState<"all" | "bounce" | "complaint">("all");

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

  const filtered = (data?.suppressions ?? []).filter(s => {
    const matchSearch = s.email.toLowerCase().includes(search.toLowerCase());
    const matchReason = filterReason === "all" || s.reason === filterReason;
    return matchSearch && matchReason;
  });

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="font-semibold text-sm text-foreground">
          Suppressed Addresses
          {data && <span className="ml-2 text-[11px] font-normal text-muted-foreground">({data.total} total)</span>}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <ManualSuppress onAdded={load} />
          <select
            value={filterReason}
            onChange={e => setFilterReason(e.target.value as any)}
            className="rounded-lg border border-border bg-input/40 px-2 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none"
          >
            <option value="all">All reasons</option>
            <option value="bounce">Hard bounces</option>
            <option value="complaint">Complaints</option>
          </select>
          <input
            type="text"
            placeholder="Search email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded-lg border border-border bg-input/40 px-3 py-1.5 text-[11px] text-foreground focus:border-ring focus:outline-none w-44"
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
                      ? `${s.detail?.bounce_type || ""} ${s.detail?.bounce_subtype || ""}`.trim() || s.detail?.added_by || "—"
                      : s.detail?.feedback_type || s.detail?.added_by || "—"
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

      {(search || filterReason !== "all") && filtered.length === 0 && data && data.total > 0 && (
        <div className="text-center py-6 text-muted-foreground text-[11px]">
          No results for current filters
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
              {e.action === "email.soft_bounce" && e.detail?.bounce_subtype && (
                <span className="text-[10px] text-muted-foreground">
                  ({e.detail.bounce_subtype})
                </span>
              )}
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
              sub="permanent — never re-emailed"
            />
            <StatCard
              label="Hard bounces"
              value={health.bounces}
              color={health.bounces > 0 ? "text-orange-600 dark:text-orange-400" : "text-foreground"}
              sub="invalid / non-existent address"
            />
            <StatCard
              label="Complaints"
              value={health.complaints}
              color={health.complaints > 0 ? "text-destructive" : "text-foreground"}
              sub="spam reports via feedback loop"
            />
          </div>
        )}

        {/* Reputation guidance */}
        {health && (
          <SesRatesPanel
            bounces={health.bounces}
            complaints={health.complaints}
            total={health.total_suppressed}
          />
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
