"use client";

import { useEffect } from "react";
import { sendPageSignal } from "@/lib/visits/beacon";

/** `window.localStorage` itself throws where storage is blocked. */
function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Sends this page load's one signal — a page opening, and once a UTC day a
 * device (lib/visits/beacon.ts). Renders nothing. Mounted once in the root
 * layout, so it runs once per full page load; moving between pages inside
 * the site does not mount it again.
 */
export function VisitBeacon() {
  useEffect(() => {
    sendPageSignal({
      storage: localStorageOrNull(),
      today: new Date().toISOString().slice(0, 10),
      cookie: document.cookie,
      path: window.location.pathname,
      online: navigator.onLine,
      send: (url) => (typeof navigator.sendBeacon === "function" ? navigator.sendBeacon(url) : false),
    });
  }, []);
  return null;
}
