import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getDevToken, clearDevToken } from "@/lib/dev-api";

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
