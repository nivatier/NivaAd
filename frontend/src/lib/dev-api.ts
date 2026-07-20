// Developer (platform operator) API client — DELIBERATELY separate from
// src/lib/api.ts. Uses its own localStorage key so a developer session
// and a company session can coexist in the same browser without ever
// colliding, and its own fetch wrapper with no refresh-token logic
// (developer tokens are long-lived (12h) and there's no company user
// row to refresh against — matches how the backend's require_developer
// never touches the User/Company tables at all).
const BASE = "http://localhost:8000";
const DEV_TOKEN_KEY = "nivaad_dev_token";
const DEV_IDENTITY_KEY = "nivaad_dev_identity";

export type DevIdentity = { is_owner: boolean; permissions: Record<string, boolean> };

export function getDevToken(): string | null {
  if (typeof window === "undefined") return null; // SSR — localStorage doesn't exist server-side; this hook runs during the initial server render before hydration
  return localStorage.getItem(DEV_TOKEN_KEY);
}
export function setDevToken(token: string | null) {
  if (typeof window === "undefined") return; // no-op during SSR — nothing to persist to on the server, and this should never actually be reached there (only called from client-side event handlers), but guard anyway for safety
  if (token) localStorage.setItem(DEV_TOKEN_KEY, token);
  else localStorage.removeItem(DEV_TOKEN_KEY);
}
export function clearDevToken() {
  setDevToken(null);
  setDevIdentity(null);
}

/** Owner vs team member + which sections a team member was granted —
 * stored alongside the token at login so every page can gate itself
 * without an extra round-trip. Owner (is_owner: true) always passes
 * every check regardless of what's in `permissions`. */
export function getDevIdentity(): DevIdentity {
  if (typeof window === "undefined") return { is_owner: true, permissions: {} };
  try {
    const raw = localStorage.getItem(DEV_IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as DevIdentity) : { is_owner: true, permissions: {} };
  } catch {
    return { is_owner: true, permissions: {} };
  }
}
export function setDevIdentity(identity: DevIdentity | null) {
  if (typeof window === "undefined") return;
  if (identity) localStorage.setItem(DEV_IDENTITY_KEY, JSON.stringify(identity));
  else localStorage.removeItem(DEV_IDENTITY_KEY);
}

class DevApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function devApi(path: string, opts: { method?: string; body?: unknown } = {}) {
  const { method = "GET", body } = opts;
  const token = getDevToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = data?.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : `Request failed (${res.status})`;
    throw new DevApiError(msg, res.status);
  }
  return data;
}

export type PlatformOverviewOut = {
  total_companies: number;
  companies_by_tier: Record<string, number>;
  active_paid_subscriptions: number;
  estimated_mrr_usd: number;
  total_users: number;
  total_ads: number;
  total_campaigns: number;
  flagged_unresolved_total: number;
};

export type OpenRouterCreditsOut = {
  total_credits: number;
  total_usage: number;
  remaining: number;
};

export type CompanyAdminOut = {
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

export type DeveloperModel = { id: string; label: string; model: string; credits: number; min_duration?: number; max_duration?: number; duration_options?: number[]; resolutions?: string[]; supports_audio?: boolean; supports_last_frame?: boolean; price_per_second_usd?: number; enabled?: boolean; pricing?: Record<string, unknown> | null };
export type DeveloperModelsOut = { text: DeveloperModel[]; image: DeveloperModel[]; video: DeveloperModel[] };
export type OpenRouterCatalogModel = { slug: string; name: string; description?: string; price_per_second_usd?: number; price_per_image_usd?: number; resolutions?: string[]; max_duration?: number };
export type PlatformIntegration = { id: string; label: string; client_id: string; has_secret: boolean; scope?: string; redirect_uri?: string; enabled: boolean; built: boolean; video_ratio: string };
export type GuardrailRuleOut = { id: string; phrase: string; created_at: string };

export type DeveloperTeamUser = { id: string; email: string; full_name: string; permissions: Record<string, boolean>; status: string; created_at: string };

export const devAuthApi = {
  async login(email: string, password: string) {
    const res = await devApi("/developer/login", { method: "POST", body: { email, password } });
    setDevToken(res.access_token);
    setDevIdentity({ is_owner: res.is_owner, permissions: res.permissions || {} });
    return res;
  },
  logout() {
    clearDevToken();
  },
};
