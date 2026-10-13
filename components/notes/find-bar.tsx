"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { canHighlight, rangeFor } from "@/lib/spellcheck/marks";
import {
  FIND_CURRENT_HIGHLIGHT,
  FIND_HIGHLIGHT,
  findInEditor,
  replaceHits,
  type FindHit,
} from "@/lib/notes/find";

/** A replace-all that «ھەممىنى يېنىۋېلىش» can still take back. */
type Undoable = { count: number; snapshot: string };

/**
 * Find and replace, as a bar in the notebook's sticky header.
 *
 * WHERE IT SITS IS THE DESIGN. A floating find box on a phone lands on top of
 * the very text it is searching, and the writer ends up dragging it around
 * instead of reading. This is a row in the header the toolbar already occupies,
 * so it is in the layout rather than over it, and the editor simply starts
 * further down while it is open. Stepping to a match scrolls that match into
 * the middle of the screen, so a hit can never be left hiding under the header.
 *
 * A REPLACEMENT TOUCHES ONLY ITS HIT. Each one is an `insertText` on that hit's
 * own Range (lib/notes/find.ts), so the note's headings, quotes and lists stay
 * exactly as they were. Replace-one is one native undo step. Replace-all is one
 * step per hit, run inside the editor's batch so autosave, the counts and the
 * spellchecker hear about it once — and «ھەممىنى يېنىۋېلىش» takes all of them
 * back in one tap: that many native undos, then a check against the note as it
 * was before, written back whole if the browser's undo stack fell short.
 */
export function FindBar({
  open,
  editorRef,
  revision,
  initialQuery,
  onClose,
  batch,
  onRestore,
  onReplacedAll,
}: {
  open: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
  /** Bumped by the editor whenever its content changed, so hits are re-found. */
  revision: number;
  initialQuery: string;
  onClose: () => void;
  /** Run editing commands as one change: the editor's input handling waits for the end. */
  batch: (work: () => void) => void;
  /** Put a whole earlier version of the note back on screen. */
  onRestore: (html: string) => void;
  /** A replace-all changed the note: here is the note as it was, to keep on this device. */
  onReplacedAll: (snapshot: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [hits, setHits] = useState<FindHit[]>([]);
  const [index, setIndex] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The current hit, readable from callbacks that were created before it
   * changed. Written beside every setIndex, never during render.
   */
  const indexRef = useRef(-1);

  /**
   * Pre-fill from the note's selection, exactly as the desktop does. Adjusted
   * during render because it is state derived from a prop changing, not a side
   * effect on an external system. Closing the bar drops what it last said.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && initialQuery.trim()) setQuery(initialQuery.trim());
    if (!open) {
      setNotice(null);
      setUndoable(null);
    }
  }

  /** Take the paint off. Called on close, on unmount and before every repaint. */
  const clearPaint = useCallback(() => {
    if (!canHighlight()) return;
    CSS.highlights.delete(FIND_HIGHLIGHT);
    CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT);
  }, []);

  /**
   * Re-find and repaint. `keepIndex` holds the writer's place while they are
   * stepping; a new query starts again at the first hit.
   */
  const run = useCallback(
    (keepIndex: boolean) => {
      const editor = editorRef.current;
      if (!editor) return;
      clearPaint();

      const { map, hits: found } = findInEditor(editor, query);
      setHits(found);

      const next =
        found.length === 0
          ? -1
          : keepIndex
            ? Math.min(Math.max(indexRef.current, 0), found.length - 1)
            : 0;
      setIndex(next);
      indexRef.current = next;

      if (found.length === 0 || !canHighlight()) return;
      const others: Range[] = [];
      let current: Range | null = null;
      for (const [ordinal, hit] of found.entries()) {
        const range = rangeFor(map, hit.start, hit.end);
        if (!range) continue;
        if (ordinal === next) current = range;
        else others.push(range);
      }
      if (others.length > 0) CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...others));
      if (current) CSS.highlights.set(FIND_CURRENT_HIGHLIGHT, new Highlight(current));
    },
    [clearPaint, editorRef, query],
  );

  /** Bring hit `ordinal` into the middle of the screen, clear of the header. */
  const scrollTo = useCallback(
    (ordinal: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      const { map, hits: found } = findInEditor(editor, query);
      const hit = found[ordinal];
      if (!hit) return;
      const range = rangeFor(map, hit.start, hit.end);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) return;
      const target = window.innerHeight * 0.4;
      window.scrollBy({ top: rect.top - target, behavior: "smooth" });
    },
    [editorRef, query],
  );

  useEffect(() => {
    if (!open) {
      clearPaint();
      return;
    }
    inputRef.current?.focus();
  }, [open, clearPaint]);

  // Re-find whenever the query changes or the document was edited under us.
  useEffect(() => {
    if (!open) return;
    run(true);
  }, [open, query, revision, run]);

  useEffect(() => clearPaint, [clearPaint]);

  /**
   * «ھەممىنى يېنىۋېلىش» is about the replace-all that just happened, so it goes
   * with the next change of any kind: typing in the note or the title, a
   * toolbar command, a panel writing into the note. Any of those would sit on
   * the undo stack above the replacements, and undoing "that many" steps would
   * then take back the wrong ones.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (!undoable || !editor) return;
    const drop = () => setUndoable(null);
    const watcher = new MutationObserver(drop);
    watcher.observe(editor, { childList: true, characterData: true, subtree: true });
    document.addEventListener("input", drop, true);
    return () => {
      watcher.disconnect();
      document.removeEventListener("input", drop, true);
    };
  }, [editorRef, undoable]);

  const step = useCallback(
    (delta: number) => {
      if (hits.length === 0) return;
      const next = (index + delta + hits.length) % hits.length;
      setIndex(next);
      indexRef.current = next;
      run(true);
      scrollTo(next);
    },
    [hits.length, index, run, scrollTo],
  );

  /**
   * Run `work` against the note as one batch, with the page held where it
   * is: an editing command scrolls its caret into view, and replacing from
   * the last hit to the first would otherwise drag the page to the end of
   * the note and back.
   */
  function editInPlace(editor: HTMLDivElement, work: (selection: Selection) => void) {
    const selection = window.getSelection();
    if (!selection) return;
    const { scrollX, scrollY } = window;
    batch(() => {
      editor.focus({ preventScroll: true });
      work(selection);
    });
    window.scrollTo(scrollX, scrollY);
  }

  /** One hit's text, replaced as one native editing command. */
  function writeOver(selection: Selection, range: Range) {
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, replacement);
  }

  function replaceOne() {
    const editor = editorRef.current;
    if (!editor || hits.length === 0) return;
    const ordinal = Math.max(index, 0);
    let written = 0;
    editInPlace(editor, (selection) => {
      written = replaceHits(editor, query, ordinal, (range) => writeOver(selection, range));
    });
    if (written === 0) return;
    setUndoable(null);
    setNotice("1 ئورۇن ئالماشتۇرۇلدى. «يېنىۋېلىش» كۇنۇپكىسى ئۇنى ئەسلىگە قايتۇرىدۇ.");
    // The hit after it now has this number, so the next tap carries on there.
    indexRef.current = ordinal;
  }

  function replaceAll() {
    const editor = editorRef.current;
    if (!editor || hits.length === 0) return;
    const snapshot = editor.innerHTML;
    const current = Math.max(index, 0);
    let written = 0;
    // The paint holds live Ranges over every hit; there is no point keeping
    // three hundred of them up to date while they are being replaced.
    clearPaint();
    editInPlace(editor, (selection) => {
      let caret: Range | null = null;
      written = replaceHits(editor, query, "all", (range, ordinal) => {
        writeOver(selection, range);
        if (ordinal === current && selection.rangeCount > 0) caret = selection.getRangeAt(0).cloneRange();
      });
      // The caret ends where the writer was looking, not at the first hit.
      if (caret) {
        selection.removeAllRanges();
        selection.addRange(caret);
      }
    });
    if (written === 0) return;
    // «ھەممىنى يېنىۋېلىش» lasts until the next change; the version kept on
    // this device (PROMPT-46) lasts beyond it.
    onReplacedAll(snapshot);
    setUndoable({ count: written, snapshot });
    setNotice(`${written} ئورۇن ئالماشتۇرۇلدى.`);
    indexRef.current = 0;
  }

  /** «ھەممىنى يېنىۋېلىش» — every replacement of that replace-all, at once. */
  function undoAll() {
    const editor = editorRef.current;
    if (!editor || !undoable) return;
    editInPlace(editor, () => {
      for (let taken = 0; taken < undoable.count; taken += 1) document.execCommand("undo");
    });
    // Browsers cap their undo stacks and engines differ in what one step is;
    // the note as it was is the only thing that counts.
    if (editor.innerHTML !== undoable.snapshot) onRestore(undoable.snapshot);
    setUndoable(null);
    setNotice("ئەسلىگە قايتۇرۇلدى.");
  }

  if (!open) return null;

  return (
    <div
      className="border-t border-bd px-2 pb-2 pt-2 sm:px-4"
      data-testid="find-bar"
      role="search"
      aria-label="خاتىرىدىن تېپىش ۋە ئالماشتۇرۇش"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1.5">
        <input
          autoComplete="off"
          ref={inputRef}
          className="field min-w-0 flex-1"
          type="search"
          value={query}
          data-testid="find-input"
          aria-label="تېپىش"
          placeholder="تېپىش…"
          onChange={(event) => {
            indexRef.current = 0;
            setQuery(event.target.value);
            setNotice(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <span
          className="whitespace-nowrap px-1 text-[12.5px] tabular-nums text-ink3"
          data-testid="find-count"
          role="status"
        >
          {hits.length === 0 ? "0 / 0" : `${index + 1} / ${hits.length}`}
        </span>
        <button
          type="button"
          className="ibtn"
          data-testid="find-prev"
          aria-label="ئالدىنقى"
          disabled={hits.length === 0}
          onClick={() => step(-1)}
        >
          <Icon name="chevron-up" className="ic-lg" />
        </button>
        <button
          type="button"
          className="ibtn"
          data-testid="find-next"
          aria-label="كېيىنكى"
          disabled={hits.length === 0}
          onClick={() => step(1)}
        >
          <Icon name="chevron-down" className="ic-lg" />
        </button>
        <button
          type="button"
          className={showReplace ? "hbtn on" : "hbtn"}
          data-testid="find-toggle-replace"
          aria-expanded={showReplace}
          onClick={() => setShowReplace((value) => !value)}
        >
          <Icon name="refresh" />
          ئالماشتۇرۇش
        </button>
        <button type="button" className="ibtn" data-testid="find-close" aria-label="تاقاش" onClick={onClose}>
          <Icon name="x" className="ic-lg" />
        </button>
      </div>

      {showReplace && (
        <div className="mx-auto mt-1.5 flex w-full max-w-4xl flex-wrap items-center gap-1.5">
          <input
            autoComplete="off"
            className="field min-w-0 flex-1"
            type="text"
            value={replacement}
            data-testid="replace-input"
            aria-label="ئالماشتۇرۇش"
            placeholder="ئالماشتۇرۇلىدىغان سۆز…"
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            type="button"
            className="hbtn"
            data-testid="replace-one"
            disabled={hits.length === 0}
            onClick={replaceOne}
          >
            ئالماشتۇرۇش
          </button>
          <button
            type="button"
            className="hbtn"
            data-testid="replace-all"
            disabled={hits.length === 0}
            onClick={replaceAll}
          >
            ھەممىنى ئالماشتۇرۇش
          </button>
        </div>
      )}

      {notice && (
        <div className="mx-auto mt-1.5 flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[12px] leading-5 text-ink3" data-testid="find-notice" role="status">
            {notice}
          </p>
          {undoable && (
            <button type="button" className="hbtn" data-testid="find-undo-all" onClick={undoAll}>
              <Icon name="undo" />
              ھەممىنى يېنىۋېلىش
            </button>
          )}
        </div>
      )}

      {!canHighlight() && (
        <p className="mx-auto mt-1.5 w-full max-w-4xl text-[12px] leading-5 text-ink3">
          بۇ توركۆرگۈدە تېپىلغان سۆز رەڭلەنمەيدۇ — سانى ۋە يۆتكىلىش ئىشلەيدۇ.
        </p>
      )}
    </div>
  );
}
