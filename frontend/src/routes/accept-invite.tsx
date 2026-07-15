import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authApi, type InviteCheckOut } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/accept-invite")({
  component: AcceptInvite,
  head: () => ({ meta: [{ title: "Accept invite — NivaAd" }] }),
});

function AcceptInvite() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState<InviteCheckOut | null>(null);
  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
    if (!t) {
      setErr("This invite link is missing its token — please use the link from your invite email.");
      setChecking(false);
      return;
    }
    authApi.checkInvite(t)
      .then((res) => { setInvite(res); setFullName(res.full_name); })
      .catch((e: any) => setErr(e.message || "This invite link is invalid or has already been used"))
      .finally(() => setChecking(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (password.length < 8) { setErr("Password must be at least 8 characters"); return; }
    if (password !== confirmPassword) { setErr("Passwords don't match"); return; }
    setBusy(true);
    try {
      await authApi.acceptInvite({ token, password, full_name: fullName || undefined });
      await refresh();
      navigate({ to: "/app" });
    } catch (e: any) {
      setErr(e.message || "Could not accept the invite");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="glow-border w-full max-w-md rounded-2xl border border-border bg-card/70 p-8 backdrop-blur-xl">
        <Link to="/" className="mb-6 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold-gradient font-display font-bold text-background">N</div>
          <div className="leading-tight">
            <div className="font-display font-bold tracking-tight">NivaAd</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
          </div>
        </Link>

        {checking ? (
          <p className="text-sm text-muted-foreground">Checking your invite…</p>
        ) : !invite ? (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight">Invite not found</h1>
            <p className="mt-2 text-sm text-destructive">{err}</p>
            <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">Go to login →</Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight">Join {invite.company_name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{invite.inviter_name} invited you ({invite.email}) — set a password to finish joining.</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <input
                required
                placeholder="Your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                required
                type="password"
                placeholder="Choose a password (min. 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                required
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {err && <div className="text-xs text-destructive">{err}</div>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-gold-gradient py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
              >
                {busy ? "Joining…" : "Accept invite & join"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
