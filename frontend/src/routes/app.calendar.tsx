import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AppShell, EmptyState } from "@/components/app-shell";
import { RepostModal } from "@/components/repost-modal";
import { PLATFORMS } from "@/components/create-ad-parts";
import { detectedTimeZone, formatInTimeZone } from "@/lib/timezone";
import { api, type AdOut } from "@/lib/api";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/calendar")({
  component: Calendar,
  head: () => ({ meta: [{ title: "Calendar — NivaSpark" }] }),
});

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function briefTitle(ad: AdOut) {
  const b = ad.brief as any;
  return b?.product_name ? `${b.product_name} — ${b.description || ""}` : ad.id;
}

type CalEntry = { ad: AdOut; kind: "scheduled" | "posted"; when: string; platform: string | null };

/** Builds the month grid as an array of weeks (Sun→Sat), each week an
 * array of 7 Date-or-null slots — null for days outside the visible
 * month at the start/end of the first/last week, so the grid still
 * lines up on real week boundaries. */
function buildWeeks(year: number, monthIndex: number): (Date | null)[][] {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const lastOfMonth = new Date(year, monthIndex + 1, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back up to Sunday
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday

  const weeks: (Date | null)[][] = [];
  let cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week: (Date | null)[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor.getMonth() === monthIndex ? new Date(cursor) : null);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Calendar() {
  const allowed = useRequireCapability("view_my_ads");
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getMonth());
  const [ads, setAds] = useState<AdOut[] | null>(null);
  const [err, setErr] = useState("");
  const [previewAd, setPreviewAd] = useState<AdOut | null>(null);
  const tz = detectedTimeZone();

  async function load() {
    setErr("");
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    try {
      setAds(await api(`/ads/calendar?month=${month}`));
    } catch (e: any) {
      setErr(e.message || "Could not load the calendar");
    }
  }
  useEffect(() => { load(); }, [year, monthIndex]);

  const weeks = useMemo(() => buildWeeks(year, monthIndex), [year, monthIndex]);

  // Group every scheduled/posted occurrence by calendar day (in the
  // viewer's local time zone — a post scheduled at 11pm UTC might land
  // on a different local date, so this uses the same formatted-date
  // logic as the block labels, not a raw UTC slice).
  const entriesByDay = useMemo(() => {
    const map: Record<string, CalEntry[]> = {};
    for (const ad of ads || []) {
      for (const sp of ad.scheduled_posts) {
        const key = dateKey(new Date(sp.scheduled_at));
        (map[key] ||= []).push({ ad, kind: "scheduled", when: sp.scheduled_at, platform: sp.platform });
      }
      if (ad.posted_at) {
        const key = dateKey(new Date(ad.posted_at));
        (map[key] ||= []).push({ ad, kind: "posted", when: ad.posted_at, platform: ad.posted_platforms[0] || null });
      }
    }
    return map;
  }, [ads]);

  function prevMonth() {
    if (monthIndex === 0) { setYear((y) => y - 1); setMonthIndex(11); } else setMonthIndex((m) => m - 1);
  }
  function nextMonth() {
    if (monthIndex === 11) { setYear((y) => y + 1); setMonthIndex(0); } else setMonthIndex((m) => m + 1);
  }
  function goToday() { setYear(today.getFullYear()); setMonthIndex(today.getMonth()); }

  if (!allowed) return null;

  const monthLabel = new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <AppShell eyebrow="Library" title="Calendar">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:border-primary/40">←</button>
          <div className="min-w-[10rem] text-center text-sm font-semibold text-foreground">{monthLabel}</div>
          <button onClick={nextMonth} className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:border-primary/40">→</button>
          <button onClick={goToday} className="ml-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40">Today</button>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-blue-500" /> Scheduled</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-green-500" /> Posted</span>
        </div>
      </div>

      {err && <div className="mb-3 text-sm text-destructive">{err}</div>}

      {ads === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="w-full">
          {/* Weeks as COLUMNS, days-of-week as ROWS — each week
              gets its own column, walked top-to-bottom Sun→Sat within it. */}
          <div className="grid gap-2 w-full" style={{ gridTemplateColumns: `3rem repeat(${weeks.length}, 1fr)` }}>
            <div />
            {weeks.map((_, wi) => (
              <div key={wi} className="text-center text-[11px] font-semibold text-muted-foreground">Week {wi + 1}</div>
            ))}

            {DAY_LABELS.map((label, dayIdx) => (
              <Fragment key={dayIdx}>
                <div className="flex items-center justify-end pr-2 text-[11px] font-semibold text-muted-foreground">{label}</div>
                {weeks.map((week, wi) => {
                  const d = week[dayIdx];
                  const isToday = d && dateKey(d) === dateKey(today);
                  const entries = d ? entriesByDay[dateKey(d)] || [] : [];
                  return (
                    <div key={`${wi}-${dayIdx}`} className={`min-h-[6rem] rounded-lg border p-1.5 ${d ? "border-border bg-card/40" : "border-transparent"} ${isToday ? "ring-1 ring-primary" : ""}`}>
                      {d && (
                        <>
                          <div className={`mb-1 text-[10px] ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{d.getDate()}</div>
                          <div className="space-y-1">
                            {entries.map((e, i) => {
                              const p = PLATFORMS.find((x) => x.id === e.platform);
                              return (
                                <button
                                  key={i}
                                  onClick={() => setPreviewAd(e.ad)}
                                  title={`${briefTitle(e.ad)} — ${e.kind === "scheduled" ? "scheduled" : "posted"} ${formatInTimeZone(e.when, tz)}`}
                                  className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] text-white ${e.kind === "scheduled" ? "bg-blue-500" : "bg-green-500"}`}
                                >
                                  {e.ad.agent_source ? "🤖 " : ""}{p?.tag ? `${p.tag} · ` : ""}{briefTitle(e.ad).slice(0, 28)}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>

          {Object.keys(entriesByDay).length === 0 && (
            <div className="mt-6">
              <EmptyState>
                <div className="text-sm font-semibold text-foreground">Nothing scheduled or posted this month</div>
                <div className="mt-1 text-xs text-muted-foreground">Scheduled and posted ads will show up here once you schedule or post something from Create Ad or My Ads.</div>
              </EmptyState>
            </div>
          )}
        </div>
      )}

      {previewAd && (
        <RepostModal ad={previewAd} onClose={() => setPreviewAd(null)} onUpdated={load} />
      )}
    </AppShell>
  );
}
