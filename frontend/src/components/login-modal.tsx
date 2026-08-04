import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { authApi, api } from "@/lib/api";
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
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const [registered, setRegistered] = useState<{ email: string; justCreated: boolean } | null>(null);

  // Check registration status once when modal opens
  useEffect(() => {
    if (!open) return;
    setRegistered(null); // reset on reopen
    api("/auth/registration-status", { skipAuth: true } as any)
      .then((r: any) => setRegistrationOpen(r.open))
      .catch(() => setRegistrationOpen(false));
  }, [open]);

  // Sync tab when initialMode changes (e.g. clicking "Register" vs "Log in" button)
  useEffect(() => { if (open) setMode(initialMode); }, [open, initialMode]);

  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register fields
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [aup, setAup] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0); // seconds remaining

  // Countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function switchMode(m: ModalMode) { setMode(m); setErr(""); }

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
      await authApi.register({ company_name: company, email: regEmail, password: regPassword, full_name: fullName, accept_aup: aup });
      setResendMsg("");
      setRegistered({ email: regEmail, justCreated: true });
    } catch (e: any) {
      const msg: string = e.message || "";
      if (msg.includes("PENDING_VERIFICATION")) {
        setResendMsg("");
        setRegistered({ email: regEmail, justCreated: false }); // already pending — prompt to resend
      } else {
        setErr(msg || "Registration failed");
      }
    }
    setBusy(false);
  }

  async function resend() {
    if (!registered || resendCooldown > 0) return;
    setResendBusy(true); setResendMsg("");
    try {
      const res = await authApi.resendVerification({ email: registered.email, password: regPassword });
      setResendMsg(res.message);
      setResendCooldown(60); // start 60s cooldown after successful send
    } catch (e: any) {
      const msg: string = e.message || "Could not resend";
      // Parse cooldown from 429 — backend says "Please wait N seconds..."
      const match = msg.match(/wait (\d+) second/);
      if (match) {
        setResendCooldown(parseInt(match[1], 10));
        setResendMsg(`Please wait ${match[1]}s before requesting another link.`);
      } else {
        setResendMsg(msg);
      }
    }
    setResendBusy(false);
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

        {/* "Check your email" screen shown after successful registration */}
        {registered ? (
          <div className="mt-6 text-center space-y-3">
            <div className="text-4xl">📬</div>
            <h2 className="font-display text-xl font-bold text-foreground">
              {registered.justCreated ? "Check your inbox" : "Verification pending"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {registered.justCreated
                ? <>We've sent a verification link to <span className="font-medium text-foreground">{registered.email}</span>. Click it to activate your account.</>
                : <>An account for <span className="font-medium text-foreground">{registered.email}</span> is already awaiting verification. Use the button below to resend the link.</>
              }
            </p>
            <p className="text-xs text-muted-foreground">The link expires in 24 hours.</p>
            <div className="pt-2 text-xs text-muted-foreground border-t border-border/60">
              {registered.justCreated ? "Didn't get it? " : ""}
              <button onClick={resend} disabled={resendBusy || resendCooldown > 0} className="text-primary hover:underline disabled:opacity-50 disabled:no-underline">
                {resendBusy ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend verification email"}
              </button>
              {resendMsg && <div className="mt-1 text-emerald-400">{resendMsg}</div>}
            </div>
            <button onClick={() => switchMode("login")} className="text-xs text-primary hover:underline">
              Already verified? Log in →
            </button>
          </div>
        ) : (
          <>
            {/* Tab switcher */}
            <div className="mt-6 flex rounded-xl border border-border bg-muted/40 p-1 gap-1">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${mode === "login" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => switchMode("register")}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${mode === "register" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"} ${registrationOpen === false ? "opacity-40 cursor-not-allowed" : ""}`}
                disabled={registrationOpen === false}
              >
                Register
              </button>
            </div>

            {/* Login form */}
            {mode === "login" && (
              <>
                <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-foreground">Welcome back</h2>
                <form onSubmit={submitLogin} className="mt-4 space-y-4">
                  <input type="email" required autoFocus placeholder="Email" value={loginEmail}
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
                  <button onClick={() => switchMode("register")} className="text-primary hover:underline">Register free</button>
                </p>
              </>
            )}

            {/* Register form */}
            {mode === "register" && (
              registrationOpen === false ? (
                <div className="mt-6 text-center space-y-3">
                  <div className="text-3xl">🔒</div>
                  <div className="text-sm font-semibold text-foreground">Registration is currently disabled</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    New sign-ups are not available right now. Contact the platform team if you need access.
                  </p>
                  <button onClick={() => setMode("login")} className="mt-2 text-xs text-primary hover:underline">
                    Already have an account? Log in →
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-foreground">Create your company account</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Free plan · 3 credits/month · no card required</p>
                  <form onSubmit={submitRegister} className="mt-4 space-y-3">
                    <input required placeholder="Your full name" value={fullName}
                      onChange={(e) => setFullName(e.target.value)} className={inputCls} />
                    <input required placeholder="Company name" value={company}
                      onChange={(e) => setCompany(e.target.value)} className={inputCls} />
                    <input type="email" required placeholder="Email" value={regEmail}
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
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
