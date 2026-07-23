/**
 * useConnectedPlatforms
 * Fetches the company's platform connections once and returns the set
 * of platform IDs that are status === "connected". Used to filter the
 * PLATFORMS list in Create Ad, Campaigns, Agent Niva, etc. so users
 * only see platforms they've actually connected.
 *
 * Returns null while loading so callers can show all platforms as a
 * safe fallback until the fetch resolves.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useConnectedPlatforms(): Set<string> | null {
  const [connected, setConnected] = useState<Set<string> | null>(null);

  useEffect(() => {
    api("/connections")
      .then((rows: { platform: string; status: string }[]) => {
        setConnected(new Set(rows.filter((r) => r.status === "connected").map((r) => r.platform)));
      })
      .catch(() => {
        // On error (e.g. non-admin role), fall back to showing all platforms
        setConnected(new Set());
      });
  }, []);

  return connected;
}
