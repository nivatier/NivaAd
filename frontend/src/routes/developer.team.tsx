import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler, useDevIdentity } from "@/hooks/use-developer-auth";
import { devApi, type DeveloperTeamUser } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/team")({
  component: DeveloperTeam,
  head: () => ({ meta: [{ title: "Team — NivaAd Developer" }] }),
});

type PermMeta = { keys: string[]; labels: Record<string, string> };

function PermissionGrid({ keys, labels, value, onToggle, disabledKeys }: {
  keys: string[];
  labels: Record<string, string>;
  value: Record<string, boolean>;
  onToggle: (key: string) => void;
  disabledKeys?: string[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {keys.map((key) => {
        const disabled = disabledKeys?.includes(key);
        return (
          <label key={key} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${value[key] ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground"} ${disabled ? "opacity-50" : "cursor-pointer"}`}>
            <input type="checkbox" checked={!!value[key]} disabled={disabled} onChange={() => onToggle(key)} className="mt-0.5" />
            <span>{labels[key] || key}</span>
          </label>
        );
      })}
    </div>
  );
}

function AddTeamMemberForm({ perms, onAdd, busy }: { perms: PermMeta; onAdd: (v: { email: string; full_name: string; password: string; permissions: Record<string, boolean> }) => void; busy: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState<Record<string, boolean>>(Object.fromEntries(perms.keys.map((k) => [k, false])));

  function toggle(key: string) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  }

  const canSubmit = email.trim() && password.length >= 8;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="text-sm font-semibold text-foreground mb-1">Add a developer team member</div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        They log in at the same Developer login screen with this email + password. Grant only the sections they need —
        each one gates both the sidebar link and the underlying API, so they genuinely can't see or touch anything
        outside what's checked below, even via a direct URL.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="At least 8 characters"
            className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
        </div>
      </div>
      <div className="mb-3">
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Permissions</div>
        <PermissionGrid keys={perms.keys} labels={perms.labels} value={permissions} onToggle={toggle} />
      </div>
      <button
        disabled={busy || !canSubmit}
        onClick={() => onAdd({ email: email.trim(), full_name: name.trim(), password, permissions })}
        className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
      >
        {busy ? "Adding…" : "+ Add team member"}
      </button>
    </div>
  );
}

function TeamMemberRow({ member, perms, busy, onSave, onDelete }: {
  member: DeveloperTeamUser;
  perms: PermMeta;
  busy: boolean;
  onSave: (id: string, v: { full_name?: string; permissions?: Record<string, boolean>; status?: string; password?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [permissions, setPermissions] = useState(member.permissions);
  const [newPassword, setNewPassword] = useState("");

  function toggle(key: string) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  }

  function save() {
    const body: { permissions: Record<string, boolean>; password?: string } = { permissions };
    if (newPassword.trim()) body.password = newPassword.trim();
    onSave(member.id, body);
    setEditing(false);
    setNewPassword("");
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground">{member.full_name || member.email}</div>
          <div className="text-[11px] text-muted-foreground">{member.email}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${member.status === "disabled" ? "border-border text-muted-foreground" : "border-primary/40 bg-primary/10 text-primary"}`}>
            {member.status === "disabled" ? "Disabled" : "Active"}
          </span>
          <button onClick={() => setEditing((v) => !v)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={() => onSave(member.id, { status: member.status === "disabled" ? "active" : "disabled" })}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${member.status === "disabled" ? "border-emerald-500/40 text-emerald-400" : "border-destructive/40 text-destructive"}`}
          >
            {member.status === "disabled" ? "Reactivate" : "Disable"}
          </button>
          <button onClick={() => onDelete(member.id)} className="rounded-full border border-destructive/50 px-2.5 py-1 text-[11px] text-destructive hover:bg-destructive/10">Delete</button>
        </div>
      </div>

      {!editing ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {perms.keys.filter((k) => member.permissions[k]).length === 0 ? (
            <span className="text-[11px] text-muted-foreground">No permissions granted yet.</span>
          ) : (
            perms.keys.filter((k) => member.permissions[k]).map((k) => (
              <span key={k} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{k}</span>
            ))
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <PermissionGrid keys={perms.keys} labels={perms.labels} value={permissions} onToggle={toggle} />
          <div>
            <label className="text-[11px] text-muted-foreground">Reset password (leave blank to keep current)</label>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" placeholder="At least 8 characters"
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none" />
          </div>
          <button disabled={busy} onClick={save} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

function DeveloperTeam() {
  const allowed = useRequireDeveloperPermission("team");
  const handleAuthError = useDevAuthErrorHandler();
  const identity = useDevIdentity();
  const [members, setMembers] = useState<DeveloperTeamUser[] | null>(null);
  const [perms, setPerms] = useState<PermMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const [m, p] = await Promise.all([devApi("/developer/team"), devApi("/developer/team/permission-keys")]);
      setMembers(m); setPerms(p);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not load the team");
    }
  }
  useEffect(() => { load(); }, []);

  async function add(v: { email: string; full_name: string; password: string; permissions: Record<string, boolean> }) {
    setBusy(true); setErr("");
    try {
      const created: DeveloperTeamUser = await devApi("/developer/team", { method: "POST", body: v });
      setMembers((cur) => [...(cur || []), created]);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not add team member");
    }
    setBusy(false);
  }

  async function save(id: string, v: { full_name?: string; permissions?: Record<string, boolean>; status?: string; password?: string }) {
    setBusy(true); setErr("");
    try {
      const updated: DeveloperTeamUser = await devApi(`/developer/team/${id}`, { method: "PUT", body: v });
      setMembers((cur) => cur?.map((m) => (m.id === id ? updated : m)) ?? cur);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save changes");
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm("Permanently remove this developer team member? They lose all access immediately.")) return;
    setErr("");
    try {
      await devApi(`/developer/team/${id}`, { method: "DELETE" });
      setMembers((cur) => cur?.filter((m) => m.id !== id) ?? cur);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not remove");
    }
  }

  if (!allowed) return null;

  return (
    <DeveloperShell title="Team">
      <p className="mb-6 max-w-2xl text-xs text-muted-foreground">
        Give your team access to the Developer panel without sharing your own login. Each member gets their own
        email + password and a granular set of sections — the owner login (this one, from your .env credentials)
        always has full access and isn't shown here since it isn't a manageable account.
      </p>

      {!identity?.is_owner && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
          You're signed in as a team member with "Team" access — changes here affect other developer accounts, including your own permissions.
        </div>
      )}

      {members === null || perms === null ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-6 max-w-3xl">
          <AddTeamMemberForm perms={perms} onAdd={add} busy={busy} />

          {members.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-xs text-muted-foreground">
              No team members yet — add the first one above.
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <TeamMemberRow key={m.id} member={m} perms={perms} busy={busy} onSave={save} onDelete={remove} />
              ))}
            </div>
          )}
        </div>
      )}
      {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
    </DeveloperShell>
  );
}
