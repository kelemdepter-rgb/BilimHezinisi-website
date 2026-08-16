"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { saveNoteAction } from "@/app/notes/actions";
import { MAX_NOTE_CHARS } from "@/lib/notes/limits";
import { downloadDocx } from "@/lib/notes/export-docx";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import type { NoteDocument } from "@/lib/notes/data";
import { SpellPanel } from "@/components/notes/spell-panel";

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

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recount = useCallback(() => {
    const text = editorRef.current?.innerText ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    setCounts({ words, chars: text.length });
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
        the caret.
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
                  void downloadDocx(title, editorRef.current?.innerHTML ?? "").catch(() =>
                    setNotice("ھۆججەتنى چىقارغىلى بولمىدى."),
                  )
                }
              >
                <Icon name="download" />
                Word
              </button>
            </div>
          </div>
        )}
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
          className="md-body paper min-h-[60dvh] w-full px-4 py-5 text-[16px] leading-9 outline-none sm:px-6"
          onInput={() => {
            scheduleSave();
            recount();
          }}
          onPaste={onPaste}
        />

        <p className="mt-3 text-[12px] text-ink3" data-testid="note-counts">
          {counts.words} سۆز · {counts.chars.toLocaleString("en-US")} ھەرپ
        </p>
      </main>

      {spellOpen && (
        <SpellPanel
          getText={() => editorRef.current?.innerText ?? ""}
          onClose={() => setSpellOpen(false)}
        />
      )}
    </div>
  );
}

function FormatButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ibtn"
      title={label}
      aria-label={label}
      data-testid={`format-${icon}`}
      // Keep the selection: a button taking focus would collapse it before the
      // command runs, so formatting selected text by touch would do nothing.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} className="ic-lg" />
    </button>
  );
}
