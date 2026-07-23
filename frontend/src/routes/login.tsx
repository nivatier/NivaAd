import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  component: Login,
  head: () => ({ meta: [{ title: "Log in — NivaSpark" }] }),
});

function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await authApi.login({ email, password });
      await refresh();
      navigate({ to: "/app" });
    } catch (e: any) {
      setErr(e.message || "Login failed");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="glow-border w-full max-w-md rounded-2xl border border-border bg-card/70 p-8 backdrop-blur-xl">
        <Link to="/" className="mb-6 flex items-center gap-2.5">
          <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
          <div className="leading-tight min-w-0">
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-7 object-contain object-left" />
            <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-7 object-contain object-left" />
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
          </div>
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Log in to your NivaSpark account</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="email"
            required
            placeholder="Work email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-gold-gradient py-3 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
          >
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
        <div className="mt-4 text-center text-xs text-muted-foreground">
          New here? <Link to="/signup" className="text-primary">Create a company account</Link>
        </div>
      </div>
    </div>
  );
}
