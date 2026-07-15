import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

/** Redirects away from a page if the current user's role doesn't have the
 * given capability — this is what actually enforces "editor/poster can't
 * VIEW this page", not just hiding its sidebar link (which someone could
 * still bypass via a direct URL or bookmark). Admin always passes.
 * Returns whether the page should render its real content yet. */
export function useRequireCapability(capability: string): boolean {
  const { me, loading } = useAuth();
  const navigate = useNavigate();
  const allowed = me?.user.role === "admin" || !!me?.capabilities?.[capability];

  useEffect(() => {
    if (!loading && me && !allowed) {
      navigate({ to: "/app" });
    }
  }, [loading, allowed, me]);

  if (loading || !me) return false; // don't flash real content before we know
  return allowed;
}
