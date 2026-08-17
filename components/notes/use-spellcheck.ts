"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpellChecker, type SpellStatus } from "@/lib/spellcheck/client";
import { tokenize } from "@/lib/spellcheck/dictionary";
import {
  canHighlight,
  hitTest,
  HIGHLIGHT_NAME,
  rangeFor,
  readTextMap,
  type MarkedWord,
  type TextMap,
} from "@/lib/spellcheck/marks";

const PERSONAL_KEY = "bh-personal-dictionary";
/**
 * Long enough that a normal typing burst produces one check rather than thirty,
 * short enough that the underline appears while the writer is still looking at
 * the word.
 */
const RECHECK_MS = 450;

/**
 * The personal dictionary lives in this browser, not in Postgres.
 *
 * It is a list of words one person considers correct — a few dozen at most,
 * worth a few hundred bytes. A table for it would add a migration, a row per
 * word, an RLS policy and a round trip on every note open, to store less than a
 * single page of a book.
 */
export function readPersonal(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PERSONAL_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writePersonal(words: string[]) {
  try {
    window.localStorage.setItem(PERSONAL_KEY, JSON.stringify(words));
  } catch {
    // Private mode: the additions last for this session only.
  }
}

export type SpellPopupState = {
  mark: MarkedWord;
  /** Viewport coordinates of the word, for anchoring. */
  rect: { top: number; bottom: number; left: number; right: number };
  suggestions: string[];
  loading: boolean;
};

export function useSpellcheck(
  editorRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const checker = useRef<SpellChecker | null>(null);
  const [status, setStatus] = useState<SpellStatus>("off");
  const [marks, setMarks] = useState<MarkedWord[]>([]);
  const [popup, setPopup] = useState<SpellPopupState | null>(null);
  const [personal, setPersonal] = useState<string[]>(readPersonal);

  const mapRef = useRef<TextMap | null>(null);
  const marksRef = useRef<MarkedWord[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Which words have already been judged. A note repeats its vocabulary
   * constantly, and re-asking the worker about «ۋە» on every keystroke is work
   * with a known answer. Cleared whenever the personal dictionary changes,
   * because that changes the answers.
   */
  const verdicts = useRef<Map<string, boolean>>(new Map());

  /**
   * The ref is what the pointer handler reads and the state is what the summary
   * renders, so both are written together. The handler cannot read the state:
   * it is attached once and would close over whatever `marks` was at the time.
   */
  const commitMarks = useCallback((list: MarkedWord[]) => {
    marksRef.current = list;
    setMarks(list);
  }, []);

  /** Paint the current marks. No DOM mutation — see lib/spellcheck/marks.ts. */
  const paint = useCallback((map: TextMap | null, list: readonly MarkedWord[]) => {
    if (!canHighlight()) return;
    const registry = CSS.highlights;
    if (!map || list.length === 0) {
      registry.delete(HIGHLIGHT_NAME);
      return;
    }
    const ranges: Range[] = [];
    for (const mark of list) {
      const range = rangeFor(map, mark.start, mark.end);
      if (range) ranges.push(range);
    }
    if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME);
    else registry.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  }, []);

  const runCheck = useCallback(async () => {
    const instance = checker.current;
    const editor = editorRef.current;
    if (!instance || instance.status !== "ready" || !editor) return;

    const map = readTextMap(editor);
    mapRef.current = map;

    const tokens = tokenize(map.text);
    const unknown = [...new Set(tokens.map((t) => t.word))].filter(
      (word) => !verdicts.current.has(word),
    );
    if (unknown.length > 0) {
      const wrong = new Set(await instance.check(unknown));
      for (const word of unknown) verdicts.current.set(word, !wrong.has(word));
    }

    const next: MarkedWord[] = tokens
      .filter((token) => verdicts.current.get(token.word) === false)
      .map((token) => ({ word: token.word, start: token.start, end: token.end }));

    commitMarks(next);
    paint(map, next);
  }, [commitMarks, editorRef, paint]);

  /** Called by the editor on every input; coalesced into one pass. */
  const scheduleCheck = useCallback(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void runCheck(), RECHECK_MS);
  }, [enabled, runCheck]);

  // Start and stop the worker with the toggle.
  useEffect(() => {
    if (!enabled) return;
    const instance = new SpellChecker(setStatus);
    const cache = verdicts.current;
    checker.current = instance;
    instance.start();
    instance.setPersonal(readPersonal());
    return () => {
      instance.stop();
      checker.current = null;
      cache.clear();
      if (canHighlight()) CSS.highlights.delete(HIGHLIGHT_NAME);
      commitMarks([]);
      setPopup(null);
    };
  }, [commitMarks, enabled]);

  // First pass as soon as the dictionary lands.
  useEffect(() => {
    if (enabled && status === "ready") void runCheck();
  }, [enabled, runCheck, status]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Marks are painted, not built from elements, so they do not move when the
   * page reflows — the ranges do, but their painted position is recomputed by
   * the browser. What DOES need re-doing is the popup's anchor, which is a
   * snapshot of where the word was.
   */
  useEffect(() => {
    if (!popup) return;
    const reposition = () => setPopup(null);
    window.addEventListener("scroll", reposition, { passive: true, capture: true });
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    };
  }, [popup]);

  /** Open the corrections for whatever word was tapped, if it is a marked one. */
  const onEditorPointerUp = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const map = mapRef.current;
      if (!map || marksRef.current.length === 0) return;

      const mark = hitTest(map, marksRef.current, event.clientX, event.clientY);
      if (!mark) {
        setPopup(null);
        return;
      }

      const range = rangeFor(map, mark.start, mark.end);
      const box = range?.getBoundingClientRect();
      if (!box) return;

      setPopup({
        mark,
        rect: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        suggestions: [],
        loading: true,
      });

      void checker.current?.suggest(mark.word).then((list) => {
        setPopup((current) =>
          current && current.mark.start === mark.start
            ? { ...current, suggestions: list, loading: false }
            : current,
        );
      });
    },
    [enabled],
  );

  /** Replace just that word, keeping the undo stack and the caret intact. */
  const applySuggestion = useCallback(
    (mark: MarkedWord, replacement: string) => {
      const map = mapRef.current;
      const editor = editorRef.current;
      if (!map || !editor) return;
      const range = rangeFor(map, mark.start, mark.end);
      if (!range) return;

      const selection = window.getSelection();
      if (!selection) return;
      editor.focus();
      selection.removeAllRanges();
      selection.addRange(range);
      // execCommand rather than range.deleteContents(): it is the only thing
      // that keeps the browser's own undo stack, so Ctrl+Z after a correction
      // behaves like undoing anything else the writer typed.
      document.execCommand("insertText", false, replacement);

      setPopup(null);
      void runCheck();
    },
    [editorRef, runCheck],
  );

  /** «لۇغەتكە قوش» — this word is right; stop telling me it is not. */
  const addToPersonal = useCallback(
    (word: string) => {
      const next = [...new Set([...personal, word])];
      setPersonal(next);
      writePersonal(next);
      checker.current?.setPersonal(next);
      // The cached verdict for this word is now wrong, and only for this word.
      verdicts.current.delete(word);
      const remaining = marksRef.current.filter((mark) => mark.word !== word);
      commitMarks(remaining);
      paint(mapRef.current, remaining);
      setPopup(null);
    },
    [commitMarks, paint, personal],
  );

  return {
    status,
    marks,
    popup,
    closePopup: useCallback(() => setPopup(null), []),
    onEditorPointerUp,
    scheduleCheck,
    runCheck,
    applySuggestion,
    addToPersonal,
    /** False on browsers without the Custom Highlight API; the UI says so. */
    canUnderline: canHighlight(),
  };
}
