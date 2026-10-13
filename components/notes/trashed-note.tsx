"use client";

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { restoreNoteAction } from "@/app/notes/actions";
import { IN_TRASH } from "@/lib/notes/list-protocol";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import { NOTE_FONT_STACKS } from "@/lib/notes/typography";
import {
  getTypographyServerSnapshot,
  getTypographySnapshot,
  subscribeTypography,
} from "@/lib/notes/typography-store";
import type { NoteDocument } from "@/lib/notes/data";

/**
 * A note opened while it is in the trash (PROMPT-47): read, never written.
 *
 * No save loop is made for it, so nothing is ever sent into the trash — and a
 * copy of unsaved writing this device may hold for the note is left exactly
 * where it is. «قايتۇرۇش» takes the note out of the trash; the action's own
 * response draws this page again, and it opens in the editor, which finds
 * that copy as it always does.
 */
export function TrashedNoteView({ note }: { note: NoteDocument }) {
  const typography = useSyncExternalStore(subscribeTypography, getTypographySnapshot, getTypographyServerSnapshot);
  const [restoring, startRestore] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Filled once, by hand, like the editor: the same sanitizer as on screen
  // anywhere else, and never a React child the text could be re-rendered into.
  const fill = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.innerHTML = sanitizeNoteHtml(note.content_html);
    },
    [note.content_html],
  );

  function restore() {
    setError(null);
    startRestore(async () => {
      const result = await restoreNoteAction(note.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        data-testid="note-toolbar"
        className="grain safe-top safe-x sticky top-0 z-30 border-b border-bd bg-bg2/95 backdrop-blur print:hidden"
      >
        <div className="mx-auto flex w-full max-w-4xl items-center gap-1 px-2 py-1.5 sm:px-4">
          <Link href="/notes/trash" className="ibtn" aria-label="ئەخلەت ساندۇقى" data-testid="notes-back">
            <Icon name="arrow-right" className="ic-lg" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate px-1.5 text-[15px] font-bold text-ink" data-testid="note-title">
            {note.title}
          </h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-3 sm:px-5">
        <div role="status" className="mt-3 rounded-[var(--radius)] bg-ab2 px-3.5 py-2.5 text-[13px] leading-6" data-testid="note-in-trash">
          <p>{IN_TRASH}</p>
          <button
            type="button"
            className="btn-am mt-2"
            data-testid="note-restore"
            disabled={restoring}
            onClick={restore}
          >
            <Icon name="undo" />
            قايتۇرۇش
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-[var(--radius)] bg-ab2 px-3.5 py-2.5 text-[13px]" data-testid="note-notice">
            {error}
          </p>
        )}
      </div>

      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-4 sm:px-5">
        <div
          ref={fill}
          contentEditable={false}
          dir="rtl"
          role="textbox"
          aria-readonly="true"
          aria-multiline="true"
          aria-label="خاتىرە مەزمۇنى"
          data-testid="note-body"
          style={{
            fontFamily: NOTE_FONT_STACKS[typography.font],
            fontSize: `${typography.fontSize}px`,
            lineHeight: typography.lineHeight,
          }}
          className="md-body paper min-h-[60dvh] w-full px-4 py-5 outline-none sm:px-6"
        />
      </main>
    </div>
  );
}
