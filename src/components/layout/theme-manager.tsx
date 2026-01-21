"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

/**
 * ThemeManager
 * Synchronizes the global theme state from the store to the document element
 * to enable Tailwind's class-based dark mode.
 */
export function ThemeManager() {
  const theme = useAppStore((state) => state.theme);

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
