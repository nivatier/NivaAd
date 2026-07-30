import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Credit presets — each represents a number of credits to purchase.
// At $0.10/credit these are $5, $10, $15, $30, $50, $100 respectively.
// The actual price shown is always derived from the backend value, never hardcoded.
const PRESETS = [50, 100, 150, 200, 250, 300];

export function BuyCreditsModal({ onClose }: { onClose: () => void }) {
  const [credits, setCredits] = useState(50);
  const [perCreditUsd, setPerCreditUsd] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/billing/topup-info")
      .then((r: { credit_value_usd: number }) => setPerCreditUsd(r.credit_value_usd))
      .catch(() => {}); // non-fatal — price just won't show until loaded
  }, []);

  function setClamped(n: number) {
    setCredits(Math.max(1, Math.min(10000, Math.round(n))));
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

  const totalUsd = perCreditUsd !== null ? (credits * perCreditUsd).toFixed(2) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-sm rounded-2xl border border-border bg-card/95 p-6 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div className="text-sm font-semibold text-foreground">＋ Buy credits</div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* Preset buttons */}
        <div className="mt-5 flex flex-wrap gap-2">
          {PRESETS.map((n) => (
            <button key={n} onClick={() => setClamped(n)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-all ${credits === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
              {n}
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => setClamped(credits - 50)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-foreground hover:border-primary/40">−</button>
          <input
            type="number"
            min={1}
            max={10000}
            value={credits}
            onChange={(e) => setClamped(Number(e.target.value) || 1)}
            className="w-24 rounded-lg border border-input bg-input/40 px-3 py-2 text-center text-lg font-semibold text-foreground focus:border-primary focus:outline-none"
          />
          <button onClick={() => setClamped(credits + 50)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-foreground hover:border-primary/40">＋</button>
          <span className="text-xs text-muted-foreground">credits</span>
        </div>

        {/* Price display */}
        <div className="mt-4 rounded-lg border border-border bg-background/40 p-3 text-center">
          {totalUsd !== null ? (
            <>
              <div className="text-2xl font-bold text-foreground">${totalUsd}</div>
              <div className="text-[11px] text-muted-foreground">{credits} credits</div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
        </div>

        {err && <div className="mt-3 text-xs text-destructive">{err}</div>}

        <button
          disabled={busy || perCreditUsd === null}
          onClick={checkout}
          className="mt-5 w-full rounded-full bg-gold-gradient py-3 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
        >
          {busy ? "Redirecting…" : totalUsd !== null ? `Checkout — $${totalUsd}` : "Loading…"}
        </button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Payments processed securely by Stripe.</p>
      </div>
    </div>
  );
}
