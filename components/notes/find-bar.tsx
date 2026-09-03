"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { canHighlight, rangeFor } from "@/lib/spellcheck/marks";
import {
  FIND_CURRENT_HIGHLIGHT,
  FIND_HIGHLIGHT,
  findInEditor,
  replacedHtml,
  type FindHit,
} from "@/lib/notes/find";

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
 * REPLACE IS ONE UNDO STEP. Every replacement is computed on a detached clone
 * (lib/notes/find.ts) and written back with a single selectAll + insertHTML, so
 * the browser records one undo entry for the whole operation — Ctrl+Z after a
 * replace-all restores the document exactly, in one press.
 */
export function FindBar({
  open,
  editorRef,
  revision,
  initialQuery,
  onClose,
  onDocumentChanged,
}: {
  open: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
  /** Bumped by the editor whenever its content changed, so hits are re-found. */
  revision: number;
  initialQuery: string;
  onClose: () => void;
  onDocumentChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [hits, setHits] = useState<FindHit[]>([]);
  const [index, setIndex] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The current hit, readable from callbacks that were created before it
   * changed. Written beside every setIndex, never during render.
   */
  const indexRef = useRef(-1);

  /**
   * Pre-fill from the note's selection, exactly as the desktop does. Adjusted
   * during render because it is state derived from a prop changing, not a side
   * effect on an external system.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && initialQuery.trim()) setQuery(initialQuery.trim());
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
   * Write the clone back over the whole document in one command, which is what
   * makes the operation a single undo step.
   */
  const applyReplacement = useCallback(
    (all: boolean) => {
      const editor = editorRef.current;
      if (!editor || hits.length === 0) return;

      const { html, count } = replacedHtml(editor, query, replacement, all ? -1 : Math.max(index, 0));
      if (count === 0) return;

      editor.focus();
      document.execCommand("selectAll", false);
      document.execCommand("insertHTML", false, html);

      setNotice(`${count} ئورۇن ئالماشتۇرۇلدى. يېنىۋېلىش (Ctrl+Z) بىلەن ئەسلىگە قايتىدۇ.`);
      indexRef.current = 0;
      onDocumentChanged();
    },
    [editorRef, hits.length, index, onDocumentChanged, query, replacement],
  );

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
            onClick={() => applyReplacement(false)}
          >
            ئالماشتۇرۇش
          </button>
          <button
            type="button"
            className="hbtn"
            data-testid="replace-all"
            disabled={hits.length === 0}
            onClick={() => applyReplacement(true)}
          >
            ھەممىنى ئالماشتۇرۇش
          </button>
        </div>
      )}

      {notice && (
        <p
          className="mx-auto mt-1.5 w-full max-w-4xl text-[12px] leading-5 text-ink3"
          data-testid="find-notice"
          role="status"
        >
          {notice}
        </p>
      )}

      {!canHighlight() && (
        <p className="mx-auto mt-1.5 w-full max-w-4xl text-[12px] leading-5 text-ink3">
          بۇ توركۆرگۈدە تېپىلغان سۆز رەڭلەنمەيدۇ — سانى ۋە يۆتكىلىش ئىشلەيدۇ.
        </p>
      )}
    </div>
  );
}
