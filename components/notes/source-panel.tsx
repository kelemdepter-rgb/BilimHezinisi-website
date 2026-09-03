"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { KeyboardControl, type TextField } from "@/components/search/uyghur-keyboard";
import { Snippet } from "@/components/search/snippet";
import { AyaText } from "@/components/quran/aya-text";
import {
  expandPassageAction,
  getAyaForNoteAction,
  searchLibraryForNoteAction,
  searchQuranForNoteAction,
  type NoteSourceHit,
} from "@/app/notes/source-actions";
import { ayaHref, readerHref, sourceInsertHtml, ayaInsertHtml } from "@/lib/notes/insert";
import type { AyaRenderMode } from "@/lib/quran/copy";
import type { Aya, QuranHit } from "@/lib/quran/types";

/**
 * The library, beside the note being written.
 *
 * Ported from the desktop's right-hand pane (src/notes.js — «مەنبە» and
 * «قۇرئان»), with the one difference the web makes possible: every result links
 * to the reader, so a citation can be followed rather than merely believed.
 *
 * TWO SHAPES, ONE COMPONENT. Below `lg` it is a modal drawer: it covers the
 * screen, so the page behind it is locked and an overlay closes it — anything
 * else on a phone means scrolling the wrong thing. From `lg` up it is a plain
 * side panel with no overlay and no lock, because a writer with the room for it
 * wants to cite three passages in a row without reopening anything.
 *
 * The panel never touches the editor itself. It hands finished HTML to
 * `onInsert`, and the editor puts it where the caret was.
 */

const MODE_LABELS: Record<AyaRenderMode, string> = {
  ar: "ئەرەبچە",
  ug: "تەرجىمىسى",
  both: "تەرجىمىسى بىلەن",
};

type Tab = "books" | "quran";

export function SourcePanel({
  open,
  initialQuery,
  onClose,
  onInsert,
}: {
  open: boolean;
  /** Whatever was selected in the note when the panel was opened. */
  initialQuery: string;
  onClose: () => void;
  onInsert: (html: string, message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("books");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NoteSourceHit[] | null>(null);
  const [tooCommon, setTooCommon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Full paragraphs fetched on demand, keyed by book and page. */
  const [passages, setPassages] = useState<Record<string, string>>({});

  const [sura, setSura] = useState("");
  const [aya, setAya] = useState("");
  const [mode, setMode] = useState<AyaRenderMode>("both");
  const [preview, setPreview] = useState<{ aya: Aya; suraNameUg: string } | null>(null);
  const [quranQuery, setQuranQuery] = useState("");
  const [quranHits, setQuranHits] = useState<QuranHit[] | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const quranSearchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * Opening pre-fills the box with whatever was selected in the note, which is
   * the desktop's behaviour and saves retyping the sentence being cited.
   *
   * Adjusted during render rather than in an effect: this is state derived from
   * a prop changing, so React re-renders before painting and the box is never
   * seen empty for a frame.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && initialQuery.trim()) setQuery(initialQuery.trim());
  }

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  /**
   * Escape closes; the body is locked only on the narrow layout, where the
   * panel really is covering the page. On a wide screen the page behind stays
   * scrollable on purpose.
   */
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

  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    const result = await searchLibraryForNoteAction({ query: term });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHits(result.hits);
    setTooCommon(result.tooCommon);
    setPassages({});
  }, [query]);

  const runQuranSearch = useCallback(async () => {
    const term = quranQuery.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    const result = await searchQuranForNoteAction({ query: term });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuranHits(result.hits);
  }, [quranQuery]);

  const loadPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await getAyaForNoteAction({ sura: Number(sura), aya: Number(aya) });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setPreview(null);
      return;
    }
    setPreview({ aya: result.aya, suraNameUg: result.suraNameUg });
  }, [sura, aya]);

  async function expand(hit: NoteSourceHit) {
    const key = `${hit.bookId}:${hit.pageNo}`;
    if (passages[key]) {
      setPassages((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const result = await expandPassageAction({
      bookId: hit.bookId,
      pageNo: hit.pageNo,
      query: query.trim(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPassages((prev) => ({ ...prev, [key]: result.passage }));
  }

  function insertSource(hit: NoteSourceHit) {
    const key = `${hit.bookId}:${hit.pageNo}`;
    onInsert(
      sourceInsertHtml({
        bookId: hit.bookId,
        title: hit.title,
        author: hit.author,
        pageNo: hit.pageNo,
        passage: passages[key] ?? hit.snippet,
        query: query.trim(),
      }),
      "مەنبە قىستۇرۇلدى.",
    );
  }

  async function insertAya(target: { sura: number; aya: number }, suraNameUg?: string) {
    let verse = preview;
    if (!verse || verse.aya.sura !== target.sura || verse.aya.aya !== target.aya) {
      const result = await getAyaForNoteAction(target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      verse = { aya: result.aya, suraNameUg: result.suraNameUg };
    }
    onInsert(
      ayaInsertHtml(verse.aya, mode, suraNameUg ?? verse.suraNameUg),
      "ئايەت قىستۇرۇلدى.",
    );
  }

  return (
    <>
      {/* The overlay exists only on the narrow layout — see the note above. */}
      <div
        data-testid="source-overlay"
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/45 transition-[opacity,visibility] duration-200 lg:hidden print:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      />
      <aside
        data-testid="source-panel"
        role="dialog"
        aria-label="كىتاب ئامبىرىدىن مەنبە ۋە ئايەت"
        inert={!open}
        className={`grain safe-top fixed inset-y-0 end-0 z-50 flex h-dvh w-[92vw] max-w-[420px] flex-col border-s border-bd bg-bg shadow-[var(--shadow-2)] transition-[transform,visibility] duration-200 print:hidden ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-bd px-3">
          <span className="text-[14px] font-bold">مەنبە قىستۇرۇش</span>
          <button
            type="button"
            ref={closeRef}
            className="ibtn"
            data-testid="source-close"
            aria-label="تاقاش"
            onClick={onClose}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-bd p-2" role="tablist">
          <TabButton
            active={tab === "books"}
            testId="source-tab-books"
            onClick={() => setTab("books")}
          >
            <Icon name="book-open" />
            كىتابلار
          </TabButton>
          <TabButton
            active={tab === "quran"}
            testId="source-tab-quran"
            onClick={() => setTab("quran")}
          >
            <Icon name="mosque" />
            قۇرئان
          </TabButton>
        </div>

        <div className="safe-bottom flex-1 overflow-y-auto overscroll-contain p-3">
          {error && (
            <p
              role="alert"
              data-testid="source-error"
              className="mb-3 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3 py-2 text-[12.5px] leading-6"
            >
              {error}
            </p>
          )}

          {tab === "books" ? (
            <>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="source-query" className="text-[13px] font-semibold text-ink2">
                  كىتاب ئامبىرىدىن ئىزدەش
                </label>
                <KeyboardControl inputRef={searchRef as React.RefObject<TextField>} />
              </div>
              <div className="flex gap-2">
                <input
                  autoComplete="off"
                  id="source-query"
                  ref={searchRef}
                  className="field min-w-0 flex-1"
                  type="search"
                  value={query}
                  data-testid="source-query"
                  placeholder="ئىزدەيدىغان سۆز ياكى جۈملە…"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runSearch();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-am"
                  data-testid="source-search"
                  disabled={busy || !query.trim()}
                  onClick={() => void runSearch()}
                >
                  <Icon name="search" />
                </button>
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-ink3">
                يازغان سۆزىڭىز ئەينەن ئىزدىلىدۇ — پەقەت ئېلان قىلىنغان كىتابلاردىن.
              </p>

              {busy && (
                <p className="mt-3 text-[12.5px] text-ink3" data-testid="source-busy">
                  ئىزدىنىۋاتىدۇ…
                </p>
              )}

              {hits !== null && hits.length === 0 && !busy && (
                <p className="mt-4 text-[13px] leading-7 text-ink3" data-testid="source-empty">
                  ھېچنېمە تېپىلمىدى. باشقا سۆز بىلەن سىناپ كۆرۈڭ.
                </p>
              )}

              {tooCommon && (
                <p className="mt-3 rounded-[var(--radius)] bg-ab px-3 py-2 text-[12.5px] leading-6">
                  بۇ سۆز بەك كۆپ ئۇچرايدۇ — يەنە بىر سۆز قوشسىڭىز نەتىجە ئېنىقراق بولىدۇ.
                </p>
              )}

              {hits && hits.length > 0 && (
                <ul className="mt-3 space-y-2.5" data-testid="source-results">
                  {hits.map((hit) => {
                    const key = `${hit.bookId}:${hit.pageNo}`;
                    const passage = passages[key];
                    return (
                      <li
                        key={`${key}-${hit.snippet.slice(0, 12)}`}
                        className="rounded-[var(--radius)] border border-bd bg-bg2 p-3"
                        data-testid="source-result"
                      >
                        <p className="text-[13px] font-bold leading-6">{hit.title}</p>
                        <p className="mt-0.5 text-[12px] text-ink3">
                          {hit.author || "ئاپتورى نامەلۇم"}
                          {hit.pageNo > 0 ? ` · ${hit.pageNo}-بەت` : ""}
                        </p>
                        <p
                          className="mt-1.5 text-[12.5px] leading-6 text-ink2"
                          data-testid="source-snippet"
                        >
                          <Snippet snippet={passage ?? hit.snippet} query={query.trim()} />
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="hbtn"
                            data-testid="source-insert"
                            onClick={() => insertSource(hit)}
                          >
                            <Icon name="plus" />
                            مەنبە قىستۇرۇش
                          </button>
                          <a
                            className="hbtn"
                            data-testid="source-goto"
                            href={readerHref({
                              bookId: hit.bookId,
                              pageNo: hit.pageNo,
                              query: query.trim(),
                            })}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Icon name="book-open" />
                            كىتابقا بېرىش
                          </a>
                          {hit.pageNo > 0 && (
                            <button
                              type="button"
                              className="hbtn"
                              data-testid="source-expand"
                              aria-pressed={Boolean(passage)}
                              onClick={() => void expand(hit)}
                            >
                              <Icon name="layers" />
                              {passage ? "قىسقىلا" : "تولۇق ئابزاس"}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] font-semibold text-ink2">سۈرە ۋە ئايەت نومۇرى</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  autoComplete="off"
                  className="field w-24"
                  type="number"
                  min={1}
                  max={114}
                  inputMode="numeric"
                  value={sura}
                  data-testid="aya-sura"
                  aria-label="سۈرە نومۇرى"
                  placeholder="سۈرە"
                  onChange={(event) => setSura(event.target.value)}
                />
                <span className="text-ink3">:</span>
                <input
                  autoComplete="off"
                  className="field w-24"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={aya}
                  data-testid="aya-number-input"
                  aria-label="ئايەت نومۇرى"
                  placeholder="ئايەت"
                  onChange={(event) => setAya(event.target.value)}
                />
                <button
                  type="button"
                  className="hbtn"
                  data-testid="aya-preview"
                  disabled={busy || !sura || !aya}
                  onClick={() => void loadPreview()}
                >
                  <Icon name="search" />
                  كۆرۈش
                </button>
              </div>

              <fieldset className="mt-3">
                <legend className="text-[13px] font-semibold text-ink2">قىستۇرۇش شەكلى</legend>
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup">
                  {(Object.keys(MODE_LABELS) as AyaRenderMode[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      className={mode === value ? "hbtn on" : "hbtn"}
                      data-testid={`aya-mode-${value}`}
                      onClick={() => setMode(value)}
                    >
                      {MODE_LABELS[value]}
                    </button>
                  ))}
                </div>
              </fieldset>

              {preview && (
                <div
                  className="mt-3 rounded-[var(--radius)] border border-bd bg-bg2 p-3"
                  data-testid="aya-preview-box"
                >
                  <p className="quran-face text-right text-[19px] leading-[2.1]" dir="rtl">
                    <AyaText text={preview.aya.text_ar} query="" />
                  </p>
                  {preview.aya.text_ug && mode !== "ar" && (
                    <p className="mt-2 text-[13px] leading-7 text-ink2">{preview.aya.text_ug}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="hbtn"
                      data-testid="aya-insert"
                      onClick={() =>
                        void insertAya({ sura: preview.aya.sura, aya: preview.aya.aya })
                      }
                    >
                      <Icon name="plus" />
                      ئايەت قىستۇرۇش
                    </button>
                    <a
                      className="hbtn"
                      data-testid="aya-goto"
                      href={ayaHref(preview.aya.sura, preview.aya.aya)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="book-open" />
                      ئايەتكە بېرىش
                    </a>
                  </div>
                </div>
              )}

              <div className="mt-5 border-t border-bd pt-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label htmlFor="quran-query" className="text-[13px] font-semibold text-ink2">
                    قۇرئان تېكىستىدىن ئىزدەش
                  </label>
                  <KeyboardControl inputRef={quranSearchRef as React.RefObject<TextField>} />
                </div>
                <div className="flex gap-2">
                  <input
                    autoComplete="off"
                    id="quran-query"
                    ref={quranSearchRef}
                    className="field min-w-0 flex-1"
                    type="search"
                    value={quranQuery}
                    data-testid="quran-source-query"
                    placeholder="ئەرەبچە ياكى ئۇيغۇرچە…"
                    onChange={(event) => setQuranQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void runQuranSearch();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-am"
                    data-testid="quran-source-search"
                    disabled={busy || !quranQuery.trim()}
                    onClick={() => void runQuranSearch()}
                  >
                    <Icon name="search" />
                  </button>
                </div>

                {quranHits !== null && quranHits.length === 0 && !busy && (
                  <p className="mt-3 text-[13px] leading-7 text-ink3">ھېچ ئايەت تېپىلمىدى.</p>
                )}

                {quranHits && quranHits.length > 0 && (
                  <ul className="mt-3 space-y-2.5" data-testid="quran-source-results">
                    {quranHits.map((hit) => (
                      <li
                        key={`${hit.sura}:${hit.aya}`}
                        className="rounded-[var(--radius)] border border-bd bg-bg2 p-3"
                      >
                        <p className="text-[12px] text-ink3">
                          {hit.sura_name_ug} · {hit.sura}:{hit.aya}
                        </p>
                        <p className="quran-face mt-1 text-right text-[17px] leading-[2]" dir="rtl">
                          <AyaText text={hit.text_ar} query={quranQuery.trim()} />
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="hbtn"
                            data-testid="quran-source-insert"
                            onClick={() =>
                              void insertAya({ sura: hit.sura, aya: hit.aya }, hit.sura_name_ug)
                            }
                          >
                            <Icon name="plus" />
                            قىستۇرۇش
                          </button>
                          <a
                            className="hbtn"
                            href={ayaHref(hit.sura, hit.aya)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Icon name="book-open" />
                            ئايەتكە بېرىش
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function TabButton({
  active,
  testId,
  onClick,
  children,
}: {
  active: boolean;
  testId: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      className={active ? "hbtn on flex-1 justify-center" : "hbtn flex-1 justify-center"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
