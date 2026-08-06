/**
 * PostingProgressModal
 *
 * Shows one row per platform with live status (pending → success / failed)
 * while polling the post-status endpoint until the job finishes.
 * Used by Create Ad (per-card and Post All) and My Ads (repost-modal).
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type PlatformInfo = { id: string; name: string; color: string; tag: string };

type RowStatus = "pending" | "success" | "failed";

type PlatformRow = {
  platform: PlatformInfo;
  status: RowStatus;
  error?: string;
};

export function PostingProgressModal({
  adId,
  jobId,
  platforms,
  onDone,
}: {
  adId: string;
  jobId: string;
  platforms: PlatformInfo[];
  /** Called when all polling is complete — receives succeeded[] and failed{} */
  onDone: (succeeded: string[], failed: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState<PlatformRow[]>(
    platforms.map((p) => ({ platform: p, status: "pending" }))
  );
  const [finished, setFinished] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60; // 2 min @ 2s interval

    async function poll() {
      while (!cancelled && attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
        try {
          const job: any = await api(`/ads/${adId}/post-status/${jobId}`);

          // Update rows with latest succeeded/failed
          if (!cancelled) {
            setRows((prev) =>
              prev.map((row) => {
                const pid = row.platform.id;
                if (job.succeeded?.includes(pid)) {
                  return { ...row, status: "success" };
                }
                if (job.failed?.[pid]) {
                  return { ...row, status: "failed", error: job.failed[pid] };
                }
                return row;
              })
            );
          }

          if (job.finished) {
            if (!cancelled) {
              setFinished(true);
              onDone(job.succeeded || [], job.failed || {});
            }
            return;
          }
        } catch {
          // transient fetch error — keep polling
        }
      }

      // Timed out
      if (!cancelled) {
        setRows((prev) =>
          prev.map((row) =>
            row.status === "pending"
              ? { ...row, status: "failed", error: "Timed out — check My Ads for the result" }
              : row
          )
        );
        setFinished(true);
        onDone(
          rows.filter((r) => r.status === "success").map((r) => r.platform.id),
          Object.fromEntries(
            rows
              .filter((r) => r.status === "pending")
              .map((r) => [r.platform.id, "Timed out"])
          )
        );
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [adId, jobId]);

  if (dismissed) return null;

  const allDone = rows.every((r) => r.status !== "pending");
  const anyFailed = rows.some((r) => r.status === "failed");
  const allSucceeded = rows.every((r) => r.status === "success");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "oklch(0 0 0 / 0.60)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{
          background: "oklch(0.13 0.02 280 / 0.97)",
          border: "1px solid oklch(1 0 0 / 0.10)",
          boxShadow: [
            "0 0 0 1px oklch(0.85 0.18 52 / 0.12)",
            "inset 0 1px 0 oklch(1 0 0 / 0.08)",
            "0 40px 100px -20px oklch(0 0 0 / 0.80)",
          ].join(", "),
        }}
      >
        {/* Top accent */}
        <div className="h-[2px] w-full" style={{
          background: allSucceeded && finished
            ? "linear-gradient(90deg, transparent, oklch(0.70 0.18 165 / 0.9), transparent)"
            : anyFailed && finished
            ? "linear-gradient(90deg, transparent, oklch(0.60 0.22 25 / 0.9), transparent)"
            : "linear-gradient(90deg, transparent, oklch(0.85 0.18 52 / 0.9), transparent)",
        }} />

        <div className="px-6 py-6">
          {/* Header */}
          <div className="mb-5 flex items-center gap-3">
            {finished ? (
              allSucceeded ? (
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                  style={{ background: "oklch(0.70 0.18 165 / 0.15)", border: "1px solid oklch(0.70 0.18 165 / 0.35)" }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: "oklch(0.75 0.18 165)" }}>
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              ) : (
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                  style={{ background: "oklch(0.50 0.20 25 / 0.15)", border: "1px solid oklch(0.50 0.20 25 / 0.35)" }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: "oklch(0.65 0.20 25)" }}>
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                </div>
              )
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                style={{ background: "oklch(0.85 0.18 52 / 0.12)", border: "1px solid oklch(0.85 0.18 52 / 0.30)" }}>
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "oklch(0.88 0.18 52)" }}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}
            <div>
              <div className="text-sm font-semibold" style={{ color: "oklch(0.95 0.02 280)" }}>
                {!finished
                  ? "Posting your ad…"
                  : allSucceeded
                  ? "Posted successfully!"
                  : anyFailed && !allDone
                  ? "Partially posted"
                  : "Posting complete"}
              </div>
              {!finished && (
                <div className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.02 280)" }}>
                  This may take up to a minute for video
                </div>
              )}
            </div>
          </div>

          {/* Per-platform rows */}
          <div className="space-y-2.5 mb-6">
            {rows.map((row) => (
              <div key={row.platform.id}
                className="flex items-start gap-3 rounded-xl px-3 py-2.5"
                style={{
                  background: row.status === "success"
                    ? "oklch(0.70 0.18 165 / 0.08)"
                    : row.status === "failed"
                    ? "oklch(0.50 0.20 25 / 0.08)"
                    : "oklch(1 0 0 / 0.03)",
                  border: `1px solid ${
                    row.status === "success"
                      ? "oklch(0.70 0.18 165 / 0.20)"
                      : row.status === "failed"
                      ? "oklch(0.50 0.20 25 / 0.20)"
                      : "oklch(1 0 0 / 0.06)"
                  }`,
                }}
              >
                {/* Platform badge */}
                <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-950"
                  style={{ background: row.platform.color }}>
                  {row.platform.tag}
                </div>

                {/* Platform name + status */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold" style={{ color: "oklch(0.88 0.02 280)" }}>
                    {row.platform.name}
                  </div>
                  {row.status === "failed" && row.error && (
                    <div className="mt-0.5 text-[11px] leading-snug" style={{ color: "oklch(0.65 0.18 25)" }}>
                      {row.error.length > 120 ? row.error.slice(0, 117) + "…" : row.error}
                    </div>
                  )}
                  {row.status === "success" && (
                    <div className="mt-0.5 text-[11px]" style={{ color: "oklch(0.65 0.18 165)" }}>
                      Posted ✓
                    </div>
                  )}
                  {row.status === "pending" && (
                    <div className="mt-0.5 text-[11px]" style={{ color: "oklch(0.50 0.02 280)" }}>
                      {finished ? "Timed out" : "Publishing…"}
                    </div>
                  )}
                </div>

                {/* Status icon */}
                <div className="shrink-0 mt-0.5">
                  {row.status === "success" ? (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" style={{ color: "oklch(0.70 0.18 165)" }}>
                      <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                    </svg>
                  ) : row.status === "failed" ? (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" style={{ color: "oklch(0.60 0.20 25)" }}>
                      <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "oklch(0.55 0.02 280)" }}>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* OK button — appears when all done */}
          {finished && (
            <button
              onClick={() => setDismissed(true)}
              className="w-full rounded-full py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={
                allSucceeded
                  ? { background: "linear-gradient(135deg, oklch(0.88 0.18 52), oklch(0.74 0.22 45))", color: "black" }
                  : { background: "oklch(0.22 0.02 280)", border: "1px solid oklch(1 0 0 / 0.10)", color: "oklch(0.80 0.02 280)" }
              }
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
