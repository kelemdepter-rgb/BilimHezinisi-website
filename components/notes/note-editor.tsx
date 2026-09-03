"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { saveNoteAction } from "@/app/notes/actions";
import { MAX_NOTE_CHARS } from "@/lib/notes/limits";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import {
  MAX_NOTE_LEADING,
  MAX_NOTE_SIZE,
  MIN_NOTE_LEADING,
  MIN_NOTE_SIZE,
  NOTE_FONTS,
  NOTE_FONT_LABELS,
  NOTE_FONT_STACKS,
  type NoteTypography,
} from "@/lib/notes/typography";
import {
  getTypographyServerSnapshot,
  getTypographySnapshot,
  subscribeTypography,
  updateTypographyStore,
} from "@/lib/notes/typography-store";
import type { NoteDocument } from "@/lib/notes/data";
import { SpellPopup } from "@/components/notes/spell-popup";
import { useSpellcheck } from "@/components/notes/use-spellcheck";
import { SourcePanel } from "@/components/notes/source-panel";
import { NotesAiPanel } from "@/components/notes/ai-panel";
import { FindBar } from "@/components/notes/find-bar";
import { useAiState } from "@/lib/ai/use-ai-state";
import { QURAN_ATTRIBUTION } from "@/lib/notes/attribution";

const SAVE_DEBOUNCE_MS = 1200;
/** Warn while there is still room to finish a thought. */
const WARN_AT = Math.round(MAX_NOTE_CHARS * 0.9);

type SaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "ئۆزگەردى…",
  saving: "ساقلىنىۋاتىدۇ…",
  saved: "ساقلاندى",
  offline: "ئۇلىنىش يوق — يەرلىكتە ساقلاندى",
  error: "ساقلانمىدى — قايتا سىنالماقتا",
};

/** Where an unsent draft waits out a dropped connection. */
const draftKey = (id: number) => `bh-note-draft-${id}`;

function readDraft(id: number): string | null {
  try {
    return window.localStorage.getItem(draftKey(id));
  } catch {
    return null;
  }
}

export function NoteEditor({ note }: { note: NoteDocument }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(note.title);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [spellOpen, setSpellOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  /** Bumped on every open so the panel resets itself during render. */
  const [aiToken, setAiToken] = useState(0);
  /**
   * What the AI panel would send, captured HERE and handed down.
   *
   * The panel has to show it before anything leaves — a writer must never send
   * their whole private notebook to Google by accident — and a component may
   * not read a ref while rendering. So the editor reads it in an event
   * handler, which is exactly where reading the DOM belongs.
   */
  const [aiScope, setAiScope] = useState({ selection: "", note: "" });
  /** Whatever was selected in the note when a panel was opened. */
  const [selectionText, setSelectionText] = useState("");
  /** Bumped on every content change, so the find bar re-finds its hits. */
  const [revision, setRevision] = useState(0);
  const typography = useSyncExternalStore(
    subscribeTypography,
    getTypographySnapshot,
    getTypographyServerSnapshot,
  );
  /** True once the note holds a Qur'an verse, so its sources can be credited. */
  const [hasAya, setHasAya] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The caret, remembered.
   *
   * A panel has its own search box, and typing in it moves the selection out of
   * the note. Without this, inserting a passage would drop it wherever the
   * browser felt like — usually at the very start. Tracked continuously rather
   * than captured on click, because the selection is already gone by then.
   */
  const savedRange = useRef<Range | null>(null);

  /**
   * The spellchecker underlines words in place rather than listing them in a
   * panel. It owns the marks, the popup and the worker; the editor only has to
   * tell it when the text changed and where a tap landed.
   */
  const spell = useSpellcheck(editorRef, spellOpen);

  /**
   * AI exists in the notebook only for a writer who switched it on at /my/ai
   * and put a key in. Everyone else gets no button and no mention of it — the
   * notebook is complete without it, offline included, so there is nothing to
   * advertise. The offline spellchecker beside it is untouched either way.
   */
  const ai = useAiState();
  const aiAvailable = ai.enabled && ai.hasKey;

  const recount = useCallback(() => {
    const editor = editorRef.current;
    const text = editor?.innerText ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    setCounts({ words, chars: text.length });
    // Only an inserted aya carries the Uthmani face, so this is an exact test
    // for "does this note quote the Qur'an" and never a guess.
    setHasAya(Boolean(editor?.querySelector('[style*="Uthmanic Hafs"]')));
  }, []);

  /** One place that records "the document changed", so nothing is forgotten. */
  const markChanged = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      const editor = editorRef.current;
      const selection = document.getSelection();
      if (!editor || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;
      savedRange.current = range.cloneRange();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  /**
   * The editor is uncontrolled on purpose: React must never re-render the
   * contentEditable while someone is typing in it, or the caret jumps. So the
   * content is written once, by hand, the moment the node exists — a ref
   * callback rather than an effect, because "fill this DOM node when it
   * appears" is exactly what a ref callback is for.
   */
  const seeded = useRef(false);
  const attachEditor = useCallback(
    (node: HTMLDivElement | null) => {
      editorRef.current = node;
      if (!node || seeded.current) return;
      seeded.current = true;

      const draft = readDraft(note.id);
      node.innerHTML = draft ?? note.content_html;
      if (draft && draft !== note.content_html) {
        setNotice("ئۇلىنىش ئۈزۈلگەندە ساقلانغان نۇسخا ئەسلىگە كەلتۈرۈلدى.");
        setSaveState("dirty");
      }
      recount();
    },
    [note.content_html, note.id, recount],
  );

  const save = useCallback(async () => {
    const html = editorRef.current?.innerHTML ?? "";
    setSaveState("saving");
    try {
      const result = await saveNoteAction({ id: note.id, title, html });
      if (!result.ok) {
        setSaveState("error");
        setNotice(result.error);
        return;
      }
      setSaveState("saved");
      setNotice(null);
      try {
        window.localStorage.removeItem(draftKey(note.id));
      } catch {
        // Nothing to clean up if storage is unavailable.
      }
    } catch {
      // Offline, or the request never landed. Keep the writing locally and
      // let the next edit (or the retry below) try again — never lose it.
      try {
        window.localStorage.setItem(draftKey(note.id), html);
        setSaveState("offline");
      } catch {
        setSaveState("error");
      }
    }
  }, [note.id, title]);

  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  }, [save]);

  // Retry as soon as the connection is back.
  useEffect(() => {
    const retry = () => {
      if (saveState === "offline" || saveState === "error") void save();
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [save, saveState]);

  // Leaving with unsaved work should at least keep a local copy.
  useEffect(() => {
    const onLeave = () => {
      if (saveState === "dirty" || saveState === "saving") {
        try {
          window.localStorage.setItem(draftKey(note.id), editorRef.current?.innerHTML ?? "");
        } catch {
          // Best effort only.
        }
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [note.id, saveState]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /**
   * execCommand is deprecated and still the only thing every mobile browser
   * implements for rich text in a contentEditable. The desktop app uses it too.
   */
  function exec(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    scheduleSave();
    recount();
    markChanged();
  }

  /** The note's current selection as plain text, for pre-filling a panel. */
  function currentSelection(): string {
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return "";
    return selection.toString().trim();
  }

  /**
   * Put a citation where the caret was.
   *
   * The saved range is restored first, so the passage lands in the sentence
   * being written rather than at the top of the note, and the editor is left
   * focused so typing can carry straight on. The HTML goes through the same
   * sanitizer a save would apply — if something could not survive storage, it
   * never appears on screen either.
   */
  const insertAtCaret = useCallback(
    (html: string, message: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      editor.focus();
      const selection = window.getSelection();
      const range = savedRange.current;
      if (range && editor.contains(range.commonAncestorContainer)) {
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else if (selection) {
        // Nothing was ever typed in this note, so there is no caret to restore
        // — the passage goes at the end rather than nowhere.
        const atEnd = document.createRange();
        atEnd.selectNodeContents(editor);
        atEnd.collapse(false);
        selection.removeAllRanges();
        selection.addRange(atEnd);
      }
      document.execCommand("insertHTML", false, sanitizeNoteHtml(html));

      const after = window.getSelection();
      savedRange.current = after && after.rangeCount > 0 ? after.getRangeAt(0).cloneRange() : null;

      setNotice(message);
      scheduleSave();
      recount();
      markChanged();
      spell.scheduleCheck();
    },
    [markChanged, recount, scheduleSave, spell],
  );

  /**
   * Plain text at the caret, from a panel.
   *
   * insertText rather than insertHTML: an AI answer is text, and execCommand's
   * insertText is one undo step in every browser that implements it.
   */
  const insertText = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const selection = window.getSelection();
      const range = savedRange.current;
      if (range && editor.contains(range.commonAncestorContainer)) {
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else if (selection) {
        const atEnd = document.createRange();
        atEnd.selectNodeContents(editor);
        atEnd.collapse(false);
        selection.removeAllRanges();
        selection.addRange(atEnd);
      }
      document.execCommand("insertText", false, text);
      const after = window.getSelection();
      savedRange.current = after && after.rangeCount > 0 ? after.getRangeAt(0).cloneRange() : null;
      setNotice("قىستۇرۇلدى.");
      scheduleSave();
      recount();
      markChanged();
      spell.scheduleCheck();
    },
    [markChanged, recount, scheduleSave, spell],
  );

  /** Replace what was selected — one undoable step, like the desktop. */
  const replaceSelectionWith = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      const range = savedRange.current;
      if (!editor || !range || range.collapsed) {
        setNotice("ئالماشتۇرىدىغان تاللاش يوق.");
        return;
      }
      editor.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("insertText", false, text);
      savedRange.current = null;
      setNotice("ئالماشتۇرۇلدى.");
      scheduleSave();
      recount();
      markChanged();
      spell.scheduleCheck();
    },
    [markChanged, recount, scheduleSave, spell],
  );

  /**
   * The panel rewrote blocks itself (proofread apply, or its undo). The
   * document changed without an input event, so everything that normally
   * follows one has to be run by hand — including autosave, or a correction
   * would sit on screen and never reach the database.
   */
  const afterPanelEdit = useCallback(() => {
    scheduleSave();
    recount();
    markChanged();
    spell.scheduleCheck();
  }, [markChanged, recount, scheduleSave, spell]);

  /** Re-read the selection and the note, for the panel's scope line. */
  const captureAiScope = useCallback(() => {
    setAiScope({
      selection: currentSelection(),
      note: (editorRef.current?.innerText ?? "").trim(),
    });
  }, []);

  function updateTypography(patch: Partial<NoteTypography>) {
    updateTypographyStore(patch);
  }

  /**
   * Paste as sanitized HTML, never as whatever the clipboard carried. Images
   * are dropped rather than embedded: a pasted screenshot arrives as a base64
   * data URI, which would put megabytes of binary into a text column.
   */
  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");

    if (html) {
      const container = document.createElement("div");
      // Count what will be dropped, so the writer is told why. DOMParser is
      // used rather than a detached div because its document is inert: nothing
      // in the pasted markup loads or runs while it is being counted.
      const imageCount = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelectorAll("img").length;
      container.innerHTML = sanitizeNoteHtml(html);
      document.execCommand("insertHTML", false, container.innerHTML);
      if (imageCount > 0) {
        setNotice("رەسىملەر خاتىرىگە قوشۇلمايدۇ — پەقەت تېكىست ساقلىنىدۇ.");
      }
    } else {
      document.execCommand("insertText", false, text);
    }
    scheduleSave();
    recount();
    markChanged();
  }

  const overLimit = counts.chars > MAX_NOTE_CHARS;
  const nearLimit = counts.chars > WARN_AT;

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        The toolbar sits at the TOP, and that is the whole answer to the mobile
        problem: an on-screen keyboard rises from the bottom, so a bar anchored
        to the bottom either hides under it or covers the line being typed. A
        sticky top bar is reachable with the keyboard open and never sits over
        the caret. The find bar joins it for the same reason.
      */}
      <header
        data-testid="note-toolbar"
        className="grain safe-top safe-x sticky top-0 z-30 border-b border-bd bg-bg2/95 backdrop-blur print:hidden"
      >
        <div className="mx-auto flex w-full max-w-4xl items-center gap-1 px-2 py-2 sm:px-4">
          <Link href="/notes" className="ibtn" aria-label="خاتىرىلەر تىزىملىكى" data-testid="notes-back">
            <Icon name="undo" className="ic-lg" />
          </Link>
          <input
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-2 text-[15px] font-bold text-ink outline-none"
            value={title}
            aria-label="خاتىرە ماۋزۇسى"
            data-testid="note-title"
            onChange={(event) => {
              setTitle(event.target.value);
              scheduleSave();
            }}
          />
          <span
            className="whitespace-nowrap px-1 text-[12px] text-ink3"
            data-testid="save-state"
            role="status"
          >
            {SAVE_LABEL[saveState]}
          </span>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-0.5 px-1 pb-2 sm:px-3">
          <FormatButton icon="bold" label="توم" onClick={() => exec("bold")} />
          <FormatButton icon="italic" label="يانتۇ" onClick={() => exec("italic")} />
          <FormatButton icon="underline" label="ئاستى سىزىق" onClick={() => exec("underline")} />
          <FormatButton
            icon="heading"
            label="ماۋزۇ"
            onClick={() => exec("formatBlock", "<h2>")}
          />
          <FormatButton icon="list" label="تىزىملىك" onClick={() => exec("insertUnorderedList")} />
          <FormatButton
            icon="list-ordered"
            label="نومۇرلۇق تىزىملىك"
            onClick={() => exec("insertOrderedList")}
          />
          <FormatButton icon="quote" label="نەقىل" onClick={() => exec("formatBlock", "<blockquote>")} />

          {/* Both panels keep the note's selection: the button refuses focus on
              mousedown, so whatever was highlighted is still highlighted when
              the query is read from it. */}
          <FormatButton
            icon="link"
            label="مەنبە قىستۇرۇش"
            testId="source-open"
            onClick={() => {
              setSelectionText(currentSelection());
              setSourceOpen(true);
            }}
          />
          <FormatButton
            icon="search"
            label="تېپىش ۋە ئالماشتۇرۇش"
            testId="find-open"
            onClick={() => {
              setSelectionText(currentSelection());
              setFindOpen((open) => !open);
            }}
          />

          {/* Everything that does not fit lives behind a tap, not a hover. */}
          <button
            type="button"
            className="ibtn"
            data-testid="toolbar-more"
            aria-label="باشقا ئىقتىدارلار"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <Icon name="menu" className="ic-lg" />
          </button>

          <span className="ms-auto flex items-center gap-0.5">
            {aiAvailable && (
              <button
                type="button"
                className="hbtn"
                data-testid="notes-ai-toggle"
                aria-label="سۈنئىي ئىدراك ياردەمچىسى"
                aria-expanded={aiOpen}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  // Read the selection HERE, while it still exists: opening a
                  // panel moves focus and collapses it.
                  captureAiScope();
                  setAiToken((token) => token + 1);
                  setAiOpen(true);
                }}
              >
                <Icon name="sparkles" />
                <span className="hidden sm:inline">AI</span>
              </button>
            )}
            <button
              type="button"
              className={spellOpen ? "hbtn on" : "hbtn"}
              data-testid="spell-toggle"
              aria-pressed={spellOpen}
              onClick={() => setSpellOpen((open) => !open)}
            >
              <Icon name="check" />
              <span className="hidden sm:inline">ئىملا</span>
            </button>
          </span>
        </div>

        {overflowOpen && (
          <div
            className="border-t border-bd px-2 pb-2 pt-2 sm:px-4"
            data-testid="toolbar-overflow"
          >
            <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1">
              <FormatButton icon="align-right" label="ئوڭغا" onClick={() => exec("justifyRight")} />
              <FormatButton icon="align-center" label="ئوتتۇرىغا" onClick={() => exec("justifyCenter")} />
              <FormatButton icon="align-left" label="سولغا" onClick={() => exec("justifyLeft")} />
              <FormatButton icon="undo" label="يېنىۋېلىش" onClick={() => exec("undo")} />
              <FormatButton icon="redo" label="قايتىلاش" onClick={() => exec("redo")} />
              <FormatButton
                icon="eraser"
                label="فورماتنى تازىلاش"
                onClick={() => exec("removeFormat")}
              />
              <label className="hbtn cursor-pointer">
                <Icon name="brush" />
                <span className="hidden sm:inline">رەڭ</span>
                <input
                  type="color"
                  className="h-0 w-0 opacity-0"
                  aria-label="خەت رەڭگى"
                  onChange={(event) => exec("foreColor", event.target.value)}
                />
              </label>
              <button
                type="button"
                className="hbtn"
                data-testid="export-docx"
                onClick={() =>
                  // The DOCX writer (docx + JSZip, ~340 KB) is fetched when a
                  // note is actually exported, not on every visit to the editor.
                  void import("@/lib/notes/export-docx")
                    .then(({ downloadDocx }) =>
                      downloadDocx(title, editorRef.current?.innerHTML ?? ""),
                    )
                    .catch(() => setNotice("ھۆججەتنى چىقارغىلى بولمىدى."))
                }
              >
                <Icon name="download" />
                Word
              </button>
            </div>

            {/* Typography for the page, not for the selection — see
                lib/notes/typography.ts for why that is the right shape here. */}
            <div className="mx-auto mt-2 flex w-full max-w-4xl flex-wrap items-center gap-2 border-t border-bd pt-2">
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink2">
                خەت نۇسخىسى
                <select
                  className="field w-auto py-1.5"
                  data-testid="note-font"
                  value={typography.font}
                  onChange={(event) =>
                    updateTypography({ font: event.target.value as NoteTypography["font"] })
                  }
                >
                  {NOTE_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {NOTE_FONT_LABELS[font]}
                    </option>
                  ))}
                </select>
              </label>
              <span className="flex items-center gap-1 text-[12.5px] text-ink2">
                خەت چوڭلۇقى
                <button
                  type="button"
                  className="ibtn"
                  data-testid="note-size-down"
                  aria-label="خەتنى كىچىكلىتىش"
                  disabled={typography.fontSize <= MIN_NOTE_SIZE}
                  onClick={() => updateTypography({ fontSize: typography.fontSize - 1 })}
                >
                  −
                </button>
                <span className="min-w-8 text-center tabular-nums" data-testid="note-size-value">
                  {typography.fontSize}
                </span>
                <button
                  type="button"
                  className="ibtn"
                  data-testid="note-size-up"
                  aria-label="خەتنى چوڭايتىش"
                  disabled={typography.fontSize >= MAX_NOTE_SIZE}
                  onClick={() => updateTypography({ fontSize: typography.fontSize + 1 })}
                >
                  +
                </button>
              </span>
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink2">
                قۇر ئارىلىقى {typography.lineHeight.toFixed(1)}
                <input
                  className="w-28 accent-[var(--am)]"
                  type="range"
                  data-testid="note-line-height"
                  min={MIN_NOTE_LEADING}
                  max={MAX_NOTE_LEADING}
                  step={0.1}
                  value={typography.lineHeight}
                  onChange={(event) =>
                    updateTypography({ lineHeight: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          </div>
        )}

        <FindBar
          open={findOpen}
          editorRef={editorRef}
          revision={revision}
          initialQuery={selectionText}
          onClose={() => setFindOpen(false)}
          onDocumentChanged={() => {
            scheduleSave();
            recount();
            markChanged();
            spell.scheduleCheck();
          }}
        />
      </header>

      {notice && (
        <p
          role="status"
          className="mx-auto mt-3 w-full max-w-4xl rounded-[var(--radius)] bg-ab px-3.5 py-2.5 text-[13px] leading-6"
          data-testid="note-notice"
        >
          {notice}
        </p>
      )}

      {nearLimit && (
        <p
          role="alert"
          className={`mx-auto mt-3 w-full max-w-4xl rounded-[var(--radius)] px-3.5 py-2.5 text-[13px] leading-6 ${
            overLimit ? "bg-ab2 font-semibold" : "bg-ab"
          }`}
        >
          {overLimit
            ? `خاتىرە ${MAX_NOTE_CHARS.toLocaleString("en-US")} ھەرپتىن ئېشىپ كەتتى — ساقلانمايدۇ. ئىككىگە بۆلۈڭ.`
            : `خاتىرە ئۇزۇنلىقى چەككە يېقىنلاشتى (${counts.chars.toLocaleString("en-US")} / ${MAX_NOTE_CHARS.toLocaleString("en-US")}).`}
        </p>
      )}

      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-4 sm:px-5">
        <div
          ref={attachEditor}
          contentEditable
          suppressContentEditableWarning
          dir="rtl"
          role="textbox"
          aria-multiline="true"
          aria-label="خاتىرە مەزمۇنى"
          data-testid="note-body"
          spellCheck={false}
          style={{
            fontFamily: NOTE_FONT_STACKS[typography.font],
            fontSize: `${typography.fontSize}px`,
            lineHeight: typography.lineHeight,
          }}
          className="md-body paper min-h-[60dvh] w-full px-4 py-5 outline-none sm:px-6"
          onInput={() => {
            scheduleSave();
            recount();
            markChanged();
            spell.scheduleCheck();
          }}
          onPaste={onPaste}
          // There is no element around a misspelled word to click — the marks
          // are painted, not inserted — so the tap is mapped back to the text
          // by position. See lib/spellcheck/marks.ts.
          onClick={spell.onEditorPointerUp}
        />

        {/*
          The Qur'an's two texts are redistributed under licences that require
          attribution (CC BY 3.0, and QuranEnc's own terms). A note holding a
          verse is a copy of them, so the credit travels with it — on screen
          only when printing, and appended by the DOCX export to the file.
        */}
        {hasAya && (
          <p
            className="mt-4 hidden text-[11.5px] leading-6 text-ink3 print:block"
            data-testid="note-quran-attribution"
          >
            {QURAN_ATTRIBUTION}
          </p>
        )}

        <p className="mt-3 text-[12px] text-ink3" data-testid="note-counts">
          {counts.words} سۆز · {counts.chars.toLocaleString("en-US")} ھەرپ
          {spellOpen && spell.status === "ready" && (
            <span data-testid="spell-summary">
              {" · "}
              {spell.marks.length === 0
                ? "ئىملا: خاتالىق يوق"
                : `ئىملا: ${spell.marks.length} خاتالىق — سۆزنى بېسىڭ`}
            </span>
          )}
        </p>

        {spellOpen && spell.status === "loading" && (
          <p className="mt-1 text-[12px] text-ink3" data-testid="spell-status">
            لۇغەت يۈكلىنىۋاتىدۇ…
          </p>
        )}
        {spellOpen && spell.status === "failed" && (
          <p className="mt-1 text-[12px] text-ink3" data-testid="spell-status">
            لۇغەتنى يۈكلىگىلى بولمىدى — خاتىرە يېزىش داۋاملىشىدۇ.
          </p>
        )}
        {/* A browser without the Custom Highlight API cannot paint the
            underlines. Saying so is better than silently checking nothing. */}
        {spellOpen && spell.status === "ready" && !spell.canUnderline && (
          <p className="mt-1 text-[12px] text-ink3" data-testid="spell-unsupported">
            بۇ توركۆرگۈدە ئاستى سىزىق كۆرسىتىلمەيدۇ — كۆرگۈڭىزنى يېڭىلاڭ.
          </p>
        )}
      </main>

      <SourcePanel
        open={sourceOpen}
        initialQuery={selectionText}
        onClose={() => setSourceOpen(false)}
        onInsert={insertAtCaret}
      />

      {aiAvailable && (
        <NotesAiPanel
          open={aiOpen}
          openToken={aiToken}
          onClose={() => setAiOpen(false)}
          editorRef={editorRef}
          selectionText={aiScope.selection}
          noteText={aiScope.note}
          onRescope={captureAiScope}
          onInsert={insertText}
          onReplaceSelection={replaceSelectionWith}
          onDocumentChanged={afterPanelEdit}
        />
      )}

      {spell.popup && (
        <SpellPopup
          state={spell.popup}
          onPick={(replacement) => spell.applySuggestion(spell.popup!.mark, replacement)}
          onAdd={() => spell.addToPersonal(spell.popup!.mark.word)}
          onClose={spell.closePopup}
        />
      )}
    </div>
  );
}

function FormatButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="ibtn"
      title={label}
      aria-label={label}
      data-testid={testId ?? `format-${icon}`}
      // Keep the selection: a button taking focus would collapse it before the
      // command runs, so formatting selected text by touch would do nothing.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} className="ic-lg" />
    </button>
  );
}
