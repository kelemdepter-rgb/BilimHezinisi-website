"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpellChecker, type SpellStatus } from "@/lib/spellcheck/client";
import { isSingleToken, tokenize } from "@/lib/spellcheck/dictionary";
import {
  canHighlight,
  hitTest,
  HIGHLIGHT_NAME,
  offsetAtPoint,
  rangeFor,
  readTextMap,
  wordRange,
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
  /** Where the visible page starts: below the sticky toolbar, or the top of the visual viewport. */
  clearTop: number;
  suggestions: string[];
  loading: boolean;
};

/**
 * «بىر-بىرلەپ كۆرۈش» — stepping through the errors one at a time (PROMPT-48).
 *
 * `at` is where the writer is: the number of the word being looked at, or —
 * once that word has been fixed or accepted — how many errors lie behind.
 */
export type SpellNav = { open: boolean; at: number; done: boolean };

const NAV_CLOSED: SpellNav = { open: false, at: 0, done: false };
/** How long «ئىملا خاتالىقى قالمىدى.» stays before the row closes itself. */
const NAV_DONE_MS = 2000;

/** The part of the page a word can be seen in, in viewport coordinates. */
function visibleArea(toolbar: HTMLElement | null): { top: number; bottom: number } {
  const viewport = window.visualViewport;
  const viewTop = viewport?.offsetTop ?? 0;
  const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);
  const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
  return { top: Math.max(viewTop, toolbarBottom), bottom: viewBottom };
}

/** The caret, as a collapsed Range of its own, when it is inside `editor`. */
function caretIn(editor: HTMLElement): Range | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode) return null;
  if (!editor.contains(selection.focusNode)) return null;
  const caret = document.createRange();
  caret.setStart(selection.focusNode, selection.focusOffset);
  return caret;
}

export function useSpellcheck(
  editorRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  /** The sticky toolbar: a word scrolled under it is out of sight. */
  toolbarRef?: React.RefObject<HTMLElement | null>,
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
   * Do the marks still describe the note?
   *
   * A mark is a pair of offsets into the text as it was when the check read
   * it, and a check runs RECHECK_MS after typing stops. A tap inside that
   * window used to hit-test against offsets the typing had already moved, so
   * the popup could name one word while its correction landed on other letters
   * (N8). Every change to the note bumps `revision`; a finished check records
   * the revision it read. The two differ exactly when the marks are stale.
   *
   * Changes are counted from a MutationObserver as well as from
   * `scheduleCheck`, so one made without an input event — a panel writing a
   * block back, a toolbar command in an engine that fires none — is never
   * missed.
   */
  const revision = useRef(0);
  const checkedRevision = useRef(-1);
  const observer = useRef<MutationObserver | null>(null);
  /** The most recent pass to start. One that started earlier and finishes later is dropped. */
  const latestPass = useRef(0);
  /**
   * The open popup's word, as a live Range. Nothing in the note changes
   * while the popup is open — an edit closes it — so the Range keeps
   * pointing at the word as the page scrolls around it.
   */
  const popupWord = useRef<Range | null>(null);

  /**
   * Stepping through the errors. The row's state is `nav`; the rest lives in
   * refs because the check that finishes in the background reads it.
   *
   * WHERE THE WRITER IS. `cursor` is a collapsed LIVE Range in the note: the
   * browser moves it with every edit before it, so typing elsewhere never
   * sends «كېيىنكى» to the wrong place. It is put at the start of each word
   * stepped to, and at the caret when the row opens or the note is tapped.
   * `onMark` says it stands on the word being looked at — so «كېيىنكى» goes
   * past that word — rather than on a word that was fixed, accepted, or never
   * there, where the next error may start exactly at the cursor.
   */
  const [nav, setNav] = useState<SpellNav>(NAV_CLOSED);
  const navOpen = useRef(false);
  const navDone = useRef(false);
  const cursor = useRef<Range | null>(null);
  const onMark = useRef(false);
  /** A step asked for before the dictionary was ready, taken once it is. */
  const pendingStep = useRef<1 | -1 | 0>(0);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The latest `step`, for a check that finishes after the row asked for one. */
  const stepRef = useRef<(direction: 1 | -1) => void>(() => {});

  /**
   * The ref is what the pointer handler reads and the state is what the summary
   * renders, so both are written together. The handler cannot read the state:
   * it is attached once and would close over whatever `marks` was at the time.
   */
  const commitMarks = useCallback((list: MarkedWord[]) => {
    marksRef.current = list;
    setMarks(list);
  }, []);

  /** Where the cursor is in `map`'s text; -1 before the very first character. */
  const cursorOffset = useCallback(
    (map: TextMap): number => {
      const point = cursor.current;
      const editor = editorRef.current;
      if (!point || !editor || !editor.contains(point.startContainer)) return -1;
      return offsetAtPoint(map, point.startContainer, point.startOffset);
    },
    [editorRef],
  );

  /** Bring the row's number up to date with the marks and the cursor. */
  const syncNav = useCallback(() => {
    if (!navOpen.current || navDone.current) return;
    const map = mapRef.current;
    const list = marksRef.current;
    let at = 0;
    if (map) {
      const from = cursorOffset(map);
      const here = onMark.current ? list.findIndex((mark) => mark.start === from) : -1;
      at = here >= 0 ? here + 1 : list.filter((mark) => mark.start < from).length;
    }
    setNav((current) => (current.open && current.at !== at ? { ...current, at } : current));
  }, [cursorOffset]);

  const closeNav = useCallback(() => {
    navOpen.current = false;
    navDone.current = false;
    pendingStep.current = 0;
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = null;
    cursor.current = null;
    onMark.current = false;
    setNav(NAV_CLOSED);
  }, []);

  /** «ئىملا خاتالىقى قالمىدى.», then the row goes by itself. */
  const finishNav = useCallback(() => {
    if (navDone.current) return;
    navDone.current = true;
    pendingStep.current = 0;
    setNav({ open: true, at: 0, done: true });
    doneTimer.current = setTimeout(closeNav, NAV_DONE_MS);
  }, [closeNav]);

  /** An error turned up again while the row said there were none: back to counting. */
  const reopenNav = useCallback(() => {
    if (!navDone.current) return;
    navDone.current = false;
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = null;
    setNav((current) => (current.open ? { ...current, done: false } : current));
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

  /**
   * Count changes the observer has queued but not delivered yet. Its callback
   * runs as a microtask, so a check or a tap arriving in the same task as an
   * edit would otherwise not know about it.
   */
  const pullChanges = useCallback(() => {
    if (observer.current && observer.current.takeRecords().length > 0) revision.current += 1;
  }, []);

  /** True when the marks were found in the note exactly as it is now. */
  const isCurrent = useCallback(() => {
    pullChanges();
    return mapRef.current !== null && checkedRevision.current === revision.current;
  }, [pullChanges]);

  const runCheck = useCallback(async () => {
    const instance = checker.current;
    const editor = editorRef.current;
    if (!instance || instance.status !== "ready" || !editor) return;

    pullChanges();
    const seen = revision.current;
    const pass = ++latestPass.current;
    const map = readTextMap(editor);

    const tokens = tokenize(map.text);
    const unknown = [...new Set(tokens.map((t) => t.word))].filter(
      (word) => !verdicts.current.has(word),
    );
    if (unknown.length > 0) {
      const wrong = new Set(await instance.check(unknown));
      for (const word of unknown) verdicts.current.set(word, !wrong.has(word));
    }

    // A later pass started while this one waited for the worker — after a
    // tap, or more typing — and read a newer note. Its answer is the one to
    // keep.
    if (pass !== latestPass.current) return;

    const next: MarkedWord[] = tokens
      .filter((token) => verdicts.current.get(token.word) === false)
      .map((token) => ({ word: token.word, start: token.start, end: token.end }));

    mapRef.current = map;
    checkedRevision.current = seen;
    commitMarks(next);
    paint(map, next);

    if (navOpen.current) {
      if (next.length === 0) finishNav();
      else reopenNav();
      syncNav();
    }
    // The row was opened before the dictionary was ready.
    const waiting = pendingStep.current;
    if (waiting !== 0 && navOpen.current) {
      pendingStep.current = 0;
      stepRef.current(waiting);
    }
  }, [commitMarks, editorRef, finishNav, paint, pullChanges, reopenNav, syncNav]);

  /**
   * Called by the editor on every change; coalesced into one pass. A change
   * also closes the popup: the word it offered corrections for may have just
   * been edited.
   */
  const scheduleCheck = useCallback(() => {
    if (!enabled) return;
    setPopup(null);
    revision.current += 1;
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
      // Nothing was watching while it was off, so nothing it found then can
      // be trusted when it comes back on.
      mapRef.current = null;
      checkedRevision.current = -1;
      if (canHighlight()) CSS.highlights.delete(HIGHLIGHT_NAME);
      commitMarks([]);
      setPopup(null);
      closeNav();
    };
  }, [closeNav, commitMarks, enabled]);

  // Every change to the note, whatever made it, makes the marks stale and
  // earns a fresh check.
  useEffect(() => {
    const editor = editorRef.current;
    if (!enabled || !editor) return;
    const watcher = new MutationObserver(scheduleCheck);
    watcher.observe(editor, { childList: true, characterData: true, subtree: true });
    observer.current = watcher;
    return () => {
      watcher.disconnect();
      observer.current = null;
    };
  }, [editorRef, enabled, scheduleCheck]);

  // First pass as soon as the dictionary lands.
  useEffect(() => {
    if (enabled && status === "ready") void runCheck();
  }, [enabled, runCheck, status]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    [],
  );

  /**
   * The popup follows its word while the word can be seen (N16).
   *
   * Marks are painted, not built from elements, so the browser moves them
   * with the page by itself. The popup's anchor is a snapshot of where the
   * word was, and used to be thrown away on any scroll or resize — but on a
   * phone, tapping a word focuses the note, the keyboard rises and the page
   * scrolls, which closed the popup the moment it opened. Now a scroll or a
   * resize, of the page or of the visual viewport the keyboard shrinks, moves
   * the anchor instead, at most once a frame; the popup closes only when the
   * word has left the visible part of the page (or on an outside tap, Escape
   * or an edit).
   */
  const popupOpen = popup !== null;
  useEffect(() => {
    if (!popupOpen) return;
    let frame = 0;
    const follow = () => {
      frame = 0;
      const range = popupWord.current;
      if (!range) return;
      const box = range.getBoundingClientRect();
      const view = visibleArea(toolbarRef?.current ?? null);
      const gone =
        (box.width === 0 && box.height === 0) || box.bottom <= view.top || box.top >= view.bottom;
      if (gone) {
        setPopup(null);
        return;
      }
      const rect = { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      setPopup((current) => (current ? { ...current, rect, clearTop: view.top } : current));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(follow);
    };
    const viewport = window.visualViewport;
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [popupOpen, toolbarRef]);

  /** Open the corrections for one marked word, whose Range in the note is `range`. */
  const openMark = useCallback(
    (mark: MarkedWord, range: Range) => {
      popupWord.current = range;
      const box = range.getBoundingClientRect();
      setPopup({
        mark,
        rect: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        clearTop: visibleArea(toolbarRef?.current ?? null).top,
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
    [toolbarRef],
  );

  /** Open the corrections for the marked word at a screen position, if there is one. */
  const openAt = useCallback(
    (x: number, y: number) => {
      const map = mapRef.current;
      if (!map || marksRef.current.length === 0) return;

      const mark = hitTest(map, marksRef.current, x, y);
      // The map is current, so this only fails if the DOM and the map disagree
      // — in which case showing nothing beats showing a word that is not there.
      const range = mark ? wordRange(map, mark) : null;
      if (!mark || !range) {
        popupWord.current = null;
        setPopup(null);
        return;
      }
      // Stepping carries on from a word the writer tapped themselves.
      if (navOpen.current) {
        const start = range.cloneRange();
        start.collapse(true);
        cursor.current = start;
        onMark.current = true;
        syncNav();
      }
      openMark(mark, range);
    },
    [openMark, syncNav],
  );

  /**
   * A tap on the note. If anything changed since the last check, the pending
   * one is run NOW and the tap waits for it, so the popup is always about the
   * word that is under the finger at this moment.
   */
  const onEditorPointerUp = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const { clientX: x, clientY: y } = event;
      // While stepping, «كېيىنكى» goes on from wherever the writer tapped.
      const editor = editorRef.current;
      if (navOpen.current && editor) {
        cursor.current = caretIn(editor);
        onMark.current = false;
      }
      if (isCurrent()) {
        syncNav();
        openAt(x, y);
        return;
      }
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setPopup(null);
      void runCheck().then(() => {
        // Still changing under the finger: no popup rather than a wrong one.
        if (isCurrent()) openAt(x, y);
      });
    },
    [editorRef, enabled, isCurrent, openAt, runCheck, syncNav],
  );

  /**
   * «كېيىنكى» / «ئالدىنقى»: the next error after the cursor, or the last one
   * before it, wrapping at either end. The word is scrolled to the middle of
   * what can be seen below the sticky header — the visual viewport, so a
   * phone's keyboard is allowed for — and its corrections open beside it.
   */
  const step = useCallback(
    async (direction: 1 | -1) => {
      if (!navOpen.current) return;
      if (checker.current?.status !== "ready") {
        // Taken by the first check once the dictionary is in.
        pendingStep.current = direction;
        return;
      }
      if (!isCurrent()) {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        await runCheck();
        // Still changing: the writer is typing, and a step would land on
        // offsets the typing has already moved.
        if (!isCurrent() || !navOpen.current) return;
      }

      const map = mapRef.current;
      const list = marksRef.current;
      if (!map) return;
      if (list.length === 0) {
        finishNav();
        return;
      }
      const from = cursorOffset(map);
      const target =
        direction === 1
          ? (list.find((mark) => (onMark.current ? mark.start > from : mark.start >= from)) ?? list[0])
          : (list.findLast((mark) => mark.start < from) ?? list[list.length - 1]);
      const range = wordRange(map, target);
      if (!range) {
        void runCheck();
        return;
      }

      const start = range.cloneRange();
      start.collapse(true);
      cursor.current = start;
      onMark.current = true;
      setNav({ open: true, at: list.indexOf(target) + 1, done: false });

      // Instantly: the popup is placed from where the word is once the page
      // has moved, and a smooth scroll would still be on its way.
      const box = range.getBoundingClientRect();
      const view = visibleArea(toolbarRef?.current ?? null);
      const shift = box.top + box.height / 2 - (view.top + view.bottom) / 2;
      if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: "instant" });
      openMark(target, range);
    },
    [cursorOffset, finishNav, isCurrent, openMark, runCheck, toolbarRef],
  );

  useEffect(() => {
    stepRef.current = (direction) => void step(direction);
  });

  /**
   * Open the row and go to the first error after the caret — `caret`, the
   * one the editor remembers, which outlives the tap on a button that took
   * the focus; failing that, the live selection; failing that, the start.
   */
  const openNav = useCallback(
    (caret: Range | null) => {
      const editor = editorRef.current;
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = null;
      navOpen.current = true;
      navDone.current = false;
      const remembered = caret && editor?.contains(caret.startContainer) ? caret.cloneRange() : null;
      remembered?.collapse(false);
      cursor.current = remembered ?? (editor ? caretIn(editor) : null);
      onMark.current = false;
      setNav({ open: true, at: 0, done: false });
      void step(1);
    },
    [editorRef, step],
  );

  /**
   * Replace just that word, keeping the undo stack and the caret intact — and
   * only if it is still exactly where the popup said.
   */
  const applySuggestion = useCallback(
    (mark: MarkedWord, replacement: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      setPopup(null);

      // Never the map the popup was opened from: anything typed since moved
      // its offsets, and a Range built from moved offsets is how a correction
      // once landed on other letters — or across a line end, taking the next
      // line's first word with it (N1, N8).
      const range = wordRange(readTextMap(editor), mark);
      if (!range) {
        // The word is not there any more. Change nothing, and re-check so the
        // underline shows where things are now; the writer taps it again.
        void runCheck();
        return;
      }

      const selection = window.getSelection();
      if (!selection) return;
      editor.focus();
      selection.removeAllRanges();
      selection.addRange(range);
      // execCommand rather than range.deleteContents(): it is the only thing
      // that keeps the browser's own undo stack, so Ctrl+Z after a correction
      // behaves like undoing anything else the writer typed.
      document.execCommand("insertText", false, replacement);

      // The cursor stays at the start of the corrected word; «كېيىنكى»
      // carries on from there.
      onMark.current = false;
      void runCheck();
    },
    [editorRef, runCheck],
  );

  /**
   * Marks taken away by an answer from the popup, at once, without waiting
   * for a check: the word is right now, wherever it occurs.
   */
  const dropMarks = useCallback(
    (keep: (mark: MarkedWord) => boolean) => {
      const remaining = marksRef.current.filter(keep);
      commitMarks(remaining);
      paint(mapRef.current, remaining);
      if (!navOpen.current) return;
      onMark.current = false;
      if (remaining.length === 0) finishNav();
      else syncNav();
    },
    [commitMarks, finishNav, paint, syncNav],
  );

  /** «لۇغەتكە قوش» — this word is right; stop telling me it is not. */
  const addToPersonal = useCallback(
    (word: string) => {
      setPopup(null);
      // One word or nothing. A mark is always one word now that line ends
      // separate words, and this keeps it so whatever reaches here.
      if (!isSingleToken(word)) return;
      const next = [...new Set([...personal, word])];
      setPersonal(next);
      writePersonal(next);
      checker.current?.setPersonal(next);
      // The cached verdict for this word is now wrong, and only for this word.
      verdicts.current.delete(word);
      dropMarks((mark) => mark.word !== word);
    },
    [dropMarks, personal],
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
    nav,
    openNav,
    closeNav,
    step,
    /** False on browsers without the Custom Highlight API; the UI says so. */
    canUnderline: canHighlight(),
  };
}
