import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { authApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

type ModalMode = "login" | "register";

export function LoginModal({
  open,
  onClose,
  initialMode = "login",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: ModalMode;
}) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [mode, setMode] = useState<ModalMode>(initialMode);

  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register fields
  const [company, setCompany] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [aup, setAup] = useState(false);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function switchMode(m: ModalMode) {
    setMode(m);
    setErr("");
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await authApi.login({ email: loginEmail, password: loginPassword });
      await refresh();
      onClose();
      navigate({ to: "/app" });
    } catch (e: any) {
      setErr(e.message || "Login failed");
    }
    setBusy(false);
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!aup) { setErr("You must accept the Terms of Service and Acceptable Use Policy"); return; }
    setBusy(true);
    try {
      await authApi.register({ company_name: company, email: regEmail, password: regPassword, accept_aup: aup });
      await refresh();
      onClose();
      navigate({ to: "/app" });
    } catch (e: any) {
      setErr(e.message || "Registration failed");
    }
    setBusy(false);
  }

  const inputCls = "w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-md rounded-2xl border border-border bg-card/90 p-8 backdrop-blur-xl">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
            <div className="leading-tight min-w-0">
              <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-7 object-contain object-left" />
              <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-7 object-contain object-left" />
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        {/* Tab switcher */}
        <div className="mt-6 flex rounded-xl border border-border bg-muted/40 p-1 gap-1">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${mode === "login" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${mode === "register" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Start free
          </button>
        </div>

        {/* Login form */}
        {mode === "login" && (
          <>
            <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-foreground">Welcome back</h2>
            <form onSubmit={submitLogin} className="mt-4 space-y-4">
              <input type="email" required autoFocus placeholder="Work email" value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)} className={inputCls} />
              <input type="password" required placeholder="Password" value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)} className={inputCls} />
              {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">{err}</div>}
              <button type="submit" disabled={busy}
                className="w-full rounded-full bg-gold-gradient py-3 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
                {busy ? "Logging in…" : "Log in"}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              No account yet?{" "}
              <button onClick={() => switchMode("register")} className="text-primary hover:underline">Create one free</button>
            </p>
          </>
        )}

        {/* Register form */}
        {mode === "register" && (
          <>
            <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-foreground">Create your company account</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Free plan · 3 credits/month · no card required</p>
            <form onSubmit={submitRegister} className="mt-4 space-y-4">
              <input required placeholder="Company name" value={company}
                onChange={(e) => setCompany(e.target.value)} className={inputCls} />
              <input type="email" required placeholder="Work email" value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)} className={inputCls} />
              <input type="password" required minLength={8} placeholder="Password (min 8 characters)" value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)} className={inputCls} />
              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={aup} onChange={(e) => setAup(e.target.checked)} className="mt-0.5 shrink-0" />
                <span>I accept the <span className="text-primary">Terms of Service</span> and <span className="text-primary">Acceptable Use Policy</span>.</span>
              </label>
              {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">{err}</div>}
              <button type="submit" disabled={busy || !aup}
                className="w-full rounded-full bg-gold-gradient py-3 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
                {busy ? "Creating account…" : "Create account →"}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <button onClick={() => switchMode("login")} className="text-primary hover:underline">Log in</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
