import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { devAuthApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer-login")({
  component: DeveloperLogin,
  head: () => ({ meta: [{ title: "Developer — NivaAd" }] }),
});

function DeveloperLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await devAuthApi.login(email, password);
      navigate({ to: "/developer/overview" });
    } catch (e: any) {
      setErr(e.message || "Login failed");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      {/* Deliberately a different accent (slate, not gold) — a visual
          signal this is a separate, more sensitive context from the
          normal company login, not just a styling choice. */}
      <div className="w-full max-w-md rounded-2xl border border-slate-600/50 bg-card/70 p-8 backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-700 font-display font-bold text-slate-100">N</div>
          <div className="leading-tight">
            <div className="font-display font-bold tracking-tight">NivaAd</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Platform Operator</div>
          </div>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Developer login</h1>
        <p className="mt-1 text-sm text-muted-foreground">Not a company account — this is the platform-operator dashboard.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="email"
            required
            placeholder="Developer email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-slate-700 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50"
          >
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
