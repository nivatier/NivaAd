/**
 * useConnectedPlatforms
 * Single source of truth for platform data across the app.
 *
 * Returns:
 *   - platforms:  full list from /connections/available (7 real IDs)
 *   - connected:  Set of platform IDs with status === "connected"
 *   - testMode:   when true, all platforms are selectable regardless of connection
 *   - loading:    true while the first fetch is in flight
 *
 * Test mode (localStorage "nivaspark_test_mode"):
 *   ON  → all platforms are selectable and clickable everywhere
 *   OFF → only connected platforms are highlighted; others are greyed out
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Platform } from "@/components/create-ad-parts";

const TEST_MODE_KEY = "nivaspark_test_mode";

// Fallback while fetch is in flight — matches backend DEFAULT_PLATFORMS order
const FALLBACK_PLATFORMS: Platform[] = [
  { id: "linkedin_personal", name: "LinkedIn (Personal)", color: "#0A66C2", tag: "IN", ratio: "Landscape 1.91:1" },
  { id: "linkedin_company", name: "LinkedIn (Company)", color: "#0A66C2", tag: "IN", ratio: "Landscape 1.91:1" },
  { id: "instagram",        name: "Instagram",          color: "#E1306C", tag: "IG", ratio: "Square 1:1" },
  { id: "facebook",         name: "Facebook",           color: "#1877F2", tag: "FB", ratio: "Landscape 1.91:1" },
  { id: "tiktok",           name: "TikTok",             color: "#25F4EE", tag: "TT", ratio: "Vertical 9:16" },
  { id: "x",                name: "X (Twitter)",        color: "#e7e9ea", tag: "𝕏",  ratio: "Landscape 16:9" },
  { id: "threads",          name: "Threads",            color: "#000000", tag: "TH", ratio: "Square 1:1" },
];

// Color + tag lookup by platform id (backend label is authoritative for name)
const PLATFORM_META: Record<string, { color: string; tag: string; ratio: string }> = {
  linkedin_personal: { color: "#0A66C2", tag: "IN", ratio: "Landscape 1.91:1" },
  linkedin_company:  { color: "#0A66C2", tag: "IN", ratio: "Landscape 1.91:1" },
  instagram:         { color: "#E1306C", tag: "IG", ratio: "Square 1:1" },
  facebook:          { color: "#1877F2", tag: "FB", ratio: "Landscape 1.91:1" },
  tiktok:            { color: "#25F4EE", tag: "TT", ratio: "Vertical 9:16" },
  x:                 { color: "#e7e9ea", tag: "𝕏",  ratio: "Landscape 16:9" },
  threads:           { color: "#000000", tag: "TH", ratio: "Square 1:1" },
};

export type ConnectedPlatformsResult = {
  platforms: Platform[];        // all available platforms from backend
  connected: Set<string>;       // platform IDs with status === "connected"
  testMode: boolean;
  loading: boolean;
};

export function useConnectedPlatforms(): ConnectedPlatformsResult {
  const [platforms, setPlatforms] = useState<Platform[]>(FALLBACK_PLATFORMS);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(true);
  const [testMode, setTestModeState] = useState(
    () => localStorage.getItem(TEST_MODE_KEY) === "true"
  );

  useEffect(() => {
    Promise.all([
      api("/connections"),
      api("/connections/available"),
    ]).then(([conns, avail]: [{ platform: string; status: string }[], { id: string; label: string; video_ratio: string }[]]) => {
      setConnected(new Set(conns.filter((r) => r.status === "connected").map((r) => r.platform)));
      const mapped: Platform[] = avail.map((p) => {
        const meta = PLATFORM_META[p.id] ?? { color: "#6366f1", tag: p.id.slice(0, 2).toUpperCase(), ratio: "Square 1:1" };
        const ratioLabel = p.video_ratio === "9:16" ? "Vertical 9:16"
          : p.video_ratio === "16:9" ? "Landscape 16:9"
          : p.video_ratio === "1.91:1" ? "Landscape 1.91:1"
          : "Square 1:1";
        return { id: p.id, name: p.label, color: meta.color, tag: meta.tag, ratio: ratioLabel };
      });
      if (mapped.length > 0) setPlatforms(mapped);
    }).catch(() => {
      // On error, keep fallback
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === TEST_MODE_KEY) setTestModeState(e.newValue === "true");
    }
    function onCustom() {
      setTestModeState(localStorage.getItem(TEST_MODE_KEY) === "true");
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("testmode", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("testmode", onCustom);
    };
  }, []);

  return { platforms, connected, testMode, loading };
}

/** Call from Admin to toggle test mode — updates all components immediately. */
export function setTestMode(enabled: boolean) {
  localStorage.setItem(TEST_MODE_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new Event("testmode"));
}
