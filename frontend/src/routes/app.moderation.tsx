import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, Input } from "@/components/app-shell";
import { api } from "@/lib/api";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/moderation")({
  component: Moderation,
  head: () => ({ meta: [{ title: "Moderation — NivaAd" }] }),
});

type GuardrailRule = { id: string; phrase: string; created_at: string };
type FlaggedItem = { id: string; text: string; matched_term: string; resolved: boolean; created_at: string };

function Moderation() {
  const allowed = useRequireCapability("admin-only");

  const [defaultRules, setDefaultRules] = useState<string[]>([]);
  const [strikes, setStrikes] = useState(0);
  const [rules, setRules] = useState<GuardrailRule[] | null>(null);
  const [flagged, setFlagged] = useState<FlaggedItem[] | null>(null);
  const [newRule, setNewRule] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  async function load() {
    try {
      const [overview, ruleRows, flagRows] = await Promise.all([
        api("/moderation/overview"),
        api("/moderation/rules"),
        api("/moderation/flagged"),
      ]);
      setDefaultRules(overview.default_rules);
      setStrikes(overview.strikes);
      setRules(ruleRows);
      setFlagged(flagRows);
    } catch (e: any) {
      setErr(e.message || "Could not load moderation data");
    }
  }
  useEffect(() => { if (allowed) load(); }, [allowed]);

  async function addRule() {
    if (!newRule.trim()) return;
    setBusy(true); setErr("");
    try {
      await api("/moderation/rules", { method: "POST", body: { phrase: newRule.trim() } });
      setNewRule("");
      load();
    } catch (e: any) {
      setErr(e.message || "Could not add the rule");
    }
    setBusy(false);
  }

  async function removeRule(id: string) {
    setRules((cur) => cur?.filter((r) => r.id !== id) ?? cur);
    try { await api(`/moderation/rules/${id}`, { method: "DELETE" }); } catch { load(); }
  }

  async function resolveFlag(id: string) {
    setFlagged((cur) => cur?.map((f) => f.id === id ? { ...f, resolved: true } : f) ?? cur);
    try { await api(`/moderation/flagged/${id}/resolve`, { method: "POST" }); } catch { load(); }
  }

  const visibleFlags = flagged?.filter((f) => showResolved || !f.resolved);

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  return (
    <AppShell eyebrow="Setup" title="Moderation">
      <div className="max-w-2xl space-y-6">
        <Panel>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Product defaults</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">🔒 Locked — always active</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Built into the product on every input and output: hate & harassment, violence, sexual content, illegal goods, and more. Cannot be disabled — this floor never lowers.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {defaultRules.map((w) => (
              <span key={w} className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">🔒 {w}</span>
            ))}
          </div>
          {strikes > 0 && (
            <div className="mt-3 text-xs text-amber-400">⚠ {strikes} policy strike{strikes > 1 ? "s" : ""} recorded on this account.</div>
          )}
        </Panel>

        <Panel>
          <div className="text-sm font-semibold text-foreground">Your custom guardrails</div>
          <p className="mt-1 text-[11px] text-muted-foreground">💡 Add words or phrases to block on top of the defaults — competitor names, restricted categories, or banned claims.</p>
          <div className="mt-3 flex gap-2">
            <Input placeholder='e.g. "miracle cure" or a competitor name' value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addRule(); }} />
            <button disabled={!newRule.trim() || busy} onClick={addRule}
              className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
              ＋ Add rule
            </button>
          </div>
          {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
          {rules === null ? (
            <div className="mt-3 text-xs text-muted-foreground">Loading…</div>
          ) : rules.length === 0 ? (
            <div className="mt-3 text-[11px] text-muted-foreground">No custom rules yet.</div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {rules.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary">
                  {r.phrase}
                  <button onClick={() => removeRule(r.id)} className="text-muted-foreground hover:text-destructive">✕</button>
                </span>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">🛡️ Flagged content queue</div>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              Show resolved
            </label>
          </div>
          {visibleFlags === null || visibleFlags === undefined ? (
            <div className="mt-3 text-xs text-muted-foreground">Loading…</div>
          ) : visibleFlags.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border/70 bg-background/30 px-6 py-8 text-center text-xs text-muted-foreground">
              No flagged content. Try a prohibited word (e.g. "weapon") in an ad brief to see the guardrails fire.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {visibleFlags.map((f) => (
                <div key={f.id} className={`rounded-xl border px-4 py-3 ${f.resolved ? "border-border bg-background/30 opacity-60" : "border-destructive/30 bg-destructive/5"}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-foreground">Matched "<span className="text-destructive">{f.matched_term}</span>"</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{new Date(f.created_at).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      {!f.resolved && (
                        <button onClick={() => resolveFlag(f.id)} className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary">Mark resolved</button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">"{f.text.slice(0, 100)}{f.text.length > 100 ? "…" : ""}"</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
