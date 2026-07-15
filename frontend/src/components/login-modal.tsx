import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { authApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await authApi.login({ email, password });
      await refresh();
      onClose();
      navigate({ to: "/app" });
    } catch (e: any) {
      setErr(e.message || "Login failed");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-md rounded-2xl border border-border bg-card/90 p-8 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold-gradient font-display font-bold text-background">N</div>
            <div className="leading-tight">
              <div className="font-display font-bold tracking-tight">NivaAd</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        <h2 className="mt-6 font-display text-2xl font-bold tracking-tight text-foreground">Welcome back</h2>
        <p className="mt-1 text-sm text-muted-foreground">Log in to your NivaAd account</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="email"
            required
            autoFocus
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
          New here? <Link to="/signup" onClick={onClose} className="text-primary">Create a company account</Link>
        </div>
      </div>
    </div>
  );
}
