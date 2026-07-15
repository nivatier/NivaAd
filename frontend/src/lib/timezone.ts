// Timezone conversion helpers — the backend stores every scheduled time
// as naive UTC (compared against datetime.utcnow() by the Celery Beat
// job), so the frontend is responsible for converting the user's chosen
// WALL-CLOCK time in a chosen timezone into true UTC before sending it,
// and converting UTC times back for display. Uses only built-in Intl/Date
// APIs — no date library needed.

export function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function listTimeZones(): string[] {
  try {
    // Modern browsers (Chrome/Edge/Firefox current versions) support this.
    // @ts-ignore — not yet in all TS lib.d.ts versions
    if (typeof Intl.supportedValuesOf === "function") {
      // @ts-ignore
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    /* fall through to the curated list below */
  }
  return [
    "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
    "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok",
    "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
    "Australia/Sydney", "Australia/Perth", "Pacific/Auckland",
  ];
}

/** Converts a wall-clock "YYYY-MM-DD" + "HH:MM" as understood in `timeZone`
 * into the equivalent UTC date/time — returned as separate UTC
 * "YYYY-MM-DD" / "HH:MM" strings, matching what the backend's
 * PhaseScheduleIn (date + time fields) expects. */
export function zonedWallTimeToUtcParts(dateStr: string, timeStr: string, timeZone: string): { date: string; time: string } {
  const utc = zonedWallTimeToUtcDate(dateStr, timeStr, timeZone);
  return {
    date: utc.toISOString().slice(0, 10),
    time: utc.toISOString().slice(11, 16),
  };
}

/** Returns how far ahead of UTC `timeZone` is, in milliseconds, at the
 * moment `date` represents (positive = ahead of UTC, e.g. +3h for
 * Riyadh). Computed purely from Intl's own knowledge of the zone's rules
 * at that specific instant (correctly handles DST) — critically, this
 * does NOT depend on the browser/environment's own "local" timezone at
 * all, unlike a naive toLocaleString()+new Date() round-trip, which
 * silently produces a WRONG (zero) offset whenever the target timezone
 * happens to match the environment's own local zone — exactly the most
 * common case (someone scheduling in their own timezone). */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second),
  );
  return asUtc - date.getTime();
}

/** Same conversion, returned as a UTC Date object (for building an ISO
 * datetime string, e.g. for SchedulePostIn.scheduled_at). */
export function zonedWallTimeToUtcDate(dateStr: string, timeStr: string, timeZone: string): Date {
  // Step 1: naively parse the wall-clock string AS IF it were UTC — a
  // starting instant to measure the zone's offset at (needed since DST
  // can differ across the year; using THIS specific date matters).
  const guessUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  // Step 2: how far ahead/behind UTC is `timeZone`, at that instant.
  const offsetMs = getTimeZoneOffsetMs(guessUtc, timeZone);
  // Step 3: the true UTC instant is the wall-clock guess MINUS the zone's
  // offset (if the zone is 3h ahead of UTC, wall-clock 15:25 there is
  // 12:25 UTC).
  return new Date(guessUtc.getTime() - offsetMs);
}

/** Same conversion, but returned as a NAIVE UTC ISO string ("YYYY-MM-
 * DDTHH:mm:ss", no "Z"/offset suffix) — this is what the backend actually
 * expects everywhere (its scheduled_at column is TIMESTAMP WITHOUT TIME
 * ZONE, matching datetime.utcnow() usage throughout). Using Date's own
 * .toISOString() here would append "Z", which Python/Postgres correctly
 * treats as timezone-AWARE and rejects against a naive column — always
 * use this helper instead of calling .toISOString() directly on a
 * scheduling datetime. */
export function zonedWallTimeToUtcNaiveIso(dateStr: string, timeStr: string, timeZone: string): string {
  return zonedWallTimeToUtcDate(dateStr, timeStr, timeZone).toISOString().slice(0, 19);
}

/** Converts a UTC ISO datetime string (as returned by the backend, with
 * or without a "Z"/offset suffix) into a display string in the given
 * timezone. */
export function formatInTimeZone(utcIsoString: string, timeZone: string, opts?: Intl.DateTimeFormatOptions): string {
  // The backend returns naive datetimes (no "Z") that ARE actually UTC —
  // force that interpretation rather than letting the browser assume local.
  const normalized = /[Zz]|[+-]\d\d:\d\d$/.test(utcIsoString) ? utcIsoString : `${utcIsoString}Z`;
  const d = new Date(normalized);
  return d.toLocaleString("en-US", {
    timeZone,
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
    ...opts,
  });
}

export function timeZoneAbbrev(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || timeZone;
  } catch {
    return timeZone;
  }
}
