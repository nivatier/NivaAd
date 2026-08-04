import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { authApi } from "@/lib/api";
import { useTheme } from "@/components/theme-toggle";

export const Route = createFileRoute("/signup")({
  component: Signup,
  head: () => ({ meta: [{ title: "Create your account — NivaSpark" }] }),
});

function Signup() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [aup, setAup] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!aup) {
      setErr("You must accept the Terms of Service and Acceptable Use Policy");
      return;
    }
    setBusy(true);
    try {
      await authApi.register({ company_name: company, email, password, accept_aup: aup });
      setDone(true);
    } catch (e: any) {
      const msg: string = e.message || "";
      if (msg.includes("PENDING_VERIFICATION")) {
        setDone(true); // show resend screen
      } else {
        setErr(msg || "Registration failed");
      }
    }
    setBusy(false);
  }

  async function resend() {
    if (resendCooldown > 0) return;
    setResendBusy(true); setResendMsg("");
    try {
      const res = await authApi.resendVerification({ email, password });
      setResendMsg(res.message);
      setResendCooldown(60);
    } catch (e: any) {
      const msg: string = e.message || "Could not resend";
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

  const logo = (
    <Link to="/" className="mb-6 flex items-center gap-2.5">
      <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
      <div className="leading-tight min-w-0">
        <img src={isDark ? "/logo-wording-dark.png" : "/logo-wording-light.png"} alt="NivaSpark" className="h-7 object-contain object-left" />
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Nivatier</div>
      </div>
    </Link>
  );

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-foreground">
        <div className="glow-border w-full max-w-md rounded-2xl border border-border bg-card/70 p-8 backdrop-blur-xl text-center">
          {logo}
          <div className="text-4xl mb-4">📬</div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Check your inbox</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We've sent a verification link to <span className="font-medium text-foreground">{email}</span>.
            Click it to activate your account and get started.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">The link expires in 24 hours.</p>
          <div className="mt-6 border-t border-border/60 pt-4 text-xs text-muted-foreground">
            Didn't get it?{" "}
            <button onClick={resend} disabled={resendBusy || resendCooldown > 0} className="text-primary hover:underline disabled:opacity-50 disabled:no-underline">
              {resendBusy ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend verification email"}
            </button>
            {resendMsg && <div className="mt-1 text-emerald-400">{resendMsg}</div>}
          </div>
          <div className="mt-4 text-center text-xs text-muted-foreground">
            Already verified? <Link to="/login" className="text-primary">Log in</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-foreground">
      <div className="glow-border w-full max-w-md rounded-2xl border border-border bg-card/70 p-8 backdrop-blur-xl">
        {logo}
        <h1 className="font-display text-2xl font-bold tracking-tight">Create your company account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Starts on the Free plan · 3 credits/month</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            required
            placeholder="Company name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-input bg-input/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={aup} onChange={(e) => setAup(e.target.checked)} className="mt-0.5" />
            <span>I accept the <span className="text-primary">Terms of Service</span> and <span className="text-primary">Acceptable Use Policy</span>.</span>
          </label>
          {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">{err}</div>}
          <button
            type="submit"
            disabled={busy || !aup}
            className="w-full rounded-full bg-gold-gradient py-3 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
          >
            {busy ? "Creating account…" : "Continue →"}
          </button>
        </form>
        <div className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account? <Link to="/login" className="text-primary">Log in</Link>
        </div>
      </div>
    </div>
  );
}
