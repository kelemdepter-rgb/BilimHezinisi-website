"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { SW_URL } from "@/lib/pwa/constants";

/**
 * Registers the service worker, and offers the way out of a stale build.
 *
 * A service worker that has already been installed keeps serving the old
 * version until every tab of the site is closed — which on a phone, where
 * tabs are never closed, can be weeks. So when a new worker is waiting, the
 * reader is told, in one tap: nobody should be stuck on an old copy of a
 * library with no way to move.
 *
 * Renders nothing until there is something to say.
 */
export function OfflineBridge() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    /**
     * `?dev=1` in development only: the worker reads it and stops caching
     * Next's dev chunks, whose filenames do not change when the code does.
     * `updateViaCache: "none"` keeps the browser's HTTP cache out of the
     * update check, which is how a new deploy is noticed at all.
     */
    const url = process.env.NODE_ENV === "production" ? SW_URL : `${SW_URL}?dev=1`;

    void navigator.serviceWorker
      .register(url, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        const announce = (worker: ServiceWorker | null) => {
          // A worker only "waits" when one is already in charge. The very
          // first install has no predecessor to replace, so there is nothing
          // to tell anyone about.
          if (worker && navigator.serviceWorker.controller) setWaiting(worker);
        };

        announce(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") announce(installing);
          });
        });
      })
      .catch(() => {
        // No worker, no offline reading — and nothing else changes. Private
        // windows and a few locked-down browsers refuse registration outright.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // The new worker has taken over; the page has to be re-fetched through it
    // or half the tab is still running the old build.
    const onChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);

  if (!waiting || dismissed) return null;

  return (
    <div
      role="status"
      data-testid="sw-update-toast"
      /**
       * Clear of the reader's sticky bottom bar (mobile rules: a floating
       * element must never sit on a control), and clear of the phone's own
       * gesture area through the safe-area inset.
       */
      className="fixed inset-x-0 z-50 flex justify-center px-3 print:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)" }}
    >
      <div className="paper grain flex max-w-[min(100%,26rem)] items-center gap-2 px-3 py-2 shadow-[var(--shadow-2)]">
        <Icon name="refresh" className="shrink-0 text-am" />
        <span className="min-w-0 flex-1 text-[13px] leading-6">يېڭى نۇسخا تەييار</span>
        <button
          type="button"
          className="hbtn on"
          data-testid="sw-update-apply"
          disabled={updating}
          onClick={() => {
            setUpdating(true);
            // The reload happens in the controllerchange listener above,
            // once the new worker is actually in charge.
            waiting.postMessage({ type: "SKIP_WAITING" });
          }}
        >
          يېڭىلاش
        </button>
        <button
          type="button"
          className="ibtn shrink-0"
          data-testid="sw-update-dismiss"
          aria-label="ئۇقتۇرۇشنى تاقاش"
          onClick={() => setDismissed(true)}
        >
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}
