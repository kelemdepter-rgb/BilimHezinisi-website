"use client";

import { useEffect } from "react";
import { sendDailySignal } from "@/lib/visits/beacon";

/**
 * Says «this device came today» once per UTC day (lib/visits/beacon.ts) —
 * what lets /admin/visits show devices beside page openings. Renders nothing.
 * Mounted once in the root layout, so it runs on whichever page a reader
 * opens first; client-side navigation does not mount it again.
 */
export function VisitBeacon() {
  useEffect(() => {
    try {
      sendDailySignal({
        storage: window.localStorage,
        today: new Date().toISOString().slice(0, 10),
        cookie: document.cookie,
        online: navigator.onLine,
        send: (url) => (typeof navigator.sendBeacon === "function" ? navigator.sendBeacon(url) : false),
      });
    } catch {
      // window.localStorage itself throws where storage is blocked: not counted.
    }
  }, []);
  return null;
}
