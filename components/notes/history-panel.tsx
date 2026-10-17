"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { NotePanel } from "@/components/notes/note-panel";
import { noteHistory, type NoteVersion } from "@/lib/notes/history";
import {
  HISTORY_DEVICE_ONLY,
  HISTORY_EMPTY,
  HISTORY_TITLE,
  HISTORY_UNAVAILABLE,
  REASON_LABEL,
  versionAge,
  versionLength,
  versionTime,
} from "@/lib/notes/history-labels";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import { NOTE_FONT_STACKS, type NoteTypography } from "@/lib/notes/typography";

type Listing =
  | { state: "loading" }
  | { state: "ready"; versions: NoteVersion[]; now: number }
  | { state: "unavailable" };

/**
 * «ئىلگىرىكى نۇسخىلار» — the versions of this note kept on this device
 * (lib/notes/history.ts), newest first, each one a tap from a read-only
 * preview and from being put back.
 *
 * A sheet from the bottom on a phone and a side panel from 1024 px up
 * (components/notes/note-panel.tsx): on a phone it covers the page, so the
 * page behind is held still and the list scrolls inside the sheet; on a wide
 * screen the note stays scrollable beside it. Putting a version back is the
 * editor's business (`onRestore`): it keeps the note as it is first, then
 * writes the version through its one whole-document helper and saves it like
 * any edit.
 */
export function HistoryPanel({
  open,
  userId,
  noteId,
  typography,
  canRestore,
  onRestore,
  onClose,
}: {
  open: boolean;
  userId: string;
  noteId: number;
  typography: NoteTypography;
  /** False while the note is still opening, or a conflict choice is on its way. */
  canRestore: boolean;
  onRestore: (version: NoteVersion) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  /** The version being previewed, if any. */
  const [chosen, setChosen] = useState<NoteVersion | null>(null);

  /** A fresh list on every open, adjusted during the render that notices. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setListing({ state: "loading" });
      setChosen(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void noteHistory.list(userId, noteId).then((result) => {
      if (!alive) return;
      setListing(
        result.ok ? { state: "ready", versions: result.versions, now: Date.now() } : { state: "unavailable" },
      );
    });
    return () => {
      alive = false;
    };
  }, [open, userId, noteId]);

  const previewHtml = useMemo(() => (chosen ? sanitizeNoteHtml(chosen.html) : ""), [chosen]);

  if (!open) return null;

  const now = listing.state === "ready" ? listing.now : 0;

  return (
    <NotePanel testId="history" title={HISTORY_TITLE} icon="clock" onClose={onClose}>
      <p
        className="shrink-0 border-b border-bd bg-ab px-3 py-2 text-[12.5px] leading-6 text-ink2"
        data-testid="history-device-only"
      >
        {HISTORY_DEVICE_ONLY}
      </p>

      {/* Outside the scrolling part, so they stay in reach however long the preview is. */}
      {chosen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-bd px-3 py-2">
          <button
            type="button"
            className="btn-am"
            data-testid="history-restore"
            disabled={!canRestore}
            onClick={() => onRestore(chosen)}
          >
            <Icon name="undo" />
            بۇ نۇسخىغا قايتۇرۇش
          </button>
          <button type="button" className="hbtn" data-testid="history-back" onClick={() => setChosen(null)}>
            <Icon name="arrow-right" />
            قايتىش
          </button>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        data-testid="history-scroll"
      >
        {chosen ? (
          <article data-testid="history-preview-card">
            <h3 className="text-[15px] font-bold leading-7 text-ink">{chosen.title}</h3>
            <p className="mt-0.5 text-[12px] text-ink3">
              {versionTime(chosen.at, now)} · {REASON_LABEL[chosen.reason]} · {versionLength(chosen.chars)}
            </p>
            <div
              className="md-body paper mt-3 px-4 py-4"
              dir="rtl"
              data-testid="history-preview"
              style={{
                fontFamily: NOTE_FONT_STACKS[typography.font],
                fontSize: `${typography.fontSize}px`,
                lineHeight: typography.lineHeight,
              }}
              // Through the notebook's own sanitizer, like everything else a
              // note puts on screen.
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </article>
        ) : listing.state === "loading" ? (
          <p className="py-3 text-center text-[12.5px] text-ink3" data-testid="history-loading">
            يۈكلىنىۋاتىدۇ…
          </p>
        ) : listing.state === "unavailable" ? (
          <p
            role="status"
            className="rounded-[var(--radius)] border border-bd2 bg-ab2 px-3 py-2.5 text-[13px] leading-7"
            data-testid="history-unavailable"
          >
            {HISTORY_UNAVAILABLE}
          </p>
        ) : listing.versions.length === 0 ? (
          <p className="py-3 text-[13px] leading-7 text-ink3" data-testid="history-empty">
            {HISTORY_EMPTY}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="history-list">
            {listing.versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-[var(--radius)] border border-bd bg-bg2 px-3 py-2 text-start hover:bg-bg3"
                  data-testid="history-row"
                  data-reason={version.reason}
                  onClick={() => setChosen(version)}
                >
                  <span className="flex w-full flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[13.5px] font-semibold text-ink">{versionTime(version.at, now)}</span>
                    <span className="text-[12px] text-ink3">{versionAge(version.at, now)}</span>
                  </span>
                  <span className="text-[12.5px] text-ink2" data-testid="history-row-reason">
                    {REASON_LABEL[version.reason]} · {versionLength(version.chars)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NotePanel>
  );
}
