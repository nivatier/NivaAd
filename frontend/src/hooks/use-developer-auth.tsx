import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getDevToken, clearDevToken, getDevIdentity, type DevIdentity } from "@/lib/dev-api";

/** Route guard for developer pages — checks a token is PRESENT (no extra
 * API round-trip just to check auth). If the token turns out to be
 * expired/invalid, that surfaces naturally as a 401 on the page's own
 * data call; call handleDevAuthError() in that catch block to clear the
 * stale token and redirect, rather than showing a confusing error. */
export function useRequireDeveloperAuth(): boolean {
  const navigate = useNavigate();
  // Always start false — matches what the server rendered (it never has
  // access to localStorage), so hydration doesn't mismatch. Corrected
  // to the REAL value below, once mounted client-side.
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const token = getDevToken();
    if (!token) {
      navigate({ to: "/developer-login" });
    } else {
      setAllowed(true); // this was missing — without it, allowed stayed false forever even for a legitimately logged-in developer, since nothing ever flipped it back to true after the SSR-safe initial false
    }
  }, []);

  return allowed;
}

export function useDevAuthErrorHandler() {
  const navigate = useNavigate();
  return (err: any) => {
    if (err?.status === 401) {
      clearDevToken();
      navigate({ to: "/developer-login" });
      return true;
    }
    return false;
  };
}

/** Owner vs team member + granted permissions, read once at login and
 * cached in localStorage (see dev-api.ts). Starts `null` (matches SSR,
 * which has no localStorage) rather than defaulting to full access —
 * that would briefly flash a restricted page's real content for a
 * limited team member before narrowing back down. Corrected client-side
 * immediately after mount. */
export function useDevIdentity(): DevIdentity | null {
  const [identity, setIdentity] = useState<DevIdentity | null>(null);
  useEffect(() => { setIdentity(getDevIdentity()); }, []);
  return identity;
}

/** Redirects away from a developer page if the current session (owner or
 * team member) doesn't have the given section permission — this is what
 * actually enforces "this team member can't VIEW this page", not just
 * hiding its sidebar link (bypassable via direct URL). Owner always
 * passes. Returns whether the page should render its real content yet. */
export function useRequireDeveloperPermission(section: string): boolean {
  const navigate = useNavigate();
  const hasToken = useRequireDeveloperAuth();
  const identity = useDevIdentity();
  const allowed = !!identity && (identity.is_owner || !!identity.permissions[section]);

  useEffect(() => {
    if (hasToken && identity && !allowed) {
      navigate({ to: "/developer/overview" });
    }
  }, [hasToken, identity, allowed]);

  if (!hasToken || !identity) return false; // don't flash real content before we know
  return allowed;
}
