import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";
import { Search, RefreshCw, CheckCircle, Archive, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/developer/flagged-content")({
  component: DeveloperFlaggedContent,
  head: () => ({ meta: [{ title: "Flagged Content — NivaSpark Developer" }] }),
});

type FlaggedItem = {
  id: string;
  text: string;
  matched_term: string;
  resolved: boolean;          // company admin action — do not modify
  developer_status: string;   // "open" | "reviewed" | "archived"
  created_at: string;
  company_id: string | null;
  company_name: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
};

type FlaggedResponse = {
  items: FlaggedItem[];
  total: number;
  page: number;
  page_size: number;
};

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Reviewed" },
  { value: "archived", label: "Archived" },
];

function DeveloperFlaggedContent() {
  const allowed = useRequireDeveloperPermission("guardrails");
  const handleAuthError = useDevAuthErrorHandler();

  const [data, setData] = useState<FlaggedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  // Filters
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "25" });
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      if (companyFilter) params.set("company_id", companyFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await devApi(`/developer/flagged-content?${params}`);
      setData(res);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load flagged content");
    }
    setLoading(false);
  }, [status, search, companyFilter, dateFrom, dateTo, page]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  function applySearch() {
    setSearch(searchInput);
    setPage(1);
  }

  function resetFilters() {
    setStatus("");
    setSearch("");
    setSearchInput("");
    setCompanyFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  async function markReviewed(id: string) {
    setActionBusy(id);
    try {
      await devApi(`/developer/flagged-content/${id}/review`, { method: "POST" });
      setData((d) => d ? {
        ...d,
        items: d.items.map((item) => item.id === id ? { ...item, developer_status: "reviewed" } : item),
      } : d);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not mark as reviewed");
    }
    setActionBusy(null);
  }

  async function archiveItem(id: string) {
    setActionBusy(id);
    try {
      await devApi(`/developer/flagged-content/${id}/archive`, { method: "POST" });
      setData((d) => d ? {
        ...d,
        items: d.items.map((item) => item.id === id ? { ...item, developer_status: "archived" } : item),
        total: d.total - 1,
      } : d);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not archive item");
    }
    setActionBusy(null);
  }

  const totalPages = data ? Math.ceil(data.total / 25) : 1;

  if (!allowed) return null;

  return (
    <DeveloperShell title="Flagged Content">
      <p className="mb-6 text-sm text-muted-foreground">
        Cross-company flagged content queue. Review content that was blocked by guardrails across all organisations.
        Use this to identify misuse patterns and take disciplinary action where needed.
      </p>

      {/* Filters */}
      <div className="mb-4 rounded-xl border border-border bg-card/60 p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Search</label>
            <div className="flex gap-2">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
                placeholder="Text or matched term…"
                className="flex-1 rounded-lg border border-border bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
              />
              <button onClick={applySearch} className="rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="rounded-lg border border-border bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="rounded-lg border border-border bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="rounded-lg border border-border bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={resetFilters}
              className="rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}

      {/* Stats bar */}
      {data && (
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{data.total} item{data.total !== 1 ? "s" : ""} found</span>
          <span>Page {page} of {totalPages}</span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_140px_160px_100px_120px] gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Content</span>
          <span>Company</span>
          <span>User</span>
          <span>Date</span>
          <span className="text-right">Actions</span>
        </div>

        {/* Rows */}
        {!data || loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "No data"}
          </div>
        ) : data.items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="text-2xl mb-2">🛡️</div>
            <div className="text-sm font-medium text-foreground">No flagged content</div>
            <div className="text-xs text-muted-foreground mt-1">
              {status || search ? "Try adjusting your filters." : "No content has been flagged yet."}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.items.map((item) => (
              <div
                key={item.id}
                className={`grid grid-cols-[1fr_140px_160px_100px_120px] gap-4 px-4 py-3 items-start transition-colors hover:bg-muted/20 ${
                  item.developer_status !== "open" ? "opacity-60" : ""
                }`}
              >
                {/* Content */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                      {item.matched_term}
                    </span>
                    {item.developer_status === "reviewed" && (
                      <span className="inline-flex items-center rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
                        Reviewed
                      </span>
                    )}
                    {item.developer_status === "archived" && (
                      <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                        Archived
                      </span>
                    )}
                    {item.resolved && (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                        Admin resolved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    "{item.text.slice(0, 200)}{item.text.length > 200 ? "…" : ""}"
                  </p>
                </div>

                {/* Company */}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">
                    {item.company_name || "Unknown"}
                  </div>
                  {item.company_id && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {item.company_id.slice(0, 8)}…
                    </div>
                  )}
                </div>

                {/* User */}
                <div className="min-w-0">
                  <div className="text-xs text-foreground truncate">
                    {item.user_name || item.user_email || "Unknown"}
                  </div>
                  {item.user_email && item.user_name && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {item.user_email}
                    </div>
                  )}
                </div>

                {/* Date */}
                <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                  <div className="text-[10px]">
                    {new Date(item.created_at).toLocaleTimeString(undefined, {
                      hour: "numeric", minute: "2-digit",
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1.5">
                  {item.developer_status === "open" && (
                    <>
                      <button
                        onClick={() => markReviewed(item.id)}
                        disabled={actionBusy === item.id}
                        title="Mark as reviewed"
                        className="flex items-center gap-1 rounded-lg border border-border bg-background/40 px-2 py-1 text-[10px] text-muted-foreground hover:border-green-500/40 hover:text-green-400 disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle className="h-3 w-3" />
                        Review
                      </button>
                      <button
                        onClick={() => archiveItem(item.id)}
                        disabled={actionBusy === item.id}
                        title="Archive"
                        className="flex items-center gap-1 rounded-lg border border-border bg-background/40 px-2 py-1 text-[10px] text-muted-foreground hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50 transition-colors"
                      >
                        <Archive className="h-3 w-3" />
                        Archive
                      </button>
                    </>
                  )}
                  {item.developer_status === "reviewed" && (
                    <button
                      onClick={() => archiveItem(item.id)}
                      disabled={actionBusy === item.id}
                      title="Archive"
                      className="flex items-center gap-1 rounded-lg border border-border bg-background/40 px-2 py-1 text-[10px] text-muted-foreground hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50 transition-colors"
                    >
                      <Archive className="h-3 w-3" />
                      Archive
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </DeveloperShell>
  );
}
