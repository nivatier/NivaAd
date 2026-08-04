import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-toggle";

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmail,
  head: () => ({ meta: [{ title: "Verify your email — NivaSpark" }] }),
});

function VerifyEmail() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setErrMsg("No verification token found in this link.");
      setStatus("error");
      return;
    }
    authApi.verifyEmail(token)
      .then(async () => {
        await refresh();
        setStatus("success");
        // Auto-redirect to app after 2s
        setTimeout(() => navigate({ to: "/app" }), 2000);
      })
      .catch((e: any) => {
        setErrMsg(e.message || "Verification failed.");
        setStatus("error");
      });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-foreground">
      <div className="glow-border w-full max-w-md rounded-2xl border border-border bg-card/70 p-8 backdrop-blur-xl text-center">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2.5">
          <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
          <div className="leading-tight min-w-0">
            <img src={isDark ? "/logo-wording-dark.png" : "/logo-wording-light.png"} alt="NivaSpark" className="h-7 object-contain object-left" />
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
          </div>
        </Link>

        {status === "verifying" && (
          <>
            <svg className="mx-auto h-8 w-8 animate-spin text-primary mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <h1 className="font-display text-xl font-bold">Verifying your email…</h1>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-4xl mb-4">🎉</div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Email verified!</h1>
            <p className="mt-2 text-sm text-muted-foreground">Your account is now active. Taking you to the app…</p>
            <Link to="/app" className="mt-5 inline-block rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)]">
              Go to app →
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="font-display text-xl font-bold tracking-tight text-destructive">Verification failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errMsg}</p>
            <div className="mt-5 flex flex-col gap-2">
              <Link to="/signup" className="rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)]">
                Sign up again
              </Link>
              <Link to="/login" className="rounded-full border border-border px-6 py-2.5 text-sm text-muted-foreground hover:border-primary/40">
                Log in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
