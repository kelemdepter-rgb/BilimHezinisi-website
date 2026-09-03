"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import {
  clearSearchHistory,
  isSearchHistoryOn,
  readSearchHistory,
  setSearchHistoryOn,
} from "@/lib/search/history";

/**
 * Nothing outside this page writes the list while it is on screen, so the
 * "store" is just this page's own writes announcing themselves — enough to
 * re-read both snapshots below after the reader taps something.
 */
const listeners = new Set<() => void>();

function subscribeToHistory(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function announce() {
  for (const listener of [...listeners]) listener();
}

/**
 * "What have I searched for, take it away, and stop keeping it."
 *
 * The list never left this browser — there is no table and no request behind
 * it — so this is one of only two places it can be managed, and erasing it
 * here erases it completely. The other is the dropdown on the search box
 * itself, which is the one a reader with no account can reach; both write the
 * same key, so they always agree.
 */
export function SearchHistoryControl() {
  const [cleared, setCleared] = useState(false);
  const count = useSyncExternalStore(
    subscribeToHistory,
    () => readSearchHistory().length,
    () => 0,
  );
  /**
   * Server-rendered as "on", which is the default; corrected on the client,
   * because the answer lives in localStorage and no server can know it.
   */
  const on = useSyncExternalStore(subscribeToHistory, isSearchHistoryOn, () => true);

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
          announce();
        }}
      >
        <Icon name="trash" />
        ئىزدەش تارىخىنى ئۆچۈرۈش
      </button>

      {/* The same switch as the search box's, over the same key. */}
      <label
        className="mt-4 flex min-h-11 cursor-pointer items-center gap-3"
        data-testid="search-history-off-row"
      >
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-[var(--am)]"
          data-testid="search-history-off"
          autoComplete="off"
          checked={!on}
          onChange={(event) => {
            setSearchHistoryOn(!event.target.checked);
            announce();
          }}
        />
        <span className="text-[14px] font-semibold">ئىزدەش تارىخىنى ساقلىماسلىق</span>
      </label>

      <p className="mt-2 text-[12.5px] leading-6 text-ink3">
        بۇنى بەلگىلىسىڭىز ساقلانغىنى دەرھال ئۆچۈرۈلىدۇ ۋە يېڭىسى ساقلانمايدۇ. ئوخشاش
        بۇ تاللاش ئىزدەش رامكىسىنىڭ ئىچىدىمۇ بار.
      </p>
    </>
  );
}
