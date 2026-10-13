"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { noteHistory, type HistoryUsage } from "@/lib/notes/history";
import { HISTORY_UNAVAILABLE } from "@/lib/notes/history-labels";
import { formatBytes } from "@/lib/pwa/storage";

/**
 * The notebook's earlier versions (PROMPT-46), on the account page's card
 * about what this site keeps on this device: how much they take, and a way to
 * clear them.
 *
 * Unlike the offline cache above it, what this clears cannot be downloaded
 * again — it exists only here — so the button asks once more, inline, before
 * it does anything. Never a native dialog.
 */
export function NoteHistoryStorage() {
  const [usage, setUsage] = useState<HistoryUsage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(false);
  /** Bumped after clearing, to measure again. */
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    void noteHistory.measure().then((next) => {
      if (alive) setUsage(next);
    });
    return () => {
      alive = false;
    };
  }, [round]);

  function clear() {
    setBusy(true);
    void noteHistory.clearAll().then((done) => {
      setBusy(false);
      setConfirming(false);
      setCleared(done);
      setRound((value) => value + 1);
    });
  }

  return (
    <div className="mt-5 border-t border-bd pt-4" data-testid="note-history-storage">
      <h3 className="flex items-center gap-2 text-[14px] font-bold">
        <Icon name="clock" className="text-am" />
        خاتىرىلەرنىڭ ئىلگىرىكى نۇسخىلىرى
      </h3>
      <p className="mt-1.5 text-[13px] leading-7 text-ink2">
        خاتىرە دەپتىرىدىكى «ئىلگىرىكى نۇسخىلار» پەقەت مۇشۇ ئۈسكۈنىدە ساقلىنىدۇ — بىزنىڭ
        مۇلازىمېتىرىمىزغا ئەۋەتىلمەيدۇ. ھېساباتتىن چىققاندا ئۆزلۈكىدىن ئۆچۈرۈلىدۇ.
      </p>

      {usage && !usage.ok ? (
        <p className="mt-2 text-[13px] leading-7 text-ink2" data-testid="note-history-unavailable">
          {HISTORY_UNAVAILABLE}
        </p>
      ) : (
        <>
          <p className="mt-3 text-[14px] font-semibold" data-testid="note-history-size">
            ھازىر ساقلانغان: <span dir="ltr">{usage ? formatBytes(usage.bytes) : "…"}</span>
            {/* The gap is a space outside the count: inside its own dir="ltr",
                a logical padding would land on the far side. */}
            {usage && usage.count > 0 && (
              <>
                {" "}
                <span className="text-[12.5px] font-normal text-ink3" dir="ltr">
                  ({usage.count})
                </span>
              </>
            )}
          </p>

          {cleared && (
            <p role="status" className="mt-2 text-[13px] text-ink2" data-testid="note-history-cleared">
              ئىلگىرىكى نۇسخىلار تازىلاندى.
            </p>
          )}

          {confirming ? (
            <div
              className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3"
              data-testid="note-history-confirm-box"
            >
              <p className="text-[13px] leading-7 text-ink">
                بارلىق ئىلگىرىكى نۇسخىلار بۇ ئۈسكۈنىدىن ئۆچۈرۈلىدۇ. خاتىرىلىرىڭىزنىڭ ئۆزى
                ئۆچمەيدۇ.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-danger"
                  data-testid="note-history-confirm"
                  disabled={busy}
                  onClick={clear}
                >
                  <Icon name="trash" />
                  {busy ? "تازىلىنىۋاتىدۇ…" : "ھەئە، تازىلاش"}
                </button>
                <button
                  type="button"
                  className="hbtn"
                  data-testid="note-history-cancel"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  بىكار قىلىش
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="hbtn mt-4"
              data-testid="note-history-clear"
              disabled={!usage || usage.count === 0}
              onClick={() => {
                setCleared(false);
                setConfirming(true);
              }}
            >
              <Icon name="trash" />
              تازىلاش
            </button>
          )}
        </>
      )}
    </div>
  );
}
