"use client";

import { useEffect, useRef, useState } from "react";
import { NotePanel } from "@/components/notes/note-panel";
import { outlineOf, sameOutline, type OutlineEntry } from "@/lib/notes/outline";

export const OUTLINE_TITLE = "مۇندەرىجە";
const OUTLINE_EMPTY = "بۇ خاتىرىدە ماۋزۇ يوق — «ماۋزۇ» نى تاللاپ قوشۇڭ.";
/** Typing in a heading redraws the list once it pauses, not on every key. */
const REREAD_MS = 300;

/**
 * «مۇندەرىجە» — the note's headings, a tap from each (PROMPT-49).
 *
 * The list is read from the note when the panel opens and again a moment
 * after every change to it (`revision`, which the editor bumps on each one),
 * so a heading written with the panel open on a wide screen appears in it.
 * Where a heading is, and what jumping to it does, is the editor's business
 * (`onJump`): it is handed the heading's position in the list.
 */
export function OutlinePanel({
  open,
  editorRef,
  revision,
  onJump,
  onClose,
}: {
  open: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
  revision: number;
  onJump: (index: number) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<OutlineEntry[] | null>(null);
  /** Read at once on opening, after a pause when the note changes. */
  const fresh = useRef(true);

  /** A fresh list on every open, adjusted during the render that notices. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setEntries(null);
  }

  useEffect(() => {
    if (!open) {
      fresh.current = true;
      return;
    }
    const timer = setTimeout(
      () => {
        fresh.current = false;
        const editor = editorRef.current;
        const next = editor ? outlineOf(editor) : [];
        setEntries((current) => (current && sameOutline(current, next) ? current : next));
      },
      fresh.current ? 0 : REREAD_MS,
    );
    return () => clearTimeout(timer);
  }, [open, revision, editorRef]);

  if (!open) return null;

  return (
    <NotePanel testId="outline" title={OUTLINE_TITLE} icon="list" onClose={onClose}>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        data-testid="outline-scroll"
      >
        {entries === null ? null : entries.length === 0 ? (
          <p className="py-3 text-[13px] leading-7 text-ink3" data-testid="outline-empty">
            {OUTLINE_EMPTY}
          </p>
        ) : (
          <ol className="space-y-1" data-testid="outline-list">
            {entries.map((entry, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center rounded-[var(--radius)] py-2 pe-3 text-start text-[13.5px] leading-6 text-ink hover:bg-bg3"
                  // Indented by level, from the note's highest heading.
                  style={{ paddingInlineStart: `${0.75 + entry.depth * 1.1}rem` }}
                  data-testid="outline-row"
                  data-level={entry.level}
                  onClick={() => onJump(index)}
                >
                  <span className={`line-clamp-2 [overflow-wrap:anywhere] ${entry.depth === 0 ? "font-semibold" : ""}`}>
                    {entry.text}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </NotePanel>
  );
}
