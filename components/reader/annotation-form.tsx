"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { KeyboardControl, type TextField } from "@/components/search/uyghur-keyboard";

/** What the reader is about to save, and where it was asked for. */
export type AnnotationDraft = {
  /** A fresh one each time the form opens, so it starts from its own text. */
  id: number;
  kind: "bookmark" | "note";
  /** The page the reader was on when they asked — the page it is saved on. */
  pageNo: number;
  /** «N-بەت» for a bookmark; the selected text, if any, for a note. */
  initial: string;
  /** Opened from the panel, which closes for it and comes back afterwards. */
  fromPanel: boolean;
};

/**
 * Naming a bookmark or writing a note, in a row of the reader's sticky
 * toolbar.
 *
 * It replaces `window.prompt`, which allowed one line — so a note could not be
 * a paragraph — looked like the browser rather than the reader, and behaved
 * differently in the installed app. WHERE IT SITS IS THE DESIGN, the same
 * answer as the find row above it and the notebook's find bar: at the TOP,
 * inside the toolbar. A phone's keyboard rises from the bottom, so a form
 * pinned there would sit under it; up here it stays in reach with the
 * keyboard open, and the page simply starts lower while it is open — nothing
 * is laid over the text being read.
 */
export function AnnotationForm({
  draft,
  busy,
  active,
  onSave,
  onCancel,
}: {
  draft: AnnotationDraft;
  /** The save is on its way: the buttons hold still, the text stays. */
  busy: boolean;
  /** Nothing is open over it — the panel opened on top takes Escape instead. */
  active: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(draft.initial);
  const fieldRef = useRef<TextField>(null);
  const bookmark = draft.kind === "bookmark";

  // Ready to type at once: a bookmark's suggested name is selected, so typing
  // replaces it; a note's quoted text keeps the caret after it.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    if (bookmark) field.select();
    else field.setSelectionRange(field.value.length, field.value.length);
  }, [bookmark]);

  // Escape is «بىكار قىلىش», wherever the focus went — while this is the
  // top layer. It goes no further: cancelling a note brings the panel back,
  // and the panel's own Escape listener would otherwise close it again on
  // the same key press.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onCancel]);

  const label = bookmark ? "خەتكۈچ ئىسمى" : "خاتىرە";

  return (
    <form
      className="border-t border-bd px-2 pb-2 pt-2 sm:px-4"
      data-testid="annotation-form"
      data-kind={draft.kind}
      aria-label={bookmark ? "يېڭى خەتكۈچ" : "يېڭى خاتىرە"}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSave(text);
      }}
    >
      <div className="mx-auto w-full max-w-4xl">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink2">
            {label} · {draft.pageNo}-بەت
          </span>
          {bookmark ? (
            <input
              ref={fieldRef as React.RefObject<HTMLInputElement>}
              autoComplete="off"
              className="field"
              data-testid="annotation-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <textarea
              ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
              className="field block max-h-[35dvh] min-h-24 resize-y overscroll-contain"
              data-testid="annotation-input"
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // Enter is a new line in a note; Ctrl/⌘+Enter saves it.
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (!busy) onSave(text);
                }
              }}
            />
          )}
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-am" data-testid="annotation-save" disabled={busy}>
            <Icon name="save" />
            ساقلاش
          </button>
          <button type="button" className="hbtn" data-testid="annotation-cancel" onClick={onCancel}>
            بىكار قىلىش
          </button>
          {/* Many phones here have no Uyghur keyboard at all — the find row
              offers the same one. */}
          <KeyboardControl inputRef={fieldRef} />
        </div>
      </div>
    </form>
  );
}
