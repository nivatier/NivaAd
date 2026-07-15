import { useState } from "react";
import { api } from "@/lib/api";

const PER_CREDIT_USD = 0.90; // matches the backend's per-credit Stripe price — display estimate only, Stripe's own checkout page is authoritative
const PRESETS = [10, 25, 50, 100];

export function BuyCreditsModal({ onClose }: { onClose: () => void }) {
  const [credits, setCredits] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function setClamped(n: number) {
    setCredits(Math.max(1, Math.min(1000, Math.round(n))));
  }

  async function checkout() {
    setBusy(true); setErr("");
    try {
      const res = await api("/billing/topup", {
        method: "POST",
        body: { credits, return_to: window.location.pathname },
      });
      window.location.href = res.url;
    } catch (e: any) {
      setErr(e.message || "Could not start checkout");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-sm rounded-2xl border border-border bg-card/95 p-6 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div className="text-sm font-semibold text-foreground">＋ Buy credits</div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {PRESETS.map((n) => (
            <button key={n} onClick={() => setClamped(n)}
              className={`rounded-full border px-3 py-1.5 text-xs ${credits === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
              {n}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => setClamped(credits - 5)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-foreground hover:border-primary/40">−</button>
          <input
            type="number"
            min={1}
            max={1000}
            value={credits}
            onChange={(e) => setClamped(Number(e.target.value) || 1)}
            className="w-24 rounded-lg border border-input bg-input/40 px-3 py-2 text-center text-lg font-semibold text-foreground focus:border-primary focus:outline-none"
          />
          <button onClick={() => setClamped(credits + 5)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-foreground hover:border-primary/40">＋</button>
          <span className="text-xs text-muted-foreground">credits</span>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-background/40 p-3 text-center">
          <div className="text-2xl font-bold text-foreground">${(credits * PER_CREDIT_USD).toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground">${PER_CREDIT_USD.toFixed(2)} per credit</div>
        </div>

        {err && <div className="mt-3 text-xs text-destructive">{err}</div>}

        <button
          disabled={busy}
          onClick={checkout}
          className="mt-5 w-full rounded-full bg-gold-gradient py-3 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
        >
          {busy ? "Redirecting…" : `Checkout — $${(credits * PER_CREDIT_USD).toFixed(2)}`}
        </button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Payments run through Stripe (sandbox/test mode).</p>
      </div>
    </div>
  );
}
