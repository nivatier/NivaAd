import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authApi, clearTokens, getTokens, type MeOut } from "@/lib/api";

type AuthState = {
  loading: boolean;
  me: MeOut | null;
  isAuthed: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  // Lets AppShell's "redirect to /login if not authenticated" guard tell an
  // intentional logout apart from an expired/missing session, so logging out
  // goes to the home page instead of racing with the guard to /login.
  loggingOutRef: React.MutableRefObject<boolean>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeOut | null>(null);
  const loggingOutRef = useRef(false);

  async function refresh() {
    if (!getTokens()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const result = await authApi.me();
      setMe(result);
    } catch {
      clearTokens();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function logout() {
    loggingOutRef.current = true;
    clearTokens();
    setMe(null);
  }

  return (
    <AuthContext.Provider value={{ loading, me, isAuthed: !!me, refresh, logout, loggingOutRef }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
