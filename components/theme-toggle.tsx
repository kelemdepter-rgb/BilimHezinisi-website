"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import { THEMES, THEME_COOKIE, type Theme } from "@/lib/theme";

const THEME_ICONS: Record<Theme, IconName> = {
  light: "sun",
  sepia: "scroll",
  dark: "moon",
};

const THEME_LABELS: Record<Theme, string> = {
  light: "كۈندۈز تۈسى",
  sepia: "سېپىيا تۈسى",
  dark: "كېچە تۈسى",
};

function subscribeToScheme(callback: () => void) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/** Cycles light → sepia → dark, persisting to a cookie so SSR matches. */
export function ThemeToggle({ initial }: { initial: Theme | null }) {
  const [chosen, setChosen] = useState<Theme | null>(initial);
  // With no stored choice the page follows the system scheme (see the
  // prefers-color-scheme block in globals.css) — mirror that in the button.
  const systemDark = useSyncExternalStore(
    subscribeToScheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );

  const theme: Theme = chosen ?? (systemDark ? "dark" : "light");
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

  function cycle() {
    setChosen(next);
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      className="ibtn"
      onClick={cycle}
      data-testid="theme-toggle"
      title={THEME_LABELS[next]}
      aria-label={`تۈس ئالماشتۇرۇش (ھازىر: ${THEME_LABELS[theme]})`}
    >
      <Icon name={THEME_ICONS[theme]} className="ic-lg" />
    </button>
  );
}
