import { useEffect, useState } from "react";
import { detectedTimeZone, listTimeZones, timeZoneAbbrev } from "@/lib/timezone";

export function TimezoneSelect({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [zones] = useState(() => listTimeZones());
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-input bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none ${className}`}
    >
      {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
    </select>
  );
}

/** Live-updating clock showing the current time in a given timezone —
 * lets the customer confirm what "10:00 AM" actually means before they
 * commit to a schedule. */
export function LiveClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span>
      {now.toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      {" "}({timeZoneAbbrev(timeZone)})
    </span>
  );
}

export function useDefaultTimeZone() {
  const [tz, setTz] = useState(detectedTimeZone());
  return [tz, setTz] as const;
}
