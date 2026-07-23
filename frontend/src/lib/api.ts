// NivaSpark API client — talks to the FastAPI backend, stores JWT tokens,
// and transparently refreshes the access token once when it expires.
const BASE = "http://localhost:8000";

export type Tokens = { access_token: string; refresh_token: string; token_type: string };

export function getTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem("nivaad_tokens");
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}
export function setTokens(t: Tokens | null) {
  // sessionStorage (not localStorage) is deliberate: it's cleared as soon
  // as the tab/window is closed, so closing the browser signs the person
  // out — reopening the site always asks for login again. It still
  // survives normal page reloads/navigation within the same tab, and each
  // tab gets its own independent session (not shared across tabs).
  if (t) sessionStorage.setItem("nivaad_tokens", JSON.stringify(t));
  else sessionStorage.removeItem("nivaad_tokens");
}
export function clearTokens() {
  setTokens(null);
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function rawRequest(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const { method = "GET", body, token } = opts;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const msg = data?.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

/** Authenticated request with one automatic refresh-and-retry on 401. */
export async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const tokens = getTokens();
  try {
    return await rawRequest(path, { ...opts, token: tokens?.access_token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && tokens?.refresh_token) {
      const fresh = await rawRequest("/auth/refresh", { method: "POST", body: { refresh_token: tokens.refresh_token } });
      setTokens(fresh);
      return await rawRequest(path, { ...opts, token: fresh.access_token });
    }
    throw err;
  }
}

async function rawDownload(path: string, token?: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch { /* not JSON */ }
    throw new ApiError(msg, res.status);
  }
  return res.blob();
}

/** For endpoints that return a raw file (e.g. the ad ZIP export) instead of
 * JSON — same auth/refresh-and-retry behavior as `api()`, but resolves to a
 * Blob. Caller is responsible for triggering the actual browser download. */
export async function apiDownload(path: string): Promise<Blob> {
  const tokens = getTokens();
  try {
    return await rawDownload(path, tokens?.access_token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && tokens?.refresh_token) {
      const fresh = await rawRequest("/auth/refresh", { method: "POST", body: { refresh_token: tokens.refresh_token } });
      setTokens(fresh);
      return await rawDownload(path, fresh.access_token);
    }
    throw err;
  }
}

export type ProductOut = {
  id: string;
  name: string;
  description: string;
  audience: string;
  offer: string;
  image_url: string | null;
  created_at: string;
};

export type AdOut = {
  id: string;
  status: string;
  brief: Record<string, unknown>;
  platforms: string[];
  outputs: Record<string, unknown>;
  results: { variants: Record<string, any>[] } | null;
  favorite: boolean;
  product_id: string | null;
  campaign_id: string | null;
  campaign_phase: string | null;
  campaign_name: string | null;
  posted_at: string | null;
  posted_platforms: string[];
  next_scheduled_at: string | null;
  scheduled_posts: { id: string; platform: string; scheduled_at: string }[];
  created_at: string;
  error: string | null;
  agent_source: string | null;
};

export type AvailableModel = { id: string; label: string; credits: number; min_duration?: number; max_duration?: number; duration_options?: number[]; resolutions?: string[]; supports_audio?: boolean; supports_last_frame?: boolean; has_dynamic_pricing?: boolean };
export type AvailableModelsOut = { text: AvailableModel[]; image: AvailableModel[]; video: AvailableModel[] };

export type ScheduledPostOut = {
  id: string;
  ad_id: string;
  platform: string;
  scheduled_at: string;
  status: string;
  posted_at: string | null;
  ad_title: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_phase: string | null;
};

export type AdListOut = {
  items: AdOut[];
  total: number;
  page: number;
  page_size: number;
};

export type MeOut = {
  user: { id: string; email: string; full_name: string; role: string; status: string; email_verified: boolean };
  company_id: string;
  company_name: string;
  tier: string;
  credits: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  capabilities: Record<string, boolean>;
};

export type InviteCheckOut = { email: string; full_name: string; company_name: string; inviter_name: string };
export type RoleCapabilities = { editor: Record<string, boolean>; poster: Record<string, boolean> };
export type TeamUserOut = { id: string; email: string; full_name: string; role: string; status: string; invited_at: string | null; created_at: string };

export const authApi = {
  async register(payload: { company_name: string; email: string; password: string; full_name?: string; accept_aup: boolean }) {
    const tokens = await rawRequest("/auth/register", { method: "POST", body: payload });
    setTokens(tokens);
    return tokens as Tokens;
  },
  async login(payload: { email: string; password: string }) {
    const tokens = await rawRequest("/auth/login", { method: "POST", body: payload });
    setTokens(tokens);
    return tokens as Tokens;
  },
  me(): Promise<MeOut> {
    return api("/auth/me");
  },
  checkInvite(token: string): Promise<InviteCheckOut> {
    return rawRequest(`/auth/invite/${token}`) as Promise<InviteCheckOut>;
  },
  async acceptInvite(payload: { token: string; password: string; full_name?: string }) {
    const tokens = await rawRequest("/auth/accept-invite", { method: "POST", body: payload });
    setTokens(tokens);
    return tokens as Tokens;
  },
};
