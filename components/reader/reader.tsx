"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReaderPanel } from "@/components/reader/reader-panel";
import { MarkdownContent } from "@/components/reader/markdown-content";
import { toSegments } from "@/lib/reader/highlight";
import type { ContentFormat } from "@/lib/books/types";
import {
  addBookmark,
  addNote,
  deleteAnnotation,
  fetchAnnotations,
  fetchPages,
  saveProgress,
  fetchBookMatchPages,
  touchRecentRead,
  type Annotation,
  type BookPage,
  type MatchPage,
} from "@/lib/reader/pages";
import {
  initialPageWindow,
  parseStoredPosition,
  positionStorageKey,
  shouldRestore,
  type ReadingPosition,
} from "@/lib/reader/position";
import { FONT_STACKS, MAX_FONT_SIZE, MIN_FONT_SIZE, type ReaderSettings } from "@/lib/reader/settings";
import {
  getSettingsServerSnapshot,
  getSettingsSnapshot,
  subscribeSettings,
  updateSettingsStore,
} from "@/lib/reader/settings-store";
import type { Theme } from "@/lib/theme";

const WINDOW_SIZE = 8;
const FETCH_AHEAD_PX = 1200;

export function Reader({
  bookId,
  title,
  pageCount,
  contentFormat,
  initialPages,
  initialPosition,
  signedIn,
  theme,
  jumpToPage,
  highlight,
  jumpToMatch,
  cameFromSearch,
}: {
  bookId: number;
  title: string;
  pageCount: number;
  contentFormat: ContentFormat;
  initialPages: BookPage[];
  initialPosition: ReadingPosition;
  signedIn: boolean;
  theme: Theme | null;
  jumpToPage: number | null;
  highlight: string;
  jumpToMatch: number | null;
  cameFromSearch: boolean;
}) {
  const router = useRouter();
  const [pages, setPages] = useState<BookPage[]>(initialPages);
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsServerSnapshot,
  );
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [restoredPage, setRestoredPage] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<Annotation[]>([]);
  const [notes, setNotes] = useState<Annotation[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState(highlight);
  const [matchPages, setMatchPages] = useState<MatchPage[]>([]);
  const [matchesCapped, setMatchesCapped] = useState(false);
  const [findRan, setFindRan] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  const [activeTerm, setActiveTerm] = useState(highlight);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreDone = useRef(false);

  const firstPage = pages[0]?.page_no ?? 1;
  const lastPage = pages[pages.length - 1]?.page_no ?? 1;

  useEffect(() => {
    if (signedIn) void touchRecentRead(bookId).catch(() => undefined);
  }, [bookId, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    void fetchAnnotations(bookId)
      .then(({ bookmarks: b, notes: n }) => {
        setBookmarks(b);
        setNotes(n);
      })
      .catch(() => undefined);
  }, [bookId, signedIn]);

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    updateSettingsStore(patch);
  }, []);

  /** Which page is currently under the top of the viewport. */
  const currentPosition = useCallback((): ReadingPosition => {
    const container = containerRef.current;
    if (!container) return { pageNo: firstPage, offset: 0 };
    const nodes = container.querySelectorAll<HTMLElement>("[data-page-no]");
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom > 120) {
        const pageNo = Number(node.dataset.pageNo) || firstPage;
        const offset = rect.height > 0 ? Math.min(Math.max(-rect.top / rect.height, 0), 1) : 0;
        return { pageNo, offset };
      }
    }
    return { pageNo: lastPage, offset: 1 };
  }, [firstPage, lastPage]);

  /** Debounced so scrolling does not hammer the database. */
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const position = currentPosition();
      if (signedIn) {
        void saveProgress(bookId, position).catch(() => undefined);
      } else {
        try {
          window.localStorage.setItem(positionStorageKey(bookId), JSON.stringify(position));
        } catch {
          // Storage unavailable — position simply is not remembered.
        }
      }
    }, 800);
  }, [bookId, currentPosition, signedIn]);

  const loadAround = useCallback(
    async (direction: "before" | "after") => {
      if (loading) return;
      const from = direction === "after" ? lastPage + 1 : Math.max(1, firstPage - WINDOW_SIZE);
      const to = direction === "after" ? Math.min(pageCount, lastPage + WINDOW_SIZE) : firstPage - 1;
      if (from > to || (direction === "after" && lastPage >= pageCount) || (direction === "before" && firstPage <= 1)) {
        return;
      }
      setLoading(true);
      try {
        const more = await fetchPages(bookId, from, to);
        if (more.length === 0) return;
        if (direction === "after") {
          setPages((previous) => [...previous, ...more]);
        } else {
          // Keep the viewport anchored while inserting above.
          const container = containerRef.current;
          const previousHeight = container?.scrollHeight ?? 0;
          setPages((previous) => [...more, ...previous]);
          requestAnimationFrame(() => {
            const grown = (container?.scrollHeight ?? 0) - previousHeight;
            if (grown > 0) window.scrollBy(0, grown);
          });
        }
      } catch {
        setError("بەتلەرنى يۈكلىگىلى بولمىدى. ئۇلىنىشىڭىزنى تەكشۈرۈڭ.");
      } finally {
        setLoading(false);
      }
    },
    [bookId, firstPage, lastPage, loading, pageCount],
  );

  /** Pull in more pages whenever either edge of the loaded window is close. */
  const maybeFetchMore = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.bottom - window.innerHeight < FETCH_AHEAD_PX) void loadAround("after");
    if (rect.top > -FETCH_AHEAD_PX && firstPage > 1) void loadAround("before");
  }, [firstPage, loadAround]);

  useEffect(() => {
    const onScroll = () => {
      scheduleSave();
      maybeFetchMore();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [maybeFetchMore, scheduleSave]);

  /**
   * Also check after mount and after each window change. Scroll alone is not
   * enough: the reader may already sit near the end (short book, tall screen),
   * or may have scrolled while hydration was still pending — in both cases no
   * further scroll event would ever arrive to trigger the fetch.
   * Self-limiting: appended pages push the container edge out of range.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => maybeFetchMore());
    return () => cancelAnimationFrame(frame);
  }, [maybeFetchMore, pages.length]);

  /**
   * Jump to the saved position (or an explicit ?page=) once pages are in the
   * DOM. Signed-in progress arrives from the server; anonymous readers keep
   * theirs in localStorage, which only exists after mount.
   */
  useEffect(() => {
    if (restoreDone.current) return;
    restoreDone.current = true;

    let saved = initialPosition;
    if (!signedIn && jumpToPage === null) {
      saved = parseStoredPosition(
        window.localStorage.getItem(positionStorageKey(bookId)),
        pageCount,
      );
    }

    const target = jumpToPage ?? (shouldRestore(saved) ? saved.pageNo : null);
    if (target === null) return;

    const scrollToTarget = () => {
      const node = containerRef.current?.querySelector<HTMLElement>(`[data-page-no="${target}"]`);
      if (node) {
        window.scrollTo({ top: node.offsetTop - 80, behavior: "auto" });
        if (jumpToPage === null) setRestoredPage(target);
        return true;
      }
      return false;
    };

    requestAnimationFrame(() => {
      // An anonymous target can sit outside the server-rendered window.
      if (scrollToTarget()) return;
      const window_ = initialPageWindow({ pageNo: target, offset: 0 }, pageCount, WINDOW_SIZE);
      void fetchPages(bookId, window_.from, window_.to)
        .then((fresh) => {
          if (fresh.length === 0) return;
          setPages(fresh);
          requestAnimationFrame(() => scrollToTarget());
        })
        .catch(() => undefined);
    });
  }, [bookId, initialPosition, jumpToPage, pageCount, signedIn]);

  /**
   * Arriving from the search page, the term is highlighted but nothing knows
   * where the other occurrences are — so the ↑ ↓ controls had nothing to step
   * through and stayed hidden. Collect them up front, without moving the
   * reader: the ?page= jump above already put it in the right place.
   */
  const matchesLoaded = useRef(false);
  useEffect(() => {
    if (matchesLoaded.current || !highlight.trim()) return;
    matchesLoaded.current = true;
    void fetchBookMatchPages(bookId, highlight)
      .then(({ pages: found, capped }) => {
        setMatchPages(found);
        setMatchesCapped(capped);
        setFindRan(true);
        // Arriving on a specific occurrence (?m= from a search result): select
        // it so the counter reads true and the stepping continues from there.
        if (jumpToMatch === null || jumpToPage === null) return;
        let position = 0;
        for (const page of found) {
          if (page.page_no === jumpToPage) {
            setFindIndex(position + Math.min(jumpToMatch, Math.max(0, page.hits - 1)));
            return;
          }
          position += page.hits;
        }
      })
      .catch(() => undefined);
  }, [bookId, highlight, jumpToMatch, jumpToPage]);

  const goToPage = useCallback(
    async (pageNo: number) => {
      const target = Math.min(Math.max(1, Math.floor(pageNo)), Math.max(1, pageCount));
      let node = containerRef.current?.querySelector<HTMLElement>(`[data-page-no="${target}"]`);
      if (!node) {
        // Outside the loaded window — reload a window around the target.
        setLoading(true);
        try {
          const window_ = initialPageWindow({ pageNo: target, offset: 0 }, pageCount, WINDOW_SIZE);
          const fresh = await fetchPages(bookId, window_.from, window_.to);
          setPages(fresh);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          node = containerRef.current?.querySelector<HTMLElement>(`[data-page-no="${target}"]`) ?? undefined;
        } catch {
          setError("بۇ بەتنى ئاچقىلى بولمىدى.");
        } finally {
          setLoading(false);
        }
      }
      if (node) window.scrollTo({ top: node.offsetTop - 80, behavior: "smooth" });
    },
    [bookId, pageCount],
  );

  /**
   * Every occurrence of the term, flattened across the pages that contain it —
   * a page can hold the word many times, and stepping page-by-page would skip
   * all but the first. Positions come from findMatches, so a term still lines
   * up with text carrying Arabic diacritics.
   */
  /**
   * Every occurrence in the WHOLE book, flattened — not only the loaded pages.
   * book_match_pages returns how many times the phrase occurs on each page, so
   * the counter can say "12/47" without the reader having downloaded page 47.
   */
  const occurrences = useMemo(
    () =>
      matchPages.flatMap((page) =>
        Array.from({ length: page.hits }, (_, index) => ({ pageNo: page.page_no, index })),
      ),
    [matchPages],
  );


  /** Bring one occurrence into view, loading its page first when needed. */
  const goToOccurrence = useCallback(
    async (position: number) => {
      const target = occurrences[position];
      if (!target) return;
      setFindIndex(position);

      const selector = `[data-page-no="${target.pageNo}"] [data-match="${target.index}"]`;
      let node = containerRef.current?.querySelector<HTMLElement>(selector);
      if (!node) {
        await goToPage(target.pageNo);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        node = containerRef.current?.querySelector<HTMLElement>(selector) ?? undefined;
      }
      // Instant, not smooth: stepping matches is a find-next, and the browser's
      // own find jumps rather than animates — over hundreds of pages a smooth
      // scroll would be a long slide past text nobody asked to read.
      // A Markdown book renders without marks; the page itself is the target.
      if (!node) {
        await goToPage(target.pageNo);
        return;
      }
      // block:"center" puts it in the middle of the screen, which is also what
      // keeps it clear of the sticky toolbar on a 375px phone.
      node.scrollIntoView({ behavior: "auto", block: "center" });
      // Pulse once, like the desktop's flashMatch — landing on a wall of text
      // with no cue means hunting for the word all over again.
      node.classList.remove("match-flash");
      void node.offsetWidth;
      node.classList.add("match-flash");
    },
    [goToPage, occurrences],
  );

  /**
   * Landing from a search result: once the match list is in, put the exact
   * occurrence in the middle of the screen and flash it. The ?page= restore
   * above only gets the page; this gets the word.
   */
  const arrivalScrolled = useRef(false);
  useEffect(() => {
    if (arrivalScrolled.current || jumpToMatch === null || occurrences.length === 0) return;
    arrivalScrolled.current = true;
    const frame = requestAnimationFrame(() => void goToOccurrence(findIndex));
    return () => cancelAnimationFrame(frame);
    // goToOccurrence is intentionally read once, at the moment the list lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMatch, occurrences.length]);

  async function runFind(term: string) {
    setFindTerm(term);
    setActiveTerm(term);
    setFindIndex(0);
    setFindRan(true);
    if (!term.trim()) {
      setMatchPages([]);
      setMatchesCapped(false);
      return;
    }
    try {
      const { pages: found, capped } = await fetchBookMatchPages(bookId, term);
      setMatchPages(found);
      setMatchesCapped(capped);
      if (found[0]) await goToPage(found[0].page_no);
    } catch {
      setError("كىتاب ئىچىدىن ئىزدىگىلى بولمىدى.");
    }
  }

  async function stepFind(delta: 1 | -1) {
    if (occurrences.length === 0) return;
    await goToOccurrence((findIndex + delta + occurrences.length) % occurrences.length);
  }

  async function createBookmark() {
    const position = currentPosition();
    const name = window.prompt("خەتكۈچ ئىسمى:", `${position.pageNo}-بەت`);
    if (name === null) return;
    try {
      const created = await addBookmark(bookId, position.pageNo, name.trim() || `${position.pageNo}-بەت`);
      if (created) setBookmarks((previous) => [...previous, created].sort((a, b) => a.page_no - b.page_no));
    } catch {
      setError("خەتكۈچ قوشۇلمىدى.");
    }
  }

  async function createNote() {
    const selected = window.getSelection()?.toString().trim() ?? "";
    const position = currentPosition();
    const text = window.prompt("خاتىرە:", selected);
    if (text === null || !text.trim()) return;
    try {
      const created = await addNote(bookId, position.pageNo, text.trim());
      if (created) setNotes((previous) => [...previous, created].sort((a, b) => a.page_no - b.page_no));
    } catch {
      setError("خاتىرە قوشۇلمىدى.");
    }
  }

  async function removeAnnotation(kind: "bookmark" | "note", id: number) {
    try {
      await deleteAnnotation(kind, id);
      if (kind === "bookmark") setBookmarks((previous) => previous.filter((item) => item.id !== id));
      else setNotes((previous) => previous.filter((item) => item.id !== id));
    } catch {
      setError("ئۆچۈرگىلى بولمىدى.");
    }
  }

  return (
    <div className="min-h-dvh">
      {/* Sticky, never auto-hiding: every control stays reachable after any
          amount of scrolling (CLAUDE.md Mobile Rules). */}
      <header
        data-testid="reader-toolbar"
        className="grain safe-top safe-x sticky top-0 z-30 border-b border-bd bg-bg2/95 backdrop-blur print:hidden"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1 px-2 py-2 sm:px-4">
          {/* Someone who came from a search wants the results back, not this
              book's cover page — they are working through the list. Going back
              through history restores the scroll position and the already
              fetched results for free, and behaves the same as the phone's own
              back button, so there is one behaviour rather than two. */}
          {cameFromSearch ? (
            <button
              type="button"
              className="ibtn"
              aria-label="ئىزدەش نەتىجىسىگە قايتىش"
              data-testid="reader-back"
              onClick={() => router.back()}
            >
              <Icon name="undo" className="ic-lg" />
            </button>
          ) : (
            <Link href={`/books/${bookId}`} className="ibtn" aria-label="كىتاب بېتىگە قايتىش" data-testid="reader-back">
              <Icon name="undo" className="ic-lg" />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-[14px] font-bold">{title}</h1>

          <button
            type="button"
            className="ibtn"
            data-testid="font-decrease"
            aria-label="خەت چوڭلۇقىنى كىچىكلىتىش"
            disabled={settings.fontSize <= MIN_FONT_SIZE}
            onClick={() => updateSettings({ fontSize: settings.fontSize - 2 })}
          >
            <span className="text-[15px] font-bold">A−</span>
          </button>
          <button
            type="button"
            className="ibtn"
            data-testid="font-increase"
            aria-label="خەت چوڭلۇقىنى چوڭايتىش"
            disabled={settings.fontSize >= MAX_FONT_SIZE}
            onClick={() => updateSettings({ fontSize: settings.fontSize + 2 })}
          >
            <span className="text-[15px] font-bold">A+</span>
          </button>
          <ThemeToggle initial={theme} />

          {/* Step through the term's occurrences without opening anything —
              this is the control that was missing when a reader arrived here
              from the search page. */}
          {occurrences.length > 0 && (
            <span className="flex shrink-0 items-center" data-testid="match-nav">
              <button
                type="button"
                className="ibtn"
                data-testid="match-prev"
                aria-label="ئالدىنقى تېپىلغان سۆز"
                onClick={() => void stepFind(-1)}
              >
                <Icon name="chevron-up" className="ic-lg" />
              </button>
              <button
                type="button"
                className="ibtn"
                data-testid="match-next"
                aria-label="كېيىنكى تېپىلغان سۆز"
                onClick={() => void stepFind(1)}
              >
                <Icon name="chevron-down" className="ic-lg" />
              </button>
              <span
                className="whitespace-nowrap px-1 text-[12.5px] tabular-nums text-ink2"
                data-testid="match-count"
                dir="ltr"
              >
                {findIndex + 1}/{occurrences.length}
                {matchesCapped ? "+" : ""}
              </span>
            </span>
          )}

          {/* Searched, and this book does not carry it — say so rather than
              leaving the toolbar looking the same as before the search. */}
          {findRan && activeTerm.trim() !== "" && occurrences.length === 0 && (
            <span className="whitespace-nowrap px-1 text-[12.5px] text-ink3" data-testid="match-none">
              تېپىلمىدى
            </span>
          )}

          <button
            type="button"
            className="ibtn"
            data-testid="find-toggle"
            aria-label="كىتاب ئىچىدىن ئىزدەش"
            aria-expanded={findOpen}
            onClick={() => setFindOpen((open) => !open)}
          >
            <Icon name="search" className="ic-lg" />
          </button>
          {signedIn && (
            <button
              type="button"
              className="ibtn"
              data-testid="add-bookmark"
              aria-label="خەتكۈچ قوشۇش"
              onClick={createBookmark}
            >
              <Icon name="bookmark" className="ic-lg" />
            </button>
          )}
          <button
            type="button"
            className="ibtn"
            data-testid="panel-toggle"
            aria-label="خەتكۈچ ۋە خاتىرىلەر"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen(true)}
          >
            <Icon name="notebook-pen" className="ic-lg" />
          </button>
        </div>

        {findOpen && (
          <div className="border-t border-bd px-2 pb-2 pt-2 sm:px-4">
            {/* Just the query. Stepping and counting belong to the one
                navigator in the toolbar above — a second set of controls here
                would drift out of step with it. */}
            <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2">
              <input
                className="field min-w-40 flex-1"
                data-testid="find-input"
                value={findTerm}
                placeholder="بۇ كىتابتىن ئىزدەش…"
                onChange={(event) => setFindTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runFind(findTerm);
                }}
              />
              <button type="button" className="hbtn" data-testid="find-run" onClick={() => void runFind(findTerm)}>
                ئىزدەش
              </button>
              {findRan && occurrences.length === 0 && (
                <span className="text-[12.5px] text-ink3" data-testid="find-count">
                  تېپىلمىدى
                </span>
              )}
            </div>
          </div>
        )}
      </header>

      {restoredPage !== null && (
        <p
          role="status"
          data-testid="restored-note"
          className="mx-auto mt-3 w-fit rounded-full bg-ab px-4 py-1.5 text-[12.5px] print:hidden"
        >
          قايتىپ كەلدىڭىز — {restoredPage}-بەتتىن داۋاملاشتى
        </p>
      )}

      {error && (
        <p role="alert" className="mx-auto mt-3 w-fit rounded-[var(--radius)] border border-bd2 bg-ab2 px-4 py-2 text-[12.5px] print:hidden">
          {error}
        </p>
      )}

      <div
        ref={containerRef}
        data-testid="reader-content"
        className="mx-auto w-full max-w-3xl px-4 py-6 print:max-w-none print:px-0"
        style={{
          fontFamily: FONT_STACKS[settings.font],
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineHeight,
        }}
      >
        {firstPage > 1 && (
          <button type="button" className="hbtn mx-auto mb-4 flex print:hidden" onClick={() => void loadAround("before")}>
            ئالدىنقى بەتلەرنى يۈكلەش
          </button>
        )}

        {pages.map((page) => (
          <article
            key={page.page_no}
            data-page-no={page.page_no}
            data-testid="reader-page"
            className="reader-page mb-8 break-after-page"
          >
            <p className="mb-2 text-center text-[12px] text-ink3 print:text-[10px]">{page.page_no}</p>
            {contentFormat === "markdown" ? (
              <MarkdownContent source={page.content} />
            ) : (
              <div className="whitespace-pre-wrap break-words">
                {activeTerm.trim()
                  ? (() => {
                      // Number the marks within the page so ↑ ↓ can address one
                      // occurrence, and flag the one currently stepped to.
                      let matchNo = -1;
                      const active = occurrences[findIndex];
                      return toSegments(page.content, activeTerm).map((segment, index) => {
                        if (!segment.match) return <span key={index}>{segment.text}</span>;
                        matchNo += 1;
                        const isActive =
                          active?.pageNo === page.page_no && active.index === matchNo;
                        return (
                          <mark
                            key={index}
                            data-match={matchNo}
                            className={
                              isActive
                                ? "match-active px-0.5"
                                : "rounded bg-ab2 px-0.5 text-ink"
                            }
                          >
                            {segment.text}
                          </mark>
                        );
                      });
                    })()
                  : page.content}
              </div>
            )}
          </article>
        ))}

        {loading && (
          <p className="py-4 text-center text-[13px] text-ink3 print:hidden">يۈكلىنىۋاتىدۇ…</p>
        )}
        {lastPage >= pageCount && pages.length > 0 && (
          <p className="py-6 text-center text-[13px] text-ink3 print:hidden">— كىتاب ئاخىرلاشتى —</p>
        )}
      </div>

      {/* Bottom bar: page jump and quick navigation. Content above reserves
          space with pb-24 so this never covers the last line. */}
      <div className="safe-bottom safe-x sticky bottom-0 z-20 border-t border-bd bg-bg2/95 backdrop-blur print:hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-center gap-2 px-3 py-2">
          <button type="button" className="ibtn" aria-label="بېشىغا" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <Icon name="align-right" />
          </button>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(new FormData(event.currentTarget).get("page"));
              if (Number.isFinite(value)) void goToPage(value);
            }}
          >
            <label className="text-[12.5px] text-ink3" htmlFor="page-jump">
              بەت
            </label>
            <input
              id="page-jump"
              name="page"
              type="number"
              min={1}
              max={Math.max(1, pageCount)}
              dir="ltr"
              className="field w-20 text-center"
              data-testid="page-jump"
            />
            <button type="submit" className="hbtn" data-testid="page-jump-go">
              بېرىش
            </button>
          </form>
          <span className="text-[12.5px] text-ink3" data-testid="page-indicator">
            / {pageCount}
          </span>
          <button
            type="button"
            className="ibtn"
            aria-label="بېسىپ چىقىرىش"
            data-testid="print-button"
            onClick={() => window.print()}
          >
            <Icon name="download" />
          </button>
        </div>
      </div>

      <ReaderPanel
        open={panelOpen}
        signedIn={signedIn}
        bookmarks={bookmarks}
        notes={notes}
        settings={settings}
        onSettingsChange={updateSettings}
        onClose={() => setPanelOpen(false)}
        onJump={(pageNo) => {
          setPanelOpen(false);
          void goToPage(pageNo);
        }}
        onDelete={removeAnnotation}
        onAddNote={createNote}
      />
    </div>
  );
}

