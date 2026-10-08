"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { createNoteAction, loadNoteAction, type LoadNoteResult } from "@/app/notes/actions";
import { MAX_NOTE_CHARS } from "@/lib/notes/limits";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import {
  MAX_TITLE_CHARS,
  SAVE_LABEL,
  SAVE_MESSAGES,
  STORAGE_FULL_MESSAGE,
  normalizeTitle,
} from "@/lib/notes/save-protocol";
import type { SaveLoop, SaveSnapshot } from "@/lib/notes/save-loop";
import {
  forgetNoteSession,
  holdNoteOpen,
  openNoteSession,
  type NoteSession,
} from "@/components/notes/note-session";
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

/** Warn while there is still room to finish a thought. */
const WARN_AT = Math.round(MAX_NOTE_CHARS * 0.9);

/** Before the save loop exists — the server render, the first paint. */
const IDLE: SaveSnapshot = { state: "idle", code: null, serverUpdatedAt: null, storageFailed: false };
const subscribeNothing = () => () => {};
const idleSnapshot = () => IDLE;

/** Added to the writer's own version when both are kept after a conflict. */
const COPY_SUFFIX = " (بۇ ئۈسكۈنىدىكى نۇسخا)";
const RESTORED_NOTICE = "ئۇلىنىش ئۈزۈلگەندە ساقلانغان نۇسخا ئەسلىگە كەلتۈرۈلدى.";
const REMOTE_NEWER_NOTICE = "باشقا يەردە ئۆزگەرتىلگەن يېڭى نۇسخا ئېچىلدى.";
const CHOICE_FAILED =
  "ئۇلىنىش يوق — سەل تۇرۇپ قايتا سىناڭ. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.";
/** The frame every notice under the toolbar shares. */
const NOTICE = "mt-3 rounded-[var(--radius)] px-3.5 py-2.5 text-[13px] leading-6";

export function NoteEditor({ note }: { note: NoteDocument }) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(note.title);
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
   * Saving (PROMPT-43). lib/notes/save-loop.ts decides when the note is sent
   * and what the label says; this component lends it the text and tells it
   * what happened on the page. The loop is made when the editor's node
   * appears — in the browser, never during the server render — and it
   * outlives the editor: a save started on the way out still lands, and
   * coming back to the note joins it rather than racing it.
   */
  const [session, setSession] = useState<NoteSession | null>(null);
  const loopRef = useRef<SaveLoop | null>(null);
  const loop = session?.loop ?? null;
  /** The opening is settled: no other tab is asked about any more. */
  const [started, setStarted] = useState(false);
  /**
   * The title and the body take keystrokes only once the note is in the
   * editor and a loop is there to save them. Before that — a page still
   * hydrating on a slow phone — a letter in the title never reached a save,
   * and anything typed in the body was written over when the note arrived.
   */
  const ready = session !== null && started;
  const save = useSyncExternalStore(
    loop ? loop.subscribe : subscribeNothing,
    loop ? loop.getSnapshot : idleSnapshot,
    idleSnapshot,
  );
  /** The editor's node, kept after React lets go of it: leaving reads it once more. */
  const nodeRef = useRef<HTMLDivElement | null>(null);
  /** The title as typed, read at the moment of sending — never a stale copy (N4). */
  const titleRef = useRef(note.title);
  /** A conflict choice is on its way; the note holds still until it lands. */
  const [choosing, setChoosing] = useState(false);
  /** Where the writer's own version went when both were kept. */
  const [copy, setCopy] = useState<{ id: number; title: string } | null>(null);
  /** The loop's "changed elsewhere" call, always reaching this render's handler. */
  const onRemoteNewer = useRef<() => void>(() => {});
  /** The session's "put this copy on screen", likewise. */
  const showCopy = useRef<(content: { title: string; html: string }) => void>(() => {});

  /** Every edit, of the body or the title, by hand or by a panel. */
  const noteChanged = useCallback(() => {
    loopRef.current?.change();
  }, []);

  /**
   * The editor is uncontrolled on purpose: React must never re-render the
   * contentEditable while someone is typing in it, or the caret jumps. So the
   * content is written once, by hand, the moment the node exists — a ref
   * callback rather than an effect, because "fill this DOM node when it
   * appears" is exactly what a ref callback is for. What it is filled with —
   * the server's version, this device's unsaved copy, or a choice between
   * them — is lib/notes/opening.ts.
   */
  const seeded = useRef(false);
  const attachEditor = useCallback(
    (node: HTMLDivElement | null) => {
      editorRef.current = node;
      if (!node) return;
      nodeRef.current = node;
      if (seeded.current) return;
      seeded.current = true;

      const opened = openNoteSession(note);
      node.innerHTML = opened.content.html;
      titleRef.current = opened.content.title;
      setTitle(opened.content.title);
      loopRef.current = opened.loop;
      setSession(opened);
      setStarted(opened.settled);
      recount();
    },
    [note, recount],
  );

  useEffect(() => {
    if (!session) return;
    const current = session.loop;
    current.attach({
      read: () => ({ title: titleRef.current, html: nodeRef.current?.innerHTML ?? "" }),
      onRemoteNewer: () => onRemoteNewer.current(),
    });
    // While the editor is open, another tab can tell this one still has the
    // note — and leaves this tab's device copy to it.
    const releaseOpen = holdNoteOpen(session);
    void session
      .start((content) => showCopy.current(content))
      .then((restored) => {
        if (restored) setNotice(RESTORED_NOTICE);
        setStarted(true);
      });

    const onOnline = () => current.online();
    // A phone switching apps, a tab put in the background: the copy is
    // written and the save started now, while the page can still run.
    const onVisibility = () => current.visibility(document.visibilityState !== "hidden");
    const onPageHide = () => current.flush();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      releaseOpen();
      // Leaving inside the app — a link, the back button — where pagehide
      // never fires (N2).
      current.detach();
    };
  }, [session]);

  /**
   * The one way a whole document goes on screen: this device's copy once the
   * opening has settled, the server's version after a conflict or a change
   * made elsewhere — and, in stage 5, a version from this device's history.
   * The caller tells the save loop what the new text is.
   *
   * A direct, sanitized write of the node's HTML — never `selectAll` +
   * `insertHTML`, which merges the first block into whatever it lands in and
   * so corrupts a note that starts with a heading, a quote or a list.
   */
  const putDocument = useCallback(
    (next: { title: string; html: string }) => {
      const node = nodeRef.current;
      if (!node) return;
      node.innerHTML = sanitizeNoteHtml(next.html);
      titleRef.current = next.title;
      setTitle(next.title);
      savedRange.current = null;
      recount();
      markChanged();
      spell.scheduleCheck();
    },
    [markChanged, recount, spell],
  );

  /** A version the server already holds: the editor is clean afterwards. */
  const replaceDocument = useCallback(
    (next: { title: string; html: string; updatedAt: string }) => {
      putDocument(next);
      loopRef.current?.adopt(next.updatedAt);
    },
    [putDocument],
  );

  /** Changed elsewhere while this tab was away, and nothing here is unsaved. */
  async function showRemoteVersion() {
    const current = loopRef.current;
    if (!current) return;
    let server: LoadNoteResult;
    try {
      server = await loadNoteAction(note.id);
    } catch {
      return;
    }
    if (!server.ok) return;
    // Something was typed while it loaded: now there are two versions.
    if (current.hasUnsent()) {
      current.conflict(server.updatedAt);
      return;
    }
    replaceDocument(server);
    setNotice(REMOTE_NEWER_NOTICE);
  }

  useEffect(() => {
    onRemoteNewer.current = () => void showRemoteVersion();
    showCopy.current = putDocument;
  });

  /**
   * «ئىككى خاتىرە قىلىپ ساقلاش» — the recommended way out of a conflict: the
   * writer's version becomes a new note, and this one shows the server's.
   * Nothing is replaced until both requests have succeeded.
   */
  async function keepBoth() {
    const current = loopRef.current;
    if (!current || choosing) return;
    setChoosing(true);
    try {
      const server = await loadNoteAction(note.id);
      if (!server.ok) {
        if (server.code === "not_found" || server.code === "needs_account") current.block(server.code);
        else setNotice(CHOICE_FAILED);
        return;
      }
      const mine = current.content();
      const room = MAX_TITLE_CHARS - COPY_SUFFIX.length;
      const copyTitle = `${normalizeTitle(mine.title).slice(0, room)}${COPY_SUFFIX}`;
      const created = await createNoteAction({ title: copyTitle, html: mine.html });
      if (!created.ok) {
        setNotice(created.code === "failed" ? CHOICE_FAILED : created.error);
        return;
      }
      replaceDocument(server);
      setCopy({ id: created.id, title: copyTitle });
      setNotice(null);
    } catch {
      setNotice(CHOICE_FAILED);
    } finally {
      setChoosing(false);
    }
  }

  /** The note was deleted elsewhere: keep the writing as a new one. */
  async function saveAsNew() {
    const current = loopRef.current;
    if (!current || !session || choosing) return;
    setChoosing(true);
    try {
      const mine = current.content();
      const created = await createNoteAction({ title: mine.title, html: mine.html });
      if (!created.ok) {
        setNotice(created.code === "failed" ? CHOICE_FAILED : created.error);
        setChoosing(false);
        return;
      }
      current.abandon();
      forgetNoteSession(session);
      router.replace(`/notes/${created.id}`);
    } catch {
      setNotice(CHOICE_FAILED);
      setChoosing(false);
    }
  }

  /**
   * execCommand is deprecated and still the only thing every mobile browser
   * implements for rich text in a contentEditable. The desktop app uses it too.
   */
  function exec(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    noteChanged();
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
      noteChanged();
      recount();
      markChanged();
      spell.scheduleCheck();
    },
    [markChanged, recount, noteChanged, spell],
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
      noteChanged();
      recount();
      markChanged();
      spell.scheduleCheck();
    },
    [markChanged, recount, noteChanged, spell],
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
      noteChanged();
      recount();
      markChanged();
      spell.scheduleCheck();
    },
    [markChanged, recount, noteChanged, spell],
  );

  /**
   * The panel rewrote blocks itself (proofread apply, or its undo). The
   * document changed without an input event, so everything that normally
   * follows one has to be run by hand — including autosave, or a correction
   * would sit on screen and never reach the database.
   */
  const afterPanelEdit = useCallback(() => {
    noteChanged();
    recount();
    markChanged();
    spell.scheduleCheck();
  }, [markChanged, recount, noteChanged, spell]);

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
    noteChanged();
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
            // The server keeps 200 characters; the field stops at the same
            // place, so nothing typed is ever cut off without a sign (N21).
            maxLength={MAX_TITLE_CHARS}
            readOnly={!ready || choosing}
            aria-label="خاتىرە ماۋزۇسى"
            data-testid="note-title"
            onChange={(event) => {
              titleRef.current = event.target.value;
              setTitle(event.target.value);
              noteChanged();
            }}
          />
          {/* A long state wraps onto a second line rather than squeezing the
              title away on a 360 px phone. */}
          <span
            className="max-w-[45%] shrink-0 px-1 text-[12px] leading-4 text-ink3"
            data-testid="save-state"
            role="status"
          >
            {SAVE_LABEL[save.state]}
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
            noteChanged();
            recount();
            markChanged();
            spell.scheduleCheck();
          }}
        />
      </header>

      {/*
        The notice area: in the page's flow under the toolbar, never fixed, so
        nothing here can cover the text — and the title row above it has no
        room for a button on a 360 px phone.
      */}
      <div className="mx-auto w-full max-w-4xl px-3 sm:px-5" data-testid="note-notices">
        {save.storageFailed && (
          <p role="alert" className={`${NOTICE} bg-ab2`} data-testid="note-storage-warning">
            {STORAGE_FULL_MESSAGE}
          </p>
        )}

        {save.state === "conflict" && (
          <div role="alert" className={`${NOTICE} bg-ab2`} data-testid="note-conflict">
            <p>{SAVE_MESSAGES.conflict}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-am"
                data-testid="conflict-keep-both"
                disabled={choosing}
                onClick={() => void keepBoth()}
              >
                <Icon name="copy" />
                ئىككى خاتىرە قىلىپ ساقلاش
              </button>
              <button
                type="button"
                className="hbtn"
                data-testid="conflict-keep-mine"
                disabled={choosing}
                onClick={() => loopRef.current?.keepMine()}
              >
                مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا قويۇش
              </button>
            </div>
          </div>
        )}

        {save.state === "blocked" && save.code && (
          <div role="alert" className={`${NOTICE} bg-ab2`} data-testid="note-blocked">
            <p>{SAVE_MESSAGES[save.code]}</p>
            {save.code === "needs_account" && (
              <Link href="/login" className="hbtn mt-2" data-testid="note-login">
                <Icon name="log-in" />
                كىرىش
              </Link>
            )}
            {save.code === "not_found" && (
              <button
                type="button"
                className="btn-am mt-2"
                data-testid="note-save-as-new"
                disabled={choosing}
                onClick={() => void saveAsNew()}
              >
                <Icon name="save" />
                يېڭى خاتىرە قىلىپ ساقلاش
              </button>
            )}
          </div>
        )}

        {/* The label above says what happened; this is what to do about it. */}
        {(save.state === "offline" || save.state === "retrying") && (
          <div className="mt-3" data-testid="save-retry-row">
            <button
              type="button"
              className="hbtn"
              data-testid="save-retry"
              onClick={() => loopRef.current?.retryNow()}
            >
              <Icon name="refresh" />
              ھازىر قايتا سىناش
            </button>
          </div>
        )}

        {copy && (
          <div role="status" className={`${NOTICE} bg-ab`} data-testid="note-copy-notice">
            <p>
              سىزنىڭ نۇسخىڭىز يېڭى خاتىرە قىلىپ ساقلاندى. بۇ بەتتە باشقا يەردە ئۆزگەرتىلگەن
              نۇسخا ئېچىلدى.
            </p>
            <Link
              href={`/notes/${copy.id}`}
              className="inline-flex min-h-11 items-center font-semibold text-am underline"
              data-testid="note-copy-link"
            >
              {copy.title}
            </Link>
          </div>
        )}

        {notice && (
          <p role="status" className={`${NOTICE} bg-ab`} data-testid="note-notice">
            {notice}
          </p>
        )}

        {nearLimit && (
          <p role="alert" className={`${NOTICE} ${overLimit ? "bg-ab2 font-semibold" : "bg-ab"}`}>
            {overLimit
              ? `خاتىرە ${MAX_NOTE_CHARS.toLocaleString("en-US")} ھەرپتىن ئېشىپ كەتتى — ساقلانمايدۇ. ئىككىگە بۆلۈڭ.`
              : `خاتىرە ئۇزۇنلىقى چەككە يېقىنلاشتى (${counts.chars.toLocaleString("en-US")} / ${MAX_NOTE_CHARS.toLocaleString("en-US")}).`}
          </p>
        )}
      </div>

      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-4 sm:px-5">
        <div
          ref={attachEditor}
          // Held still until the note is in it, and while a conflict choice is
          // on its way, so nothing typed in either moment is written over.
          contentEditable={ready && !choosing}
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
            noteChanged();
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
