import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeveloperShell } from "@/components/developer-shell";
import { useRequireDeveloperPermission, useDevAuthErrorHandler } from "@/hooks/use-developer-auth";
import { devApi } from "@/lib/dev-api";

export const Route = createFileRoute("/developer/companies")({
  component: DeveloperCompanies,
  head: () => ({ meta: [{ title: "Companies & Users — NivaSpark Developer" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────
type AllUserRow = {
  id: string;
  company_id: string;
  company_name: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  email_verified: boolean;
  created_at: string | null;
  tier: string;
  subscription_status: string;
  credits_balance: number;
};

type CompanyRow = {
  id: string;
  name: string;
  tier: string;
  subscription_status: string;
  cancel_at_period_end: boolean;
  credits_balance: number;
  user_count: number;
  ads_total: number;
  created_at: string;
};

// ── Shared badge styles ───────────────────────────────────────────────────────
const TIER_BADGE: Record<string, string> = {
  free:    "border-border/60 text-muted-foreground",
  starter: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  pro:     "border-amber-500/30 bg-amber-500/10 text-amber-400",
  growth:  "border-purple-500/30 bg-purple-500/10 text-purple-400",
};

const ROLE_BADGE: Record<string, string> = {
  admin:  "border-primary/30 bg-primary/10 text-primary",
  editor: "border-border/60 text-muted-foreground",
  poster: "border-border/60 text-muted-foreground",
};

// ── Edit User Modal ───────────────────────────────────────────────────────────
function EditUserModal({ user, onClose, onSaved }: {
  user: AllUserRow;
  onClose: () => void;
  onSaved: (updated: AllUserRow) => void;
}) {
  const handleAuthError = useDevAuthErrorHandler();
  const [companyName, setCompanyName] = useState(user.company_name);
  const [fullName, setFullName] = useState(user.full_name);
  const [email, setEmail] = useState(user.email);
  const [tier, setTier] = useState(user.tier);
  const [status, setStatus] = useState(user.status);
  const [creditsAdjust, setCreditsAdjust] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true); setErr("");
    try {
      const body: Record<string, unknown> = { company_name: companyName, full_name: fullName, email, tier, status };
      const adj = parseFloat(creditsAdjust);
      if (!isNaN(adj) && adj !== 0) {
        body.credits_adjust = adj;
        body.credits_adjust_reason = adjustReason || "developer_manual_adjustment";
      }
      const r = await devApi(`/developer/companies/${user.company_id}`, { method: "PUT", body });
      onSaved({ ...user, company_name: r.company_name, full_name: r.full_name ?? fullName, email: r.email ?? email, tier: r.tier, credits_balance: r.credits_balance, status: r.status ?? status });
      onClose();
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not save");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-foreground">Edit User</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{user.email} · {user.company_name}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">
          {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{err}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Full name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Company name</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Plan tier</label>
              <select value={tier} onChange={(e) => setTier(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-2 text-sm text-foreground focus:border-ring focus:outline-none">
                <option value="free">Free (3 cr)</option>
                <option value="starter">Starter (150 cr)</option>
                <option value="pro">Pro (500 cr)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Account status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/40 px-2.5 py-2 text-sm text-foreground focus:border-ring focus:outline-none">
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="invited">Invited</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
              Credit adjustment
              <span className="ml-1 font-normal opacity-70">— current: {user.credits_balance} cr</span>
            </label>
            <div className="flex gap-2">
              <input type="number" step="0.25" value={creditsAdjust} onChange={(e) => setCreditsAdjust(e.target.value)}
                placeholder="+10 or −5"
                className="w-24 rounded-lg border border-border bg-input/40 px-2.5 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 rounded-lg border border-border bg-input/40 px-2.5 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
            </div>
          </div>

          <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 grid grid-cols-2 gap-2 text-[11px]">
            <div><span className="text-muted-foreground">Role: </span><span className="text-foreground capitalize">{user.role}</span></div>
            <div><span className="text-muted-foreground">Verified: </span><span className={user.email_verified ? "text-emerald-400" : "text-amber-400"}>{user.email_verified ? "Yes" : "No"}</span></div>
            <div><span className="text-muted-foreground">Joined: </span><span className="text-foreground">{user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}</span></div>
            <div><span className="text-muted-foreground">Company ID: </span><span className="text-foreground font-mono text-[9px]">{user.company_id.slice(0, 8)}…</span></div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button disabled={saving || !companyName.trim() || !email.trim()} onClick={save}
            className="rounded-full bg-gold-gradient px-5 py-1.5 text-xs font-semibold text-background disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Users view ────────────────────────────────────────────────────────────────
function UsersView() {
  const handleAuthError = useDevAuthErrorHandler();
  const [users, setUsers] = useState<AllUserRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState<"joined" | "company" | "name" | "credits">("joined");
  const [editing, setEditing] = useState<AllUserRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/all-users")
      .then(setUsers)
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load users"); });
  }, []);

  function handleSaved(updated: AllUserRow) {
    setUsers((cur) => cur ? cur.map((u) => u.id === updated.id ? updated : u) : cur);
  }

  async function handleDelete(userId: string) {
    setDeleting(true);
    try {
      await devApi(`/developer/users/${userId}`, { method: "DELETE" });
      setUsers((cur) => cur ? cur.filter((u) => u.id !== userId) : cur);
      setConfirmDeleteId(null);
    } catch (e: any) {
      if (!handleAuthError(e)) setErr(e.message || "Could not delete user");
    }
    setDeleting(false);
  }

  const filtered = (users || [])
    .filter((u) => {
      const q = search.toLowerCase();
      const matchSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.company_name.toLowerCase().includes(q);
      return matchSearch
        && (filterTier   === "all" || u.tier   === filterTier)
        && (filterRole   === "all" || u.role   === filterRole)
        && (filterStatus === "all" || u.status === filterStatus);
    })
    .sort((a, b) => {
      if (sortBy === "company") return a.company_name.localeCompare(b.company_name);
      if (sortBy === "name")    return (a.full_name || a.email).localeCompare(b.full_name || b.email);
      if (sortBy === "credits") return b.credits_balance - a.credits_balance;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });

  const SortBtn = ({ col, label }: { col: typeof sortBy; label: string }) => (
    <button onClick={() => setSortBy(col)}
      className={`text-left font-semibold transition ${sortBy === col ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {label}{sortBy === col ? " ↓" : ""}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Stats */}
      {users && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span><span className="font-semibold text-foreground">{users.length}</span> total users</span>
          <span><span className="font-semibold text-foreground">{users.filter(u => u.tier === "starter").length}</span> Starter</span>
          <span><span className="font-semibold text-foreground">{users.filter(u => u.tier === "pro").length}</span> Pro</span>
          <span><span className="font-semibold text-foreground">{users.filter(u => u.status === "active").length}</span> active</span>
          <span><span className="font-semibold text-foreground">{[...new Set(users.map(u => u.company_id))].length}</span> companies</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or company…"
          className="flex-1 min-w-48 rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none" />
        <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
          className="rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none">
          <option value="all">All plans</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
        </select>
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none">
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="poster">Poster</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="suspended">Suspended</option>
        </select>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} shown</span>
      </div>

      {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{err}</div>}

      {/* Table */}
      {users === null ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No users match your filters.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[750px]">
              <thead>
                <tr className="border-b border-border bg-card/60 text-left">
                  <th className="px-4 py-3"><SortBtn col="name" label="Name / Email" /></th>
                  <th className="px-4 py-3"><SortBtn col="company" label="Company" /></th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Plan</th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right"><SortBtn col="credits" label="Credits" /></th>
                  <th className="px-4 py-3 text-right"><SortBtn col="joined" label="Joined" /></th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((u) => (
                  <tr key={u.id} className="bg-card/30 hover:bg-card/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-card text-[10px] font-bold text-foreground">
                          {(u.full_name || u.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate max-w-[150px]">{u.full_name || "—"}</div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{u.email}</div>
                        </div>
                        {u.email_verified && <span className="text-[9px] text-emerald-400" title="Email verified">✓</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="truncate max-w-[130px] text-foreground">{u.company_name}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${ROLE_BADGE[u.role] || "border-border/60 text-muted-foreground"}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${TIER_BADGE[u.tier] || "border-border/60 text-muted-foreground"}`}>
                        {u.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                        u.status === "active"  ? "bg-emerald-500/10 text-emerald-400" :
                        u.status === "invited" ? "bg-amber-500/10 text-amber-400" :
                        "bg-red-500/10 text-red-400"
                      }`}>{u.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {Number.isInteger(u.credits_balance) ? u.credits_balance : u.credits_balance.toFixed(2).replace(/\.?0+$/, "")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setEditing(u)}
                          className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition whitespace-nowrap">
                          Edit
                        </button>
                        {confirmDeleteId === u.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-destructive font-medium whitespace-nowrap">Sure?</span>
                            <button disabled={deleting} onClick={() => handleDelete(u.id)}
                              className="rounded-full bg-destructive px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-50 whitespace-nowrap">
                              {deleting ? "…" : "Yes"}
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)}
                              className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap">
                              No
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(u.id)}
                            className="rounded-full border border-destructive/40 px-3 py-1 text-[11px] text-destructive/70 hover:border-destructive hover:text-destructive transition whitespace-nowrap">
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />}
    </div>
  );
}

// ── Companies view ────────────────────────────────────────────────────────────
function CompaniesView() {
  const handleAuthError = useDevAuthErrorHandler();
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [err, setErr] = useState("");

  useEffect(() => {
    devApi("/developer/companies")
      .then(setCompanies)
      .catch((e: any) => { if (!handleAuthError(e)) setErr(e.message || "Could not load companies"); });
  }, []);

  const filtered = (companies || []).filter((c) => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
    const matchTier = filterTier === "all" || c.tier === filterTier;
    return matchSearch && matchTier;
  });

  return (
    <div className="space-y-4">
      {companies && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span><span className="font-semibold text-foreground">{companies.length}</span> companies</span>
          <span><span className="font-semibold text-foreground">{companies.filter(c => c.tier === "starter").length}</span> Starter</span>
          <span><span className="font-semibold text-foreground">{companies.filter(c => c.tier === "pro").length}</span> Pro</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company name…"
          className="flex-1 min-w-48 rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none" />
        <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
          className="rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none">
          <option value="all">All plans</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
      </div>

      {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{err}</div>}

      {companies === null ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-card/60 text-left text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Sub status</th>
                <th className="px-4 py-3 font-semibold text-right">Credits</th>
                <th className="px-4 py-3 font-semibold text-right">Users</th>
                <th className="px-4 py-3 font-semibold text-right">Ads</th>
                <th className="px-4 py-3 font-semibold text-right">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((c) => (
                <tr key={c.id} className="bg-card/30 hover:bg-card/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{c.id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${TIER_BADGE[c.tier] || "border-border/60 text-muted-foreground"}`}>
                      {c.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">
                    {c.subscription_status}
                    {c.cancel_at_period_end && <span className="ml-1 text-amber-400">(canceling)</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {Number.isInteger(c.credits_balance) ? c.credits_balance : c.credits_balance.toFixed(2).replace(/\.?0+$/, "")}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{c.user_count}</td>
                  <td className="px-4 py-3 text-right text-foreground">{c.ads_total}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No companies match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Add User view ─────────────────────────────────────────────────────────────
function AddUserView({ onCreated }: { onCreated: () => void }) {
  const handleAuthError = useDevAuthErrorHandler();
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tier, setTier] = useState("free");
  const [creating, setCreating] = useState(false);
  const [createOk, setCreateOk] = useState("");
  const [createErr, setCreateErr] = useState("");

  async function createUser() {
    if (!companyName.trim()) { setCreateErr("Company name required"); return; }
    if (!email.trim() || !email.includes("@")) { setCreateErr("Valid email required"); return; }
    if (password.length < 8) { setCreateErr("Password must be at least 8 characters"); return; }
    setCreating(true); setCreateErr(""); setCreateOk("");
    try {
      const r = await devApi("/developer/create-user", {
        method: "POST",
        body: { company_name: companyName.trim(), email: email.trim(), password, full_name: fullName.trim(), tier },
      });
      setCreateOk(`✓ Created ${r.email} (${r.company}) — ${r.credits} credits on ${r.tier} plan`);
      setCompanyName(""); setEmail(""); setPassword(""); setFullName(""); setTier("free");
      onCreated();
    } catch (e: any) {
      if (!handleAuthError(e)) setCreateErr(e.message || "Could not create user");
    }
    setCreating(false);
  }

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-xs text-muted-foreground">
        Creates a company and admin user directly in the database. Works whether public registration is open or closed.
      </p>

      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Company name *</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acme.com"
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Password * (min 8 chars)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Plan tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/40 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none">
              <option value="free">Free (3 credits)</option>
              <option value="starter">Starter (150 credits)</option>
              <option value="pro">Pro (500 credits)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={createUser} disabled={creating}
            className="rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50">
            {creating ? "Creating…" : "Create user"}
          </button>
          {createOk && <span className="text-xs text-emerald-400">{createOk}</span>}
        </div>
        {createErr && <div className="text-xs text-destructive">{createErr}</div>}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function DeveloperCompanies() {
  const allowed = useRequireDeveloperPermission("companies");
  const [view, setView] = useState<"users" | "companies" | "add">("users");

  if (!allowed) return null;

  return (
    <DeveloperShell title="Users">
      {/* View toggle */}
      <div className="flex gap-2 mb-6">
        {([
          { key: "users",     label: "👥 All Users" },
          { key: "companies", label: "🏢 Companies" },
          { key: "add",       label: "➕ Add User" },
        ] as const).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium transition ${view === v.key
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "users"     && <UsersView />}
      {view === "companies" && <CompaniesView />}
      {view === "add"       && <AddUserView onCreated={() => setView("users")} />}
    </DeveloperShell>
  );
}
