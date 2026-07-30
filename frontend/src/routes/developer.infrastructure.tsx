import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/infrastructure")({
  component: DeveloperInfrastructure,
  head: () => ({ meta: [{ title: "Infrastructure — NivaSpark" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceStatus = {
  status: "ok" | "error" | "checking";
  latency_ms: number | null;
  detail: string;
  // database-specific
  migration_head?: string | null;
  migration_current?: string | null;
  migrations_current?: boolean;
  // redis-specific
  queue_depth?: number | null;
  // openrouter-specific
  credits_remaining?: number | null;
  // smtp-specific
  auth_mode?: string | null;
};

type InfraStatus = {
  checked_at: string;
  services: {
    database: ServiceStatus;
    redis: ServiceStatus;
    storage: ServiceStatus;
    openrouter: ServiceStatus;
    smtp: ServiceStatus;
  };
};

type Migration = {
  revision: string;
  down_revision: string | null;
  description: string;
  create_date: string | null;
  filename: string;
  applied: boolean;
};

type MigrationHistory = {
  current_revision: string;
  total: number;
  applied: number;
  pending: number;
  migrations: Migration[];
  error?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const SERVICE_META: Record<string, { label: string; icon: string; description: string }> = {
  database:   { label: "PostgreSQL",  icon: "🗄",  description: "Primary database — stores all app data" },
  redis:      { label: "Redis",       icon: "⚡",  description: "Task broker + result backend for Celery" },
  storage:    { label: "S3 / R2",     icon: "🪣",  description: "Object storage for generated media" },
  openrouter: { label: "OpenRouter",  icon: "🤖",  description: "AI gateway for image, video, and text generation" },
  smtp:       { label: "SMTP",        icon: "📧",  description: "Transactional email — AWS SES Tokyo (STARTTLS + auth)" },
};

function StatusBadge({ status }: { status: "ok" | "error" | "checking" }) {
  if (status === "checking") return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
      Checking…
    </span>
  );
  if (status === "ok") return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-[11px] font-semibold text-green-600 dark:text-green-400">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Healthy
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      Error
    </span>
  );
}

function LatencyPill({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  const color = ms < 100 ? "text-green-600 dark:text-green-400" : ms < 500 ? "text-yellow-600 dark:text-yellow-400" : "text-destructive";
  return <span className={`text-[11px] font-mono ${color}`}>{ms}ms</span>;
}

// ── SMTP Test Widget (inline in the SMTP card) ────────────────────────────────

function SmtpTestWidget() {
  const [to, setTo] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function send() {
    const addr = to.trim().toLowerCase();
    if (!addr || !addr.includes("@")) { setMsg("Enter a valid email address"); setState("error"); return; }
    setState("sending");
    setMsg("");
    try {
      await devApi("/developer/smtp-test", { method: "POST", body: JSON.stringify({ to: addr }) });
      setMsg(`Test email sent to ${addr} — check the inbox.`);
      setState("ok");
    } catch (e: any) {
      setMsg(e.message || "Send failed");
      setState("error");
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Send test email</div>
      <div className="flex items-center gap-2">
        <input
          type="email"
          placeholder="you@example.com"
          value={to}
          onChange={e => setTo(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          disabled={state === "sending"}
          className="flex-1 rounded-lg border border-border bg-input/40 px-2.5 py-1 text-[11px] text-foreground focus:border-ring focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={state === "sending"}
          className="rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition shrink-0"
        >
          {state === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
      {msg && (
        <div className={`mt-1.5 text-[11px] ${state === "ok" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
          {state === "ok" ? "✓ " : "✗ "}{msg}
        </div>
      )}
    </div>
  );
}

function ServiceCard({ id, svc }: { id: string; svc: ServiceStatus }) {
  const meta = SERVICE_META[id] ?? { label: id, icon: "⚙️", description: "" };

  return (
    <div className={`rounded-xl border p-5 transition-colors ${
      svc.status === "ok" ? "border-border bg-card/60" :
      svc.status === "error" ? "border-destructive/40 bg-destructive/5" :
      "border-border bg-card/40"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl shrink-0">{meta.icon}</span>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-foreground">{meta.label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{meta.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <LatencyPill ms={svc.latency_ms} />
          <StatusBadge status={svc.status} />
        </div>
      </div>

      {/* Detail line */}
      {svc.status !== "checking" && (
        <div className={`mt-3 text-[11px] font-mono rounded-md px-3 py-2 ${
          svc.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
        }`}>
          {svc.detail}
        </div>
      )}

      {/* Database-specific extras */}
      {id === "database" && svc.status === "ok" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Applied revision</div>
            <div className={`text-[11px] font-mono truncate ${svc.migrations_current ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400"}`}>
              {svc.migration_current || "none"}
            </div>
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Latest migration</div>
            <div className="text-[11px] font-mono truncate text-foreground">{svc.migration_head || "—"}</div>
          </div>
          {!svc.migrations_current && (
            <div className="col-span-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-[11px] text-yellow-700 dark:text-yellow-400">
              ⚠️ Database is behind — pending migrations exist. Use the Migration panel below to apply them.
            </div>
          )}
        </div>
      )}

      {/* Redis queue depth */}
      {id === "redis" && svc.status === "ok" && svc.queue_depth !== undefined && svc.queue_depth !== null && (
        <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 inline-flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Celery queue depth</span>
          <span className={`text-[11px] font-semibold font-mono ${svc.queue_depth > 20 ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"}`}>
            {svc.queue_depth} tasks
          </span>
        </div>
      )}

      {/* OpenRouter credits remaining */}
      {id === "openrouter" && svc.status === "ok" && svc.credits_remaining !== undefined && svc.credits_remaining !== null && (
        <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 inline-flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Credits remaining</span>
          <span className={`text-[11px] font-semibold font-mono ${svc.credits_remaining < 5 ? "text-destructive" : "text-primary"}`}>
            ${svc.credits_remaining.toFixed(2)}
          </span>
        </div>
      )}

      {/* SMTP — auth mode badge + test widget */}
      {id === "smtp" && svc.status !== "checking" && (
        <>
          {svc.auth_mode && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              🔐 {svc.auth_mode === "tls+auth" ? "STARTTLS + credentials" : "Open relay (no auth)"}
            </div>
          )}
          {svc.status === "ok" && <SmtpTestWidget />}
        </>
      )}
    </div>
  );
}

// ── Migration panel ────────────────────────────────────────────────────────────

function MigrationPanel({ handleAuthError }: { handleAuthError: (e: any) => boolean }) {
  const [history, setHistory] = useState<MigrationHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyErr, setHistoryErr] = useState("");
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<{ ok: boolean; output: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function loadHistory() {
    setLoadingHistory(true);
    setHistoryErr("");
    devApi("/developer/infrastructure/migration-history")
      .then((data) => { setHistory(data); setShowHistory(true); })
      .catch((e: any) => { if (!handleAuthError(e)) setHistoryErr(e.message || "Could not load migration history"); })
      .finally(() => setLoadingHistory(false));
  }

  async function runMigrations() {
    setConfirmOpen(false);
    setRunning(true);
    setRunOutput(null);
    try {
      const result = await devApi("/developer/infrastructure/run-migrations", { method: "POST" });
      setRunOutput({ ok: true, output: result.output || "No output" });
    } catch (e: any) {
      if (!handleAuthError(e)) {
        setRunOutput({ ok: false, output: e.message || "Migration failed" });
      }
    } finally {
      setRunning(false);
    }
  }

  const pendingCount = history ? history.pending : null;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Database Migrations</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Run <code className="font-mono bg-muted px-1 rounded">alembic upgrade head</code> to apply all pending schema changes.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={loadHistory}
            disabled={loadingHistory}
            className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ring disabled:opacity-50 transition"
          >
            {loadingHistory ? "Loading…" : "↻ Check status"}
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={running}
            className="rounded-full bg-primary px-4 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
          >
            {running ? "Running…" : "▶ Run migrations"}
          </button>
        </div>
      </div>

      {/* Summary badges */}
      {history && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-foreground">
            {history.total} total
          </span>
          <span className="rounded-full bg-green-500/10 px-3 py-1 text-[11px] font-semibold text-green-600 dark:text-green-400">
            ✓ {history.applied} applied
          </span>
          {history.pending > 0 ? (
            <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-[11px] font-semibold text-yellow-700 dark:text-yellow-400">
              ⏳ {history.pending} pending
            </span>
          ) : (
            <span className="rounded-full bg-green-500/10 px-3 py-1 text-[11px] font-semibold text-green-600 dark:text-green-400">
              ✓ Up to date
            </span>
          )}
          <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-mono text-muted-foreground">
            HEAD: {history.current_revision || "none"}
          </span>
        </div>
      )}

      {historyErr && (
        <div className="mt-3 text-[11px] text-destructive">{historyErr}</div>
      )}

      {/* Migration table */}
      {showHistory && history && history.migrations.length > 0 && (
        <div className="mt-4 rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">#</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Revision</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Description</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...history.migrations].reverse().map((m, i) => (
                  <tr key={m.revision} className={`border-b border-border last:border-0 ${m.applied ? "" : "bg-yellow-500/5"}`}>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{history.total - i}</td>
                    <td className="px-3 py-2 font-mono text-foreground">{m.revision.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-foreground max-w-xs truncate" title={m.description}>{m.description}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {m.create_date ? m.create_date.slice(0, 10) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {m.applied ? (
                        <span className="text-green-600 dark:text-green-400 font-semibold">✓ Applied</span>
                      ) : (
                        <span className="text-yellow-600 dark:text-yellow-400 font-semibold">⏳ Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Run output */}
      {runOutput && (
        <div className={`mt-4 rounded-lg border px-4 py-3 ${runOutput.ok ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
          <div className={`text-[11px] font-semibold mb-2 ${runOutput.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
            {runOutput.ok ? "✓ Migrations completed successfully" : "✗ Migration failed"}
          </div>
          <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-all overflow-x-auto max-h-64">
            {runOutput.output}
          </pre>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="rounded-xl border border-border bg-card p-6 shadow-2xl max-w-sm w-full">
            <h4 className="font-semibold text-foreground">Run database migrations?</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              This will execute <code className="font-mono bg-muted px-1 rounded">alembic upgrade head</code> against the live database.
              {pendingCount !== null && pendingCount > 0 && (
                <> <strong>{pendingCount} migration{pendingCount > 1 ? "s" : ""}</strong> will be applied.</>
              )}
              {" "}Schema changes cannot be automatically reversed. Make sure you have a backup if this is a production database.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition"
              >
                Cancel
              </button>
              <button
                onClick={runMigrations}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
              >
                Yes, run migrations
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function DeveloperInfrastructure() {
  useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();

  const [status, setStatus] = useState<InfraStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const checkAll = useCallback(() => {
    setLoading(true);
    setErr("");
    devApi("/developer/infrastructure/status")
      .then((data: InfraStatus) => {
        setStatus(data);
        setLastChecked(new Date().toLocaleTimeString());
      })
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Health check failed"); })
      .finally(() => setLoading(false));
  }, [handleAuthError]);

  // Run once on mount — no polling, just an on-open snapshot.
  // The "↻ Refresh" button lets you re-check manually after that.
  useEffect(() => { checkAll(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const serviceOrder = ["database", "redis", "storage", "openrouter", "smtp"] as const;
  const allOk = status && serviceOrder.every((k) => status.services[k]?.status === "ok");
  const anyError = status && serviceOrder.some((k) => status.services[k]?.status === "error");

  return (
    <DeveloperShell title="Infrastructure">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header row */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Infrastructure Status</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Checked once when you open this page. Press Refresh to get the latest status.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {lastChecked && !loading && (
              <span className="text-[11px] text-muted-foreground">Last checked {lastChecked}</span>
            )}
            <button
              onClick={checkAll}
              disabled={loading}
              className="rounded-full border border-border px-4 py-1.5 text-[11px] font-medium text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-50 transition"
            >
              {loading ? "Checking…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* First-load skeleton — cards in muted "checking" state */}
        {loading && !status && (
          <div className="grid gap-4 sm:grid-cols-2">
            {serviceOrder.map((key) => (
              <ServiceCard
                key={key}
                id={key}
                svc={{ status: "checking", latency_ms: null, detail: "" }}
              />
            ))}
          </div>
        )}

        {err && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-4">
            <span>{err}</span>
            <button onClick={checkAll} className="shrink-0 text-[11px] underline underline-offset-2 hover:no-underline">
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {status && (
          <>
            {/* Overall banner */}
            <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
              allOk
                ? "border-green-500/30 bg-green-500/5"
                : anyError
                ? "border-destructive/30 bg-destructive/5"
                : "border-yellow-500/30 bg-yellow-500/5"
            }`}>
              <span className="text-lg">
                {loading ? "🔄" : allOk ? "✅" : anyError ? "🔴" : "⚠️"}
              </span>
              <div className="text-sm font-medium text-foreground">
                {loading
                  ? "Re-checking all services…"
                  : allOk
                  ? "All systems operational"
                  : anyError
                  ? `${serviceOrder.filter((k) => status.services[k]?.status === "error").length} service(s) reporting errors`
                  : "Some services could not be reached"}
              </div>
              <div className="ml-auto text-[11px] text-muted-foreground font-mono">
                {status.checked_at.replace("T", " ").slice(0, 19)} UTC
              </div>
            </div>

            {/* Service cards grid — stale results stay visible during re-check */}
            <div className="grid gap-4 sm:grid-cols-2">
              {serviceOrder.map((key) => (
                <ServiceCard
                  key={key}
                  id={key}
                  svc={loading
                    ? { ...status.services[key], status: "checking" }
                    : status.services[key]
                  }
                />
              ))}
            </div>
          </>
        )}

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Database migrations */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Database Setup</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Apply all pending schema migrations to the connected database. Use this after first deployment
            or after upgrading to a new version of NivaSpark.
          </p>
          <MigrationPanel handleAuthError={handleAuthError} />
        </div>

      </div>
    </DeveloperShell>
  );
}
