"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { KeyboardControl } from "@/components/search/uyghur-keyboard";
import {
  clearSearchHistory,
  forgetSearch,
  isSearchHistoryOn,
  readSearchHistory,
  rememberSearch,
  setSearchHistoryOn,
  type SearchHistoryEntry,
} from "@/lib/search/history";

/**
 * A search box with the two things a phone in this audience needs: a way to
 * type Uyghur, and the searches already made.
 *
 * The form itself is not owned here — the header's box and the search page's
 * box are both plain `<form action="/search">`, and they still submit and
 * still work with no JavaScript at all. This attaches to whichever form the
 * input is inside, so the enhancement is exactly that: an enhancement.
 */
export function SearchField({
  placeholder,
  ariaLabel,
  defaultValue = "",
  testId,
  variant = "field",
  autoFocus = false,
  history = true,
  keyboardLabel,
}: {
  placeholder: string;
  ariaLabel: string;
  defaultValue?: string;
  testId?: string;
  /** `sbox` is the rounded header box; `field` is the page-level input. */
  variant?: "sbox" | "field";
  autoFocus?: boolean;
  /** Off for the Qur'an, whose corpus is not the library's. */
  history?: boolean;
  keyboardLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useState<SearchHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  /** Whether a list is being kept at all. Read from storage on focus. */
  const [historyOn, setHistoryOn] = useState(true);

  /**
   * Record the query on the way out.
   *
   * A submit listener on the form the input happens to be in, rather than an
   * onSubmit prop, because the form is server-rendered by whichever page owns
   * it. Listening in the capture phase means it runs before the navigation.
   */
  useEffect(() => {
    if (!history) return;
    const input = inputRef.current;
    const form = input?.form;
    if (!input || !form) return;
    const onSubmit = () => rememberSearch(input.value);
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [history]);

  // Tapping elsewhere closes the list — there is no Escape key on a phone.
  useEffect(() => {
    if (!showHistory) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setShowHistory(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHistory(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showHistory]);

  /** Only for an EMPTY box, exactly as the desktop app does it. */
  function openHistoryIfEmpty() {
    if (!history) return;
    const input = inputRef.current;
    if (!input || input.value.trim() !== "") return;
    /**
     * Read at focus time rather than on mount: the answer lives in
     * localStorage, which the server cannot know, and reading it here means
     * there is no first render to disagree with.
     */
    const on = isSearchHistoryOn();
    setHistoryOn(on);
    const entries = on ? readSearchHistory() : [];
    setRecent(entries);
    /**
     * Switched off there is nothing to offer — but the switch itself still
     * has to be reachable, or a reader who turned it off from here could
     * never turn it back on without an account.
     */
    setShowHistory(entries.length > 0 || !on);
  }

  function runHistoryEntry(query: string) {
    const input = inputRef.current;
    if (!input) return;
    input.value = query;
    setShowHistory(false);
    input.form?.requestSubmit();
  }

  /**
   * The floor on the header box's input is what keeps the scope picker beside
   * it honest: a long category name truncates its own label rather than eating
   * the space someone is typing in. 6rem is about eight Uyghur characters,
   * which is the least this box can be and still be a search box.
   */
  const inputClass = variant === "sbox" ? "sinput min-w-24" : "field min-w-48 flex-1";

  return (
    <div ref={wrapperRef} className={variant === "sbox" ? "contents" : "relative min-w-48 flex-1"}>
      {/*
        NONE OF THE ATTRIBUTES BELOW ARE DECORATION. Do not remove them.

        On 2026-09-02 the owner tapped this box on his own Android phone and
        Chrome's keyboard bar offered him a key, a card and a location pin;
        the card chip listed his real bank cards. The page cannot see any of
        that — it is browser chrome — but the hazard is real: this form is a
        GET, so a mis-tap would put a card number into `?q=` and from there
        into the address bar, the history, the Referer header on every
        outbound link, the access log, and the reader's own stored search
        history. One tap is enough.

        He then measured six variants on that same phone. The icons appeared
        with no `autocomplete` attribute, and did NOT appear with
        `autocomplete="off"` on both the form and this input. That matches
        what Chromium documents: `autocomplete="off"` is ignored for password,
        address and payment autofill, but is still honoured for the saved
        form entries a search box collects — which is the feature that was
        firing here. The four `data-*` attributes are the same opt-out for
        1Password, LastPass, Bitwarden and Dashlane, which have their own
        settings and do not read Chrome's.

        The forms are marked too — components/app-shell.tsx (both header
        forms), app/search/page.tsx, app/quran/(index)/page.tsx.
      */}
      <input
        ref={inputRef}
        className={inputClass}
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-form-type="other"
        {...(testId ? { "data-testid": testId } : {})}
        onFocus={openHistoryIfEmpty}
        onInput={() => setShowHistory(false)}
      />

      <KeyboardControl inputRef={inputRef} {...(keyboardLabel ? { label: keyboardLabel } : {})} />

      {showHistory && (
        <div
          data-testid="search-history"
          role="listbox"
          aria-label="يېقىنقى ئىزدەشلەر"
          /**
           * Anchored to the box for a page-level field; for the header's box
           * the wrapper is `display: contents`, so it hangs off the .sbox
           * itself, which is already positioned.
           */
          className="paper absolute inset-x-0 top-full z-40 mt-1.5 max-h-64 overflow-y-auto overscroll-contain py-1 shadow-[var(--shadow-2)]"
        >
          {recent.length > 0 && (
            <>
              <p className="px-3.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink3">
                يېقىنقى ئىزدەشلەر
              </p>
              <ul>
                {recent.map((entry) => (
                  <li key={entry.query} className="flex items-center gap-1 px-1.5">
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      data-testid="search-history-item"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius2)] px-2 text-start text-[13px] text-ink2 hover:bg-bg2 hover:text-ink"
                      // Keeps the input focused so the click is not eaten by blur.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => runHistoryEntry(entry.query)}
                    >
                      <Icon name="clock" className="shrink-0 text-ink3" />
                      <span className="min-w-0 flex-1 truncate">{entry.query}</span>
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      data-testid="search-history-remove"
                      aria-label={`«${entry.query}» نى تىزىملىكتىن ئۆچۈرۈش`}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        const next = forgetSearch(entry.query);
                        setRecent(next);
                        setShowHistory(next.length > 0 || !historyOn);
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/*
            Sticky, so eight entries cannot push the switch out of reach: the
            list scrolls inside the panel and these two rows stay on the
            screen. --paper is the panel's own background, so nothing shows
            through them.
          */}
          <div className="sticky bottom-0 mt-1 border-t border-bd bg-[var(--paper)]">
            {recent.length > 0 && (
              <button
                type="button"
                data-testid="search-history-clear"
                className="flex min-h-11 w-full items-center gap-2 px-3.5 text-[12.5px] text-ink3 hover:text-ink"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  clearSearchHistory();
                  setRecent([]);
                  setShowHistory(!historyOn);
                }}
              >
                <Icon name="trash" />
                ھەممىسىنى ئۆچۈرۈش
              </button>
            )}

            {/*
              The ONLY place a reader with no account can stop the list being
              kept — /my/account's control is behind a sign-in, and most of
              this audience has no account. Ticked means "do not keep one",
              which is the way round the label reads.
            */}
            <label
              className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3.5 text-[12.5px] text-ink2"
              data-testid="search-history-off-row"
            >
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-[var(--am)]"
                data-testid="search-history-off"
                autoComplete="off"
                checked={!historyOn}
                onChange={(event) => {
                  const on = !event.target.checked;
                  setSearchHistoryOn(on);
                  setHistoryOn(on);
                  // Turning it off erased the list; turning it back on starts
                  // from empty. Either way the panel stays open, so the tap
                  // is visibly the thing that happened.
                  setRecent(on ? readSearchHistory() : []);
                }}
              />
              <span>ئىزدەش تارىخىنى ساقلىماسلىق</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
