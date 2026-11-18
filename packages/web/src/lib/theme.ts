export type ThemePref = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "aria.theme.pref";
const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch { /* ignore */ }
  return "auto";
}

export function resolveTheme(pref: ThemePref, now = new Date()): ResolvedTheme {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mqLight = window.matchMedia("(prefers-color-scheme: light)");
    const mqDark = window.matchMedia("(prefers-color-scheme: dark)");
    if (mqLight.matches) return "light";
    if (mqDark.matches) return "dark";
  }
  const hour = now.getHours();
  return hour >= 7 && hour < 19 ? "light" : "dark";
}

export function applyTheme(pref: ThemePref = getThemePref()): ResolvedTheme {
  const resolved = resolveTheme(pref);
  if (typeof document !== "undefined") {
    if (document.documentElement.classList.contains("is-overlay")) {
      document.documentElement.dataset.theme = "dark";
      return "dark";
    }
    document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

export function setThemePref(pref: ThemePref): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, pref);
    } catch { /* ignore */ }
  }
  applyTheme(pref);
  listeners.forEach((fn) => fn());
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme(): () => void {
  applyTheme();
  if (typeof window === "undefined") return () => {};
  const onChange = () => {
    if (getThemePref() === "auto") {
      applyTheme("auto");
      listeners.forEach((fn) => fn());
    }
  };
  const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener?.("change", onChange);
  const timer = window.setInterval(onChange, 60_000);
  return () => {
    mq?.removeEventListener?.("change", onChange);
    window.clearInterval(timer);
  };
}
