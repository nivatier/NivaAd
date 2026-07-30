import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperAuth, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/logs")({
  component: DeveloperLogs,
  head: () => ({ meta: [{ title: "Logs — NivaSpark Developer" }] }),
});

type LogRow = {
  id: number;
  service: string;
  level: string;
  logger_name: string;
  message: string;
  created_at: string;
};

type LogResult = {
  total: number;
  page: number;
  page_size: number;
  rows: LogRow[];
  services: string[];
};

const LEVEL_COLOR: Record<string, string> = {
  INFO:     "text-foreground",
  WARNING:  "text-amber-400",
  ERROR:    "text-destructive",
  CRITICAL: "text-red-400 font-bold",
};

const LEVEL_BADGE: Record<string, string> = {
  INFO:     "bg-muted/40 text-muted-foreground",
  WARNING:  "bg-amber-500/15 border-amber-500/40 text-amber-400",
  ERROR:    "bg-destructive/15 border-destructive/40 text-destructive",
  CRITICAL: "bg-red-500/20 border-red-500/50 text-red-400",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function DeveloperLogs() {
  const allowed = useRequireDeveloperAuth();
  const handleAuthError = useDevAuthErrorHandler();

  // Filter state
  const [service, setService] = useState("");
  const [level, setLevel] = useState("");
  const [dateFrom, setDateFrom] = useState(daysAgo(1));
  const [dateTo, setDateTo] = useState(today());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Result state
  const [result, setResult] = useState<LogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  async function query(p = 1) {
    setLoading(true); setErr(""); setHasSearched(true);
    try {
      const params = new URLSearchParams({ page: String(p), page_size: "200" });
      if (service) params.set("service", service);
      if (level) params.set("level", level);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (search.trim()) params.set("search", search.trim());
      const r = await devApi(`/developer/logs?${params}`);
      setResult(r);
      setPage(p);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not fetch logs");
    }
    setLoading(false);
  }

  async function download() {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (service) params.set("service", service);
      if (level) params.set("level", level);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (search.trim()) params.set("search", search.trim());

      const token = (() => {
        try { return JSON.parse(sessionStorage.getItem("nivaad_dev_token") || "{}").token || ""; }
        catch { return ""; }
      })();
      const res = await fetch(`http://localhost:8000/developer/logs/download?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "logs.log";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e.message || "Download failed");
    }
    setDownloading(false);
  }

  if (!allowed) return null;

  const totalPages = result ? Math.ceil(result.total / result.page_size) : 0;

  return (
    <DeveloperShell title="Logs">
      {/* ── Filter bar ── */}
      <div className="rounded-xl border border-border bg-card/60 p-4 mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Service */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Service</label>
            <select value={service} onChange={(e) => setService(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
              <option value="">All services</option>
              {(result?.services.length ? result.services : ["api", "worker", "beat"]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Level */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Level</label>
            <select value={level} onChange={(e) => setLevel(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none">
              <option value="">All levels</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>

          {/* Date from */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">From date</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>

          {/* Date to */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">To date</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
        </div>

        {/* Search + quick ranges */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query(1)}
            placeholder="Search message text…"
            className="flex-1 min-w-48 rounded-lg border border-border bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />

          {/* Quick range buttons */}
          <div className="flex gap-1">
            {[["Today", 0], ["24h", 1], ["7d", 7], ["30d", 30]].map(([label, n]) => (
              <button key={label} type="button"
                onClick={() => { setDateFrom(daysAgo(n as number)); setDateTo(today()); }}
                className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
                {label}
              </button>
            ))}
          </div>

          <button onClick={() => query(1)} disabled={loading}
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
            {loading ? "Searching…" : "Search"}
          </button>

          {hasSearched && result && (
            <button onClick={download} disabled={downloading}
              className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50">
              {downloading ? "Downloading…" : `⬇ Download (${result.total.toLocaleString()} rows)`}
            </button>
          )}
        </div>

        {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
      </div>

      {/* ── Not searched yet ── */}
      {!hasSearched && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Set filters above and click <strong className="text-foreground">Search</strong> to load logs.
          <p className="mt-1 text-[11px] opacity-60">Logs are written by the API, worker, and beat processes. Only INFO and above are stored.</p>
        </div>
      )}

      {/* ── Results ── */}
      {hasSearched && result && (
        <>
          {/* Summary bar */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted-foreground">
              {result.total === 0 ? "No results" : `${result.total.toLocaleString()} rows — showing page ${result.page} of ${totalPages}`}
            </span>
            {result.total > result.page_size && (
              <div className="flex items-center gap-1.5">
                <button disabled={page <= 1 || loading} onClick={() => query(page - 1)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">← Prev</button>
                <button disabled={page >= totalPages || loading} onClick={() => query(page + 1)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">Next →</button>
              </div>
            )}
          </div>

          {/* Log rows */}
          {result.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No log entries found for the selected filters.
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-36">Time</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-20">Service</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-20">Level</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-36">Logger</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={row.id}
                        className={`border-b border-border/40 ${i % 2 === 0 ? "" : "bg-muted/10"} ${row.level === "ERROR" || row.level === "CRITICAL" ? "bg-destructive/5" : ""}`}>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap font-mono">
                          {new Date(row.created_at + "Z").toLocaleString("en", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="rounded-full bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground">{row.service}</span>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${LEVEL_BADGE[row.level] ?? "text-muted-foreground"}`}>
                            {row.level}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground font-mono truncate max-w-[140px]" title={row.logger_name}>
                          {row.logger_name}
                        </td>
                        <td className={`px-3 py-1.5 font-mono whitespace-pre-wrap break-all ${LEVEL_COLOR[row.level] ?? "text-foreground"}`}>
                          {row.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Bottom pagination */}
          {result.total > result.page_size && (
            <div className="mt-3 flex justify-center gap-2">
              <button disabled={page <= 1 || loading} onClick={() => query(page - 1)}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">← Previous</button>
              <span className="px-3 py-1.5 text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages || loading} onClick={() => query(page + 1)}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">Next →</button>
            </div>
          )}
        </>
      )}
    </DeveloperShell>
  );
}
