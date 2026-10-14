"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { titleComparer } from "@/lib/notes/list-sort";
import {
  EXPORT_FILE_NAME,
  MAX_IMPORT_BYTES,
  exportPersonal,
  mergeImport,
} from "@/lib/spellcheck/personal";
import {
  getPersonalServerSnapshot,
  getPersonalSnapshot,
  setPersonalWords,
  subscribePersonal,
} from "@/lib/spellcheck/personal-store";

export const DICTIONARY_TITLE = "شەخسىي لۇغەت";
const DEVICE_ONLY =
  "بۇ لۇغەت پەقەت مۇشۇ تور كۆرگۈچتە ساقلىنىدۇ. باشقا ئۈسكۈنىگە يۆتكىمەكچى بولسىڭىز، بۇ يەردىن چىقىرىپ، ئۇ يەردە كىرگۈزۈڭ.";
const GLUED_HINT = "بەلكىم ئىككى سۆز چاپلىشىپ قالغان — تەكشۈرۈپ بېقىڭ";
const NOT_A_LIST = "بۇ ھۆججەتنى كىرگۈزگىلى بولمىدى: ئۇنىڭدا سۆزلەر تىزىملىكى (JSON) بولۇشى كېرەك.";
const TOO_BIG = "بۇ ھۆججەت بەك چوڭ — بۇ يەردىن چىقىرىلغان لۇغەت ھۆججىتىنى تاللاڭ.";
const UNREADABLE = "ھۆججەتنى ئوقۇغىلى بولمىدى.";
const NOT_KEPT = "بۇ تور كۆرگۈچ لۇغەتنى ساقلىمىدى — ئۆزگىرىش پەقەت بۇ بەت ئوچۇق تۇرغىچە ئىناۋەتلىك.";
/** A long list is drawn this far; the filter finds the rest. */
const SHOWN = 500;

/**
 * «شەخسىي لۇغەت» — the words this writer told the checker are right, where
 * they can be seen, filtered, deleted, cleared, exported and imported
 * (PROMPT-48 D).
 *
 * A sheet from the bottom on a phone and a side panel from 1024 px up, like
 * «ئىلگىرىكى نۇسخىلار» beside it: on a phone it covers the page, so the page
 * behind is held still and the list scrolls inside the sheet.
 *
 * Every change goes through the store (lib/spellcheck/personal-store.ts), and
 * from there to the running checker at once: a word deleted here is marked
 * again in the note behind before the panel is closed.
 */
export function DictionaryPanel({
  open,
  onClose,
  findGlued,
}: {
  open: boolean;
  onClose: () => void;
  /** Entries that look like two words stuck together; null when the dictionary would not load. */
  findGlued: (words: readonly string[]) => Promise<string[] | null>;
}) {
  const words = useSyncExternalStore(subscribePersonal, getPersonalSnapshot, getPersonalServerSnapshot);
  const [filter, setFilter] = useState("");
  const [asking, setAsking] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  /** Entries that look like two words stuck together. A hint only — nothing is removed for it. */
  const [glued, setGlued] = useState<ReadonlySet<string>>(() => new Set());
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Fresh on every open, adjusted during the render that notices. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFilter("");
      setAsking(false);
      setReport(null);
    }
  }

  const sorted = useMemo(() => [...words].sort(titleComparer()), [words]);
  const needle = filter.trim();
  const shown = useMemo(
    () => (needle ? sorted.filter((word) => word.includes(needle)) : sorted),
    [needle, sorted],
  );

  // The glued hints come from the worker, which has the dictionary.
  useEffect(() => {
    if (!open || words.length === 0) return;
    let alive = true;
    void findGlued(words).then((list) => {
      if (alive && list) setGlued(new Set(list));
    });
    return () => {
      alive = false;
    };
  }, [findGlued, open, words]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  /** Escape closes; the page is held still only where the sheet covers it. */
  useEffect(() => {
    if (!open) return;
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    if (narrow) document.documentElement.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  function save(next: readonly string[]): boolean {
    const kept = setPersonalWords(next);
    if (!kept) setReport(NOT_KEPT);
    return kept;
  }

  function remove(word: string) {
    setReport(null);
    save(words.filter((entry) => entry !== word));
  }

  function clearAll() {
    setAsking(false);
    if (save([])) setReport("لۇغەت تازىلاندى.");
  }

  /** «چىقىرىش» — the list as a JSON file, in the order shown here. */
  function download() {
    const url = URL.createObjectURL(new Blob([exportPersonal(sorted)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = EXPORT_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // After the browser has taken the download, not before.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /**
   * «كىرگۈزۈش» — a file the writer chose, merged in. Untrusted: it is read as
   * text, parsed as JSON and checked word by word (lib/spellcheck/personal.ts
   * mergeImport); nothing in it is ever run or put on the page as HTML.
   */
  async function upload(file: File) {
    setReport(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setReport(TOO_BIG);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setReport(UNREADABLE);
      return;
    }
    // Merged into the list as it is NOW: another tab may have changed it.
    const result = mergeImport(getPersonalSnapshot(), text);
    if (!result.ok) {
      setReport(NOT_A_LIST);
      return;
    }
    if (result.added > 0 && !save(result.words)) return;
    setReport(`${result.added} سۆز قوشۇلدى، ${result.rejected} سۆز رەت قىلىندى.`);
  }

  return (
    <>
      {/* Only where the sheet covers the page — see above. */}
      <div
        data-testid="dictionary-overlay"
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/45 lg:hidden print:hidden"
      />
      <aside
        data-testid="dictionary-panel"
        role="dialog"
        aria-label={DICTIONARY_TITLE}
        className="grain safe-x fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-bd bg-bg shadow-[var(--shadow-2)] print:hidden lg:inset-x-auto lg:inset-y-0 lg:end-0 lg:h-dvh lg:max-h-none lg:w-[26rem] lg:rounded-none lg:border-s lg:border-t-0 lg:pt-[env(safe-area-inset-top)]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-bd px-3">
          <span className="flex items-center gap-2 text-[14px] font-bold">
            <Icon name="book-marked" className="text-am" />
            {DICTIONARY_TITLE}
            <span className="text-[12.5px] font-normal text-ink3" data-testid="dictionary-count">
              {words.length} سۆز
            </span>
          </span>
          <button
            type="button"
            ref={closeRef}
            className="ibtn"
            data-testid="dictionary-close"
            aria-label="تاقاش"
            onClick={onClose}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>

        {/* Outside the scrolling part, so they stay in reach however long the list is. */}
        <div className="shrink-0 space-y-2 border-b border-bd px-3 py-2">
          <p className="text-[12.5px] leading-6 text-ink2" data-testid="dictionary-device-only">
            {DEVICE_ONLY}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="hbtn"
              data-testid="dictionary-export"
              disabled={words.length === 0}
              onClick={download}
            >
              <Icon name="download" />
              چىقىرىش
            </button>
            <button
              type="button"
              className="hbtn"
              data-testid="dictionary-import"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="upload" />
              كىرگۈزۈش
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="dictionary-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // The same file can be chosen again after a fix.
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
            {!asking && (
              <button
                type="button"
                className="hbtn"
                data-testid="dictionary-clear"
                disabled={words.length === 0}
                onClick={() => {
                  setReport(null);
                  setAsking(true);
                }}
              >
                <Icon name="trash" />
                ھەممىنى ئۆچۈرۈش
              </button>
            )}
          </div>

          {asking && (
            <div
              className="rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3"
              role="group"
              aria-label="لۇغەتنى تازىلاش"
              data-testid="dictionary-clear-box"
            >
              <p className="text-[13px] leading-7 text-ink">
                لۇغەتتىكى {words.length} سۆزنىڭ ھەممىسى ئۆچىدۇ. بۇنى قايتۇرغىلى بولمايدۇ — ساقلاپ قويماقچى
                بولسىڭىز، ئالدى بىلەن «چىقىرىش» نى بېسىڭ.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-danger" data-testid="dictionary-clear-confirm" onClick={clearAll}>
                  <Icon name="trash" />
                  ھەئە، ھەممىنى ئۆچۈرۈش
                </button>
                {/* Focus starts on the way out, not on the button that destroys. */}
                <button
                  type="button"
                  className="hbtn"
                  data-testid="dictionary-clear-cancel"
                  autoFocus
                  onClick={() => setAsking(false)}
                >
                  بىكار قىلىش
                </button>
              </div>
            </div>
          )}

          {report && (
            <p role="status" className="text-[12.5px] leading-6 text-ink2" data-testid="dictionary-report">
              {report}
            </p>
          )}

          {words.length > 0 && (
            <input
              autoComplete="off"
              className="field"
              type="search"
              value={filter}
              maxLength={64}
              data-testid="dictionary-filter"
              aria-label="لۇغەتتىن ئىزدەش"
              placeholder="سۆز ئىزدەش…"
              onChange={(event) => setFilter(event.target.value)}
            />
          )}
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          data-testid="dictionary-scroll"
        >
          {words.length === 0 ? (
            <p className="py-3 text-[13px] leading-7 text-ink3" data-testid="dictionary-empty">
              لۇغەتتە ھازىرچە سۆز يوق. ئىملا تەكشۈرگەندە بىر سۆزنى بېسىپ «لۇغەتكە قوش» نى تاللىسىڭىز،
              ئۇ سۆز بۇ يەرگە قوشۇلىدۇ.
            </p>
          ) : shown.length === 0 ? (
            <p className="py-3 text-[13px] text-ink3" data-testid="dictionary-none">
              بۇنداق سۆز يوق.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-bd" data-testid="dictionary-list">
                {shown.slice(0, SHOWN).map((word) => (
                  <li key={word} className="flex items-center gap-2 py-1" data-testid="dictionary-row">
                    <span className="min-w-0 flex-1">
                      {/* Text, never markup: a word is put on the page as a string. */}
                      <span
                        className="block text-[15px] text-ink [overflow-wrap:anywhere]"
                        dir="rtl"
                        data-testid="dictionary-word"
                      >
                        {word}
                      </span>
                      {glued.has(word) && (
                        <span className="block text-[12px] leading-5 text-ink3" data-testid="dictionary-glued">
                          {GLUED_HINT}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="ibtn shrink-0"
                      data-testid="dictionary-delete"
                      aria-label={`«${word}» نى ئۆچۈرۈش`}
                      onClick={() => remove(word)}
                    >
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
              {shown.length > SHOWN && (
                <p className="py-3 text-[12.5px] text-ink3" data-testid="dictionary-more">
                  يەنە {shown.length - SHOWN} سۆز بار — ئىزدەش رامكىسىغا يېزىپ تېپىڭ.
                </p>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
