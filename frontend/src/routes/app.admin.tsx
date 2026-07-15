import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, Input } from "@/components/app-shell";
import { api, type TeamUserOut } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useRequireCapability } from "@/hooks/use-require-capability";

export const Route = createFileRoute("/app/admin")({
  component: Admin,
  head: () => ({ meta: [{ title: "Admin — NivaAd" }] }),
});

const TABS = ["Overview", "Users", "Profiles"];


const ROLE_LABEL: Record<string, string> = { admin: "Admin", editor: "Editor", poster: "Poster" };
const ROLE_DESC: Record<string, string> = {
  admin: "everything incl. billing & users",
  editor: "create, refine & submit ads",
  poster: "post approved ads only",
};
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-primary/40 bg-primary/10 text-primary" },
  invited: { label: "⏳ Invited", cls: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  disabled: { label: "Disabled", cls: "border-border text-muted-foreground" },
};

function UsersTab() {
  const { me } = useAuth();
  const [users, setUsers] = useState<TeamUserOut[] | null>(null);
  const [limit, setLimit] = useState<{ max_extra_users: number; current_extra_users: number } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  async function load() {
    try {
      const [u, l] = await Promise.all([api("/admin/users"), api("/admin/users/limit")]);
      setUsers(u);
      setLimit(l);
    } catch (e: any) { setErr(e.message || "Could not load the team"); }
  }
  useEffect(() => { load(); }, []);

  const limitReached = !!limit && limit.current_extra_users >= limit.max_extra_users;
  const inviteBlocked = limitReached && role !== "admin";

  async function invite() {
    if (!email.trim() || inviteBlocked) return;
    setBusy(true); setErr(""); setOkMsg("");
    try {
      await api("/admin/users/invite", { method: "POST", body: { email, full_name: name, role } });
      setOkMsg(`✓ Invite sent to ${email}`);
      setName(""); setEmail(""); setRole("editor");
      load();
    } catch (e: any) {
      setErr(e.message || "Could not send the invite");
    }
    setBusy(false);
  }

  async function changeRole(userId: string, newRole: string) {
    setUsers((cur) => cur?.map((u) => u.id === userId ? { ...u, role: newRole } : u) ?? cur);
    try { await api(`/admin/users/${userId}`, { method: "PATCH", body: { role: newRole } }); } catch (e: any) { setErr(e.message || "Could not change role"); load(); }
  }

  async function toggleStatus(u: TeamUserOut) {
    const newStatus = u.status === "disabled" ? "active" : "disabled";
    setUsers((cur) => cur?.map((x) => x.id === u.id ? { ...x, status: newStatus } : x) ?? cur);
    try { await api(`/admin/users/${u.id}`, { method: "PATCH", body: { status: newStatus } }); } catch (e: any) { setErr(e.message || "Could not update status"); load(); }
  }

  async function deleteUser(u: TeamUserOut) {
    if (!confirm(`Permanently delete ${u.full_name || u.email}? This can't be undone — their past ads stay in the system, but they lose all access and free up a seat against your team limit.`)) return;
    setErr("");
    try {
      await api(`/admin/users/${u.id}`, { method: "DELETE" });
      load(); // refreshes both the roster and the limit count together
    } catch (e: any) {
      setErr(e.message || "Could not delete this user");
    }
  }

  return (
    <div className="grid gap-6">
      <Panel>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Add a team member</div>
          {limit && (
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${limitReached ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}>
              {limit.current_extra_users} of {limit.max_extra_users} extra users used
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">💡 They'll get a real email invite (check Mailpit at localhost:8025 in dev) with a link to set their password.</p>
        {inviteBlocked && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            ⚠ User addition limit reached — your plan allows {limit?.max_extra_users} team member{limit?.max_extra_users !== 1 ? "s" : ""} in addition to the admin. Remove someone first, or contact support to increase your limit.
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_180px_auto]">
          <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} disabled={inviteBlocked} />
          <Input placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={inviteBlocked} />
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={inviteBlocked} className="rounded-lg border border-input bg-input/40 px-3 py-2.5 text-sm text-foreground disabled:opacity-50">
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
            <option value="poster">Poster</option>
          </select>
          <button disabled={busy || !email.trim() || inviteBlocked} onClick={invite} className="rounded-lg bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
            {busy ? "Sending…" : "+ Send invite"}
          </button>
        </div>
        {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
        {okMsg && <div className="mt-2 text-xs text-emerald-400">{okMsg}</div>}
        <div className="mt-3 text-[11px] text-muted-foreground">
          {Object.entries(ROLE_LABEL).map(([k, l]) => <span key={k}><b className="text-foreground">{l}</b> — {ROLE_DESC[k]}{k !== "poster" ? " · " : ""}</span>)}
        </div>
      </Panel>

      {users === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-14 text-center text-sm text-muted-foreground">No team members yet — add the first one above.</div>
      ) : (
        <Panel>
          <div className="divide-y divide-border">
            {users.map((u) => {
              const isSelf = u.id === me?.user.id;
              const badge = STATUS_BADGE[u.status] || STATUS_BADGE.active;
              return (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm text-foreground">{u.full_name || u.email} {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
                    <select
                      value={u.role}
                      disabled={isSelf || u.role === "admin"}
                      title={u.role === "admin" && !isSelf ? "Admin roles can't be changed here — protects against accidentally demoting another admin" : undefined}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      className="rounded-lg border border-input bg-input/40 px-2 py-1 text-xs text-foreground disabled:opacity-50"
                    >
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="poster">Poster</option>
                    </select>
                    {u.status !== "invited" && (
                      <button
                        disabled={isSelf}
                        onClick={() => toggleStatus(u)}
                        className={`rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${u.status === "disabled" ? "border-emerald-500/40 text-emerald-400" : "border-destructive/40 text-destructive"}`}
                      >
                        {u.status === "disabled" ? "Reactivate" : "Disable"}
                      </button>
                    )}
                    <button
                      disabled={isSelf || (u.role === "admin" && (users || []).filter((x) => x.role === "admin").length <= 1)}
                      title={isSelf ? "You can't delete your own account" : (u.role === "admin" && (users || []).filter((x) => x.role === "admin").length <= 1) ? "Can't delete the last admin" : undefined}
                      onClick={() => deleteUser(u)}
                      className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/5 disabled:opacity-30"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  create_ads: "Create ads (the Create Ad wizard)",
  manage_campaigns: "Create & manage campaigns",
  manage_products: "Manage the product library",
  manage_brand_kit: "Edit brand kit (logo, colors, tagline)",
  post_content: "Post or schedule ads to platforms",
};
const PAGE_LABELS: Record<string, string> = {
  view_my_ads: "My Ads",
  view_campaigns: "Campaigns",
  view_brand_kit: "Brand Kit",
  view_analytics: "Analytics",
  view_settings: "Settings",
};

function CapabilityToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-foreground">
      <span>{label}</span>
      <button onClick={onClick} className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-gold-gradient" : "bg-muted"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

function ProfilesTab() {
  const [caps, setCaps] = useState<{ editor: Record<string, boolean>; poster: Record<string, boolean> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [err, setErr] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  async function load() {
    try { setCaps(await api("/admin/capabilities")); } catch (e: any) { setErr(e.message || "Could not load capabilities"); }
  }
  useEffect(() => { load(); }, []);

  function toggle(role: "editor" | "poster", key: string) {
    setCaps((cur) => cur ? { ...cur, [role]: { ...cur[role], [key]: !cur[role][key] } } : cur);
  }

  async function restoreDefaults() {
    setRestoring(true); setErr(""); setSavedMsg("");
    try {
      const defaults = await api("/admin/capabilities/defaults");
      setCaps(defaults);
      setSavedMsg("↺ Defaults loaded — click \"Save capabilities\" below to apply them");
    } catch (e: any) {
      setErr(e.message || "Could not load defaults");
    }
    setRestoring(false);
  }

  async function save() {
    if (!caps) return;
    setSaving(true); setErr(""); setSavedMsg("");
    try {
      await api("/admin/capabilities", { method: "PUT", body: caps });
      setSavedMsg("✓ Saved — takes effect immediately for that role");
      setTimeout(() => setSavedMsg(""), 3000);
    } catch (e: any) {
      setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  if (caps === null) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="grid gap-6">
      <Panel>
        <div className="text-sm font-semibold text-foreground">Role capabilities</div>
        <p className="mt-1 text-xs text-muted-foreground">
          💡 Admin always sees and can do everything — not shown here since it isn't configurable (Admin itself grants every other permission, so it can't be handed out). "Page access" controls what shows in the sidebar AND blocks direct navigation to a hidden page — not just cosmetic. "Actions" control what a role can actually do once on a page they can see. Both are enforced by the backend on every request, not just hidden in the UI.
        </p>

        <div className="mt-5 grid gap-6 md:grid-cols-2">
          {(["editor", "poster"] as const).map((role) => (
            <div key={role} className="rounded-xl border border-border bg-background/40 p-4">
              <div className="text-sm font-semibold text-foreground capitalize">{role}</div>

              <div className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Page access</div>
              <div className="mt-2 space-y-2.5">
                {Object.entries(PAGE_LABELS).map(([key, label]) => (
                  <CapabilityToggle key={key} label={label} on={caps[role][key]} onClick={() => toggle(role, key)} />
                ))}
              </div>

              <div className="mt-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Actions</div>
              <div className="mt-2 space-y-2.5">
                {Object.entries(ACTION_LABELS).map(([key, label]) => (
                  <CapabilityToggle key={key} label={label} on={caps[role][key]} onClick={() => toggle(role, key)} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
        <div className="mt-4 flex items-center gap-3">
          <button disabled={saving} onClick={save} className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
            {saving ? "Saving…" : "Save capabilities"}
          </button>
          <button disabled={restoring} onClick={restoreDefaults} className="rounded-full border border-border px-5 py-2.5 text-sm text-muted-foreground hover:border-primary/40 disabled:opacity-50">
            {restoring ? "Loading…" : "↺ Restore defaults"}
          </button>
          {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
        </div>
      </Panel>
    </div>
  );
}

type OverviewData = {
  tier: string; credits_remaining: number; credits_used_this_month: number;
  team_members: number; ads_created_total: number; ads_created_this_month: number;
  campaigns_total: number; scheduled_pending: number; flagged_unresolved: number;
};

function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/admin/overview").then(setData).catch((e: any) => setErr(e.message || "Could not load overview"));
  }, []);

  if (err) return <div className="text-sm text-destructive">{err}</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const cards: [string, string | number][] = [
    ["Plan", data.tier.charAt(0).toUpperCase() + data.tier.slice(1)],
    ["Credits remaining", data.credits_remaining],
    ["Credits used this month", data.credits_used_this_month],
    ["Team members", data.team_members],
    ["Ads created (all time)", data.ads_created_total],
    ["Ads created this month", data.ads_created_this_month],
    ["Campaigns", data.campaigns_total],
    ["Scheduled (pending)", data.scheduled_pending],
    ["Flagged, unresolved", data.flagged_unresolved],
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([l, v]) => (
        <Panel key={l}>
          <div className="text-xs text-muted-foreground">{l}</div>
          <div className="mt-2 font-display text-2xl font-bold">{v}</div>
        </Panel>
      ))}
    </div>
  );
}


function Admin() {
  // "admin-only" isn't a real capability key that's ever granted to
  // editor/poster — this hook's role==="admin" check is what actually
  // allows admins through; for anyone else the capability lookup always
  // comes back false, so this reliably blocks non-admins. This was the
  // missing guard — the page had NO access check at all before this.
  const allowed = useRequireCapability("admin-only");

  const [tab, setTab] = useState(0);

  if (!allowed) return null; // redirecting away — this role can't view this page (checked after all hooks, per Rules of Hooks)

  return (
    <AppShell
      eyebrow="Insights"
      title={
        <span className="flex items-center gap-3">
          Admin
          <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">Admin view</span>
        </span>
      }
    >
      <div className="mb-6 flex flex-wrap gap-2 border-b border-border pb-4">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`rounded-full border px-4 py-1.5 text-xs font-medium transition ${i === tab ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>

      {tab === 0 && <OverviewTab />}
      {tab === 1 && <UsersTab />}
      {tab === 2 && <ProfilesTab />}
    </AppShell>
  );
}

