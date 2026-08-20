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

type CalEntry =
  | { kind: "scheduled" | "posted"; ad: AdOut; when: string; platform: string | null; source: "ad" }
  | { kind: "streak"; id: string; title: string; status: string; scheduled_date: string; scheduled_time: string | null; platforms: string[]; ad_copy: string; source: "streak" };

function buildWeeks(year: number, monthIndex: number): (Date | null)[][] {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const lastOfMonth = new Date(year, monthIndex + 1, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

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

// Colour classes per entry type
function entryClass(e: CalEntry): string {
  if (e.source === "streak") {
    return e.status === "posted"
      ? "bg-green-500"
      : "bg-[oklch(0.75_0.15_52)] text-background"; // brand gold for scheduled streak
  }
  if (e.source === "ad") {
    if ((e as any).ad?.agent_source === "rss") return "bg-purple-500";
    if ((e as any).ad?.agent_source) return "bg-violet-500";
    return e.kind === "scheduled" ? "bg-blue-500" : "bg-green-500";
  }
  return "bg-blue-500";
}

function entryLabel(e: CalEntry, tz: string): string {
  if (e.source === "streak") {
    const plat = e.platforms?.[0] || "";
    return `🚀 ${plat ? plat.toUpperCase().slice(0, 2) + " · " : ""}${e.title.slice(0, 26)}`;
  }
  const p = PLATFORMS.find((x) => x.id === e.platform);
  const prefix = (e as any).ad?.agent_source === "rss" ? "📰 " : (e as any).ad?.agent_source ? "🤖 " : "";
  return `${prefix}${p?.tag ? `${p.tag} · ` : ""}${briefTitle((e as any).ad).slice(0, 26)}`;
}

function entryTitle(e: CalEntry, tz: string): string {
  if (e.source === "streak") {
    return `🚀 Brand Campaign Streak — ${e.title} · ${e.status} · ${e.scheduled_date} ${e.scheduled_time || ""}`;
  }
  return `${briefTitle((e as any).ad)} — ${e.kind} ${formatInTimeZone(e.when, tz)}`;
}

function Calendar() {
  const allowed = useRequireCapability("view_my_ads");
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getMonth());
  const [ads, setAds] = useState<AdOut[] | null>(null);
  const [streakAds, setStreakAds] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [previewAd, setPreviewAd] = useState<AdOut | null>(null);
  const [previewStreak, setPreviewStreak] = useState<any | null>(null);
  const tz = detectedTimeZone();

  async function load() {
    setErr("");
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    try {
      const [adsData, streakData] = await Promise.all([
        api(`/ads/calendar?month=${month}`),
        api(`/ads/calendar/streak-ads?month=${month}`).catch(() => []),
      ]);
      setAds(adsData);
      setStreakAds(streakData || []);
    } catch (e: any) {
      setErr(e.message || "Could not load the calendar");
    }
  }

  useEffect(() => { load(); }, [year, monthIndex]);

  const weeks = useMemo(() => buildWeeks(year, monthIndex), [year, monthIndex]);

  const entriesByDay = useMemo(() => {
    const map: Record<string, CalEntry[]> = {};

    // Regular ads
    for (const ad of ads || []) {
      for (const sp of ad.scheduled_posts) {
        const key = dateKey(new Date(sp.scheduled_at));
        (map[key] ||= []).push({ ad, kind: "scheduled", when: sp.scheduled_at, platform: sp.platform, source: "ad" });
      }
      if (ad.posted_at) {
        const key = dateKey(new Date(ad.posted_at));
        (map[key] ||= []).push({ ad, kind: "posted", when: ad.posted_at, platform: ad.posted_platforms[0] || null, source: "ad" });
      }
    }

    // Streak ads
    for (const sa of streakAds) {
      if (!sa.scheduled_date) continue;
      const key = sa.scheduled_date; // already "YYYY-MM-DD"
      (map[key] ||= []).push({ ...sa, kind: "streak", source: "streak" });
    }

    return map;
  }, [ads, streakAds]);

  function prevMonth() {
    if (monthIndex === 0) { setYear((y) => y - 1); setMonthIndex(11); } else setMonthIndex((m) => m - 1);
  }
  function nextMonth() {
    if (monthIndex === 11) { setYear((y) => y + 1); setMonthIndex(0); } else setMonthIndex((m) => m + 1);
  }
  function goToday() { setYear(today.getFullYear()); setMonthIndex(today.getMonth()); }

  if (!allowed) return null;

  const monthLabel = new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const hasAnyEntry = Object.keys(entriesByDay).length > 0;

  return (
    <AppShell eyebrow="Library" title="Calendar">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:border-primary/40">←</button>
          <div className="min-w-[10rem] text-center text-sm font-semibold text-foreground">{monthLabel}</div>
          <button onClick={nextMonth} className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:border-primary/40">→</button>
          <button onClick={goToday} className="ml-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40">Today</button>
        </div>
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-blue-500" /> Scheduled</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-green-500" /> Posted</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-violet-500" /> Agent Niva</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-purple-500" /> RSS Feed</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: "oklch(0.75 0.15 52)" }} /> 🚀 Brand Streak</span>
        </div>
      </div>

      {err && <div className="mb-3 text-sm text-destructive">{err}</div>}

      {ads === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="w-full">
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
                            {entries.map((e, i) => (
                              <button
                                key={i}
                                onClick={() => {
                                  if (e.source === "streak") setPreviewStreak(e);
                                  else setPreviewAd((e as any).ad);
                                }}
                                title={entryTitle(e, tz)}
                                className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] text-white ${entryClass(e)}`}
                              >
                                {entryLabel(e, tz)}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>

          {!hasAnyEntry && (
            <div className="mt-6">
              <EmptyState>
                <div className="text-sm font-semibold text-foreground">Nothing scheduled or posted this month</div>
                <div className="mt-1 text-xs text-muted-foreground">Scheduled and posted ads will show up here once you schedule or post something from Create Ad, My Ads, or Agent Niva.</div>
              </EmptyState>
            </div>
          )}
        </div>
      )}

      {previewAd && (
        <RepostModal ad={previewAd} onClose={() => setPreviewAd(null)} onUpdated={load} />
      )}

      {/* Streak ad preview popup */}
      {previewStreak && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPreviewStreak(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[oklch(0.18_0.02_260)] p-5 space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold text-amber-400 mb-0.5">🚀 Brand Campaign Streak</div>
                <div className="text-sm font-semibold text-foreground">{previewStreak.title}</div>
              </div>
              <button onClick={() => setPreviewStreak(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none shrink-0">✕</button>
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span>📅 {previewStreak.scheduled_date}</span>
              {previewStreak.scheduled_time && <span>🕐 {previewStreak.scheduled_time}</span>}
              <span className={`font-medium ${previewStreak.status === "posted" ? "text-green-400" : previewStreak.status === "scheduled" ? "text-blue-400" : "text-amber-400"}`}>
                {previewStreak.status}
              </span>
            </div>
            {previewStreak.platforms?.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                Platforms: {previewStreak.platforms.join(", ")}
              </div>
            )}
            {previewStreak.ad_copy && (
              <div className="rounded-lg border border-border/30 bg-background/20 p-3">
                <p className="text-xs text-foreground leading-relaxed line-clamp-6">{previewStreak.ad_copy}</p>
              </div>
            )}
            <button onClick={() => setPreviewStreak(null)}
              className="w-full rounded-full border border-border py-2 text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
