import { useEffect, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "nivaad-theme";

function readStoredTheme(): "light" | "dark" | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return null;
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useTheme() {
  // Initialize synchronously from storage so mounting a new instance (e.g.
  // after route change) doesn't flash the default theme.
  const [theme, setTheme] = useState<"light" | "dark">(() => readStoredTheme() ?? "dark");

  useIsoLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  // Keep multiple hook instances in sync across route changes / tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { theme, setTheme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      className={`grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-foreground transition hover:border-primary/60 hover:text-primary ${className}`}
    >
      <span aria-hidden className="text-sm">{isDark ? "☾" : "☀"}</span>
    </button>
  );
}