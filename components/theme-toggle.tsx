"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import { THEMES, THEME_COOKIE, isTheme, type Theme } from "@/lib/theme";

/** The visitor's stored choice, read in the browser rather than on the server. */
function cookieTheme(): Theme | null {
  const match = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`).exec(document.cookie);
  const value = match ? decodeURIComponent(match[1]) : null;
  return isTheme(value) ? value : null;
}

/** The cookie cannot change without this tab setting it, so there is nothing
    to subscribe to — the snapshot is read once per render and that is enough. */
function subscribeToCookie() {
  return () => {};
}

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

/**
   * Normally the server has already read the cookie and stamped data-theme on
   * <html>, so `initial` is set and this is ignored. It matters for a page
   * served from the offline cache: that copy was fetched without cookies, so
   * it arrives with no theme at all, and a reader who chose sepia or night
   * would suddenly be looking at a white screen in the dark.
   */
  const stored = useSyncExternalStore(subscribeToCookie, cookieTheme, () => null);

  useEffect(() => {
    if (initial !== null || stored === null) return;
    document.documentElement.setAttribute("data-theme", stored);
  }, [initial, stored]);

  const theme: Theme = chosen ?? stored ?? (systemDark ? "dark" : "light");
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
