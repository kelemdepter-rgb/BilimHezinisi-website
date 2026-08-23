"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { clearSearchHistory, readSearchHistory } from "@/lib/search/history";

/** Only this tab writes the list, so there is nothing to subscribe to. */
function subscribeToHistory() {
  return () => {};
}

/**
 * "What have I searched for, and take it away."
 *
 * The list never left this browser — there is no table and no request behind
 * it — so this is the only place it can be erased from, and erasing it here
 * erases it completely. The dropdown on the search box offers the same action
 * to a reader with no account.
 */
export function SearchHistoryControl() {
  const [cleared, setCleared] = useState(false);
  // Re-read on every render; clearing below causes one, and the count with it.
  const count = useSyncExternalStore(
    subscribeToHistory,
    () => readSearchHistory().length,
    () => 0,
  );

  return (
    <>
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        ئىزدىگەن سۆزلىرىڭىز پەقەت مۇشۇ تور كۆرگۈچتىلا ساقلىنىدۇ — مۇلازىمېتىرغا
        ئەۋەتىلمەيدۇ ۋە ساندانغا يېزىلمايدۇ. ئىزدەش رامكىسىنى چەككىنىڭىزدە ئەڭ
        ئاخىرقى بىر قانچىسى كۆرۈنىدۇ.
      </p>

      <p className="mt-3 text-[14px] font-semibold" data-testid="search-history-count">
        ساقلانغىنى: <span dir="ltr">{count}</span>
      </p>

      {cleared && (
        <p role="status" className="mt-2 text-[13px] text-ink2" data-testid="search-history-cleared">
          ئىزدەش تارىخىڭىز تولۇق ئۆچۈرۈلدى.
        </p>
      )}

      <button
        type="button"
        className="hbtn mt-4"
        data-testid="clear-search-history"
        disabled={count === 0}
        onClick={() => {
          clearSearchHistory();
          setCleared(true);
        }}
      >
        <Icon name="trash" />
        ئىزدەش تارىخىنى ئۆچۈرۈش
      </button>
    </>
  );
}
