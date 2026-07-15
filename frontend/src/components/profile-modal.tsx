import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", editor: "Editor", poster: "Poster" };

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me, refresh } = useAuth();
  const [name, setName] = useState(me?.user.full_name || "");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState("");
  const [nameErr, setNameErr] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");

  async function saveName() {
    if (!name.trim()) return;
    setSavingName(true); setNameErr(""); setNameMsg("");
    try {
      await api("/auth/me", { method: "PATCH", body: { full_name: name.trim() } });
      await refresh();
      setNameMsg("✓ Saved");
      setTimeout(() => setNameMsg(""), 2000);
    } catch (e: any) {
      setNameErr(e.message || "Could not save your name");
    }
    setSavingName(false);
  }

  async function savePassword() {
    setPwErr(""); setPwMsg("");
    if (newPw.length < 8) { setPwErr("New password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setPwErr("New passwords don't match"); return; }
    setSavingPw(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { current_password: currentPw, new_password: newPw } });
      setPwMsg("✓ Password changed");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setTimeout(() => setPwMsg(""), 2500);
    } catch (e: any) {
      setPwErr(e.message || "Could not change your password");
    }
    setSavingPw(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glow-border w-full max-w-sm rounded-2xl border border-border bg-card/95 p-6 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Your profile</div>
            <div className="text-xs text-muted-foreground">{me?.user.email} · {ROLE_LABEL[me?.user.role || ""] || me?.user.role}</div>
          </div>
          <button onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="mt-5">
          <label className="text-xs font-semibold text-foreground">Name</label>
          <div className="mt-2 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button disabled={savingName || !name.trim()} onClick={saveName} className="shrink-0 rounded-lg border border-primary/50 px-3 py-2 text-xs text-primary disabled:opacity-50">
              {savingName ? "…" : "Save"}
            </button>
          </div>
          {nameErr && <div className="mt-1 text-xs text-destructive">{nameErr}</div>}
          {nameMsg && <div className="mt-1 text-xs text-emerald-400">{nameMsg}</div>}
        </div>

        <div className="mt-6 border-t border-border pt-5">
          <label className="text-xs font-semibold text-foreground">Change password</label>
          <div className="mt-2 space-y-2">
            <input
              type="password"
              placeholder="Current password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="password"
              placeholder="New password (min. 8 characters)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full rounded-lg border border-input bg-input/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {pwErr && <div className="mt-1 text-xs text-destructive">{pwErr}</div>}
          {pwMsg && <div className="mt-1 text-xs text-emerald-400">{pwMsg}</div>}
          <button
            disabled={savingPw || !currentPw || !newPw || !confirmPw}
            onClick={savePassword}
            className="mt-3 w-full rounded-full bg-gold-gradient py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
          >
            {savingPw ? "Changing…" : "Change password"}
          </button>
        </div>
      </div>
    </div>
  );
}
