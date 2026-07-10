"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

/** Resolve the initial theme: saved choice first, then OS preference. */
function resolveInitialTheme(): "light" | "dark" {
  try {
    const saved = window.localStorage.getItem("enw_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage unavailable — fall through to OS preference.
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * ThemeManager
 * Hydrates the store's theme from the persisted choice (or OS preference)
 * and synchronizes it to the document element for Tailwind's class-based
 * dark mode. The inline script in layout.tsx applies the same resolution
 * before first paint, so there is no flash — this component just keeps the
 * store and DOM in agreement afterwards.
 */
export function ThemeManager() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  useEffect(() => {
    const initial = resolveInitialTheme();
    if (initial !== useAppStore.getState().theme) {
      setTheme(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;

    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  return null;
}
