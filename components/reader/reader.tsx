"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReaderPanel } from "@/components/reader/reader-panel";
import { toSegments } from "@/lib/reader/highlight";
import {
  addBookmark,
  addNote,
  deleteAnnotation,
  fetchAnnotations,
  fetchPages,
  saveProgress,
  searchInBook,
  touchRecentRead,
  type Annotation,
  type BookPage,
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
  initialPages,
  initialPosition,
  signedIn,
  theme,
  jumpToPage,
  highlight,
}: {
  bookId: number;
  title: string;
  pageCount: number;
  initialPages: BookPage[];
  initialPosition: ReadingPosition;
  signedIn: boolean;
  theme: Theme | null;
  jumpToPage: number | null;
  highlight: string;
}) {
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
  const [findHits, setFindHits] = useState<BookPage[]>([]);
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

  async function runFind(term: string) {
    setFindTerm(term);
    setActiveTerm(term);
    if (!term.trim()) {
      setFindHits([]);
      return;
    }
    try {
      const hits = await searchInBook(bookId, term);
      setFindHits(hits);
      setFindIndex(0);
      if (hits[0]) await goToPage(hits[0].page_no);
    } catch {
      setError("كىتاب ئىچىدىن ئىزدىگىلى بولمىدى.");
    }
  }

  async function stepFind(delta: 1 | -1) {
    if (findHits.length === 0) return;
    const next = (findIndex + delta + findHits.length) % findHits.length;
    setFindIndex(next);
    await goToPage(findHits[next].page_no);
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
          <Link href={`/books/${bookId}`} className="ibtn" aria-label="كىتاب بېتىگە قايتىش" data-testid="reader-back">
            <Icon name="undo" className="ic-lg" />
          </Link>
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
              <button type="button" className="ibtn" aria-label="ئالدىنقى" onClick={() => void stepFind(-1)} disabled={findHits.length === 0}>
                <Icon name="undo" />
              </button>
              <button type="button" className="ibtn" aria-label="كېيىنكى" onClick={() => void stepFind(1)} disabled={findHits.length === 0}>
                <Icon name="redo" />
              </button>
              <span className="text-[12.5px] text-ink3" data-testid="find-count">
                {findHits.length > 0 ? `${findIndex + 1} / ${findHits.length} بەت` : "نەتىجە يوق"}
              </span>
            </div>
            {findHits.length > 0 && (
              <ul className="mx-auto mt-2 flex w-full max-w-4xl flex-wrap gap-1.5">
                {findHits.slice(0, 20).map((hit, index) => (
                  <li key={hit.page_no}>
                    <button
                      type="button"
                      className={index === findIndex ? "hbtn on" : "hbtn"}
                      onClick={() => {
                        setFindIndex(index);
                        void goToPage(hit.page_no);
                      }}
                    >
                      {hit.page_no}
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
            <p className="mb-2 text-center text-[11.5px] text-ink3 print:text-[10px]">{page.page_no}</p>
            <div className="whitespace-pre-wrap break-words">
              {activeTerm.trim()
                ? toSegments(page.content, activeTerm).map((segment, index) =>
                    segment.match ? (
                      <mark key={index} className="rounded bg-ab2 px-0.5 text-ink">
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )
                : page.content}
            </div>
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

