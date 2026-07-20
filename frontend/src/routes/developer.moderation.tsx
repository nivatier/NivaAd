import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi, type GuardrailRuleOut } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/moderation")({
  component: DeveloperModeration,
  head: () => ({ meta: [{ title: "Moderation — NivaAd Developer" }] }),
});

function DeveloperModeration() {
  const allowed = useRequireDeveloperPermission("guardrails");
  const handleAuthError = useDevAuthErrorHandler();

  const [rules, setRules] = useState<GuardrailRuleOut[] | null>(null);
  const [newTerm, setNewTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setRules(await devApi("/developer/moderation-defaults"));
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load the default blocklist");
    }
  }
  useEffect(() => { if (allowed) load(); }, [allowed]);

  async function add() {
    const phrase = newTerm.trim();
    if (!phrase) return;
    setAdding(true); setErr("");
    try {
      const rule = await devApi("/developer/moderation-defaults", { method: "POST", body: { phrase } });
      setRules((cur) => cur ? [...cur, rule] : [rule]);
      setNewTerm("");
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add term");
    }
    setAdding(false);
  }

  async function remove(id: string) {
    setRules((cur) => cur ? cur.filter((r) => r.id !== id) : cur);
    try {
      await devApi(`/developer/moderation-defaults/${id}`, { method: "DELETE" });
    } catch (e: any) {
      if (!handleAuthError(e)) { setErr(e.message || "Could not remove term"); load(); }
    }
  }

  if (!allowed) return null;

  return (
    <DeveloperShell title="Moderation">
      <p className="mb-6 text-sm text-muted-foreground">
        The platform-wide default blocklist — every company inherits these terms automatically, shown to their admins in Admin &gt; Moderation as a fixed, read-only baseline. This is the only place they're actually editable. A company's own additional custom terms are managed separately by that company's own admin and aren't affected by anything here.
      </p>
      <p className="mb-6 text-xs text-muted-foreground">
        A term appearing in an ad's text doesn't automatically block it — Claude then judges whether it's actually being used in a harmful or policy-violating way, versus an incidental or legitimate business usage (e.g. a skincare ad saying "miracle results" isn't a false medical claim). Only a real, context-confirmed match gets blocked and flagged for review.
      </p>

      {err && <div className="mb-4 text-sm text-destructive">{err}</div>}

      <div className="rounded-xl border border-slate-700/50 bg-card/60 p-4">
        <div className="text-sm font-semibold text-foreground">Default terms</div>
        {!rules ? (
          <div className="mt-3 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {rules.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5 rounded-full border border-slate-700/50 bg-background/40 px-3 py-1 text-xs text-foreground">
                  {r.phrase}
                  <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive" title="Remove">✕</button>
                </span>
              ))}
              {rules.length === 0 && <span className="text-xs text-muted-foreground">No default terms — every company starts with an empty blocklist until you add some.</span>}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <input
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                placeholder="Add a term, e.g. counterfeit"
                className="w-full max-w-xs rounded-lg border border-slate-700/50 bg-input/40 px-3 py-1.5 text-xs text-foreground focus:border-slate-500 focus:outline-none"
              />
              <button disabled={adding || !newTerm.trim()} onClick={add} className="rounded-full bg-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50">
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          </>
        )}
      </div>
    </DeveloperShell>
  );
}
