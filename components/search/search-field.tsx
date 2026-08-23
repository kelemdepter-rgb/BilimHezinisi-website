"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { KeyboardControl } from "@/components/search/uyghur-keyboard";
import {
  clearSearchHistory,
  forgetSearch,
  readSearchHistory,
  rememberSearch,
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
    const entries = readSearchHistory();
    setRecent(entries);
    setShowHistory(entries.length > 0);
  }

  function runHistoryEntry(query: string) {
    const input = inputRef.current;
    if (!input) return;
    input.value = query;
    setShowHistory(false);
    input.form?.requestSubmit();
  }

  const inputClass = variant === "sbox" ? "sinput" : "field min-w-48 flex-1";

  return (
    <div ref={wrapperRef} className={variant === "sbox" ? "contents" : "relative min-w-48 flex-1"}>
      <input
        ref={inputRef}
        className={inputClass}
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        {...(testId ? { "data-testid": testId } : {})}
        onFocus={openHistoryIfEmpty}
        onInput={() => setShowHistory(false)}
      />

      <KeyboardControl inputRef={inputRef} {...(keyboardLabel ? { label: keyboardLabel } : {})} />

      {showHistory && recent.length > 0 && (
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
                    setShowHistory(next.length > 0);
                  }}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="search-history-clear"
            className="mt-1 flex min-h-11 w-full items-center gap-2 border-t border-bd px-3.5 text-[12.5px] text-ink3 hover:text-ink"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              clearSearchHistory();
              setRecent([]);
              setShowHistory(false);
            }}
          >
            <Icon name="trash" />
            ھەممىسىنى ئۆچۈرۈش
          </button>
        </div>
      )}
    </div>
  );
}
