"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { clearStorage, formatBytes, measureStorage, type StorageUsage } from "@/lib/pwa/storage";

/** Cache Storage support is a fact about the browser, fixed for the page's life. */
function subscribeToSupport() {
  return () => {};
}

/**
 * "How much room is the library taking, and give it back" — on the account
 * page, where the rest of "what this site keeps about me" already lives.
 *
 * Nothing here is destructive in the way the delete-account block below it
 * is: everything cleared can be downloaded again the next time there is a
 * connection. So there is no confirmation step, only an honest number.
 */
export function OfflineStorage() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(false);
  /** Bumped after clearing, to measure again. */
  const [round, setRound] = useState(0);

  // Private windows and a few locked-down browsers have no Cache Storage at
  // all; assumed present while rendering on the server, where it never is.
  const supported = useSyncExternalStore(
    subscribeToSupport,
    () => typeof caches !== "undefined",
    () => true,
  );

  useEffect(() => {
    let alive = true;
    void measureStorage().then((next) => {
      if (alive) setUsage(next);
    });
    return () => {
      alive = false;
    };
  }, [round]);

  if (!supported) {
    return (
      <p className="mt-2 text-[13px] leading-7 text-ink2" data-testid="offline-storage-unsupported">
        بۇ تور كۆرگۈچ تورسىز ئوقۇشنى قوللىمايدۇ، شۇڭا ساقلانغان مەزمۇن يوق.
      </p>
    );
  }

  return (
    <>
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        تورسىز ئوقۇش ئۈچۈن ئېچىپ باققان كىتاب بەتلىرى، مۇقاۋىلار، كۆرۈنمە يۈز ھۆججەتلىرى ۋە
        ئىملا لۇغىتى ئۈسكۈنىڭىزدە ساقلىنىدۇ. تازىلىسىڭىز بوشلۇق قايتىدۇ؛ كىتابلىرىڭىز
        كۇتۇپخانىدىن ئۆچمەيدۇ، تور بار چاغدا قايتا ساقلىنىدۇ.
      </p>

      <p className="mt-3 text-[14px] font-semibold" data-testid="offline-storage-size">
        ھازىر ساقلانغان: <span dir="ltr">{usage ? formatBytes(usage.bytes) : "…"}</span>
        {usage && usage.entries > 0 && (
          <span className="ps-2 text-[12.5px] font-normal text-ink3" dir="ltr">
            ({usage.entries})
          </span>
        )}
      </p>

      {cleared && (
        <p role="status" className="mt-2 text-[13px] text-ink2" data-testid="offline-storage-cleared">
          ساقلانغان مەزمۇن تازىلاندى.
        </p>
      )}

      <button
        type="button"
        className="hbtn mt-4"
        data-testid="offline-storage-clear"
        disabled={busy || usage?.bytes === 0}
        onClick={() => {
          setBusy(true);
          setCleared(false);
          void clearStorage().then(() => {
            setBusy(false);
            setCleared(true);
            setRound((value) => value + 1);
          });
        }}
      >
        <Icon name="trash" />
        {busy ? "تازىلىنىۋاتىدۇ…" : "ساقلانغان مەزمۇننى تازىلاش"}
      </button>
    </>
  );
}
