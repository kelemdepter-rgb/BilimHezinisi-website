"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { deleteNoteForeverAction, emptyTrashAction, restoreNoteAction } from "@/app/notes/actions";
import { TRASH_EMPTY, trashCountdown, trashDaysLeft } from "@/lib/notes/list-protocol";
import type { TrashedNote } from "@/lib/notes/data";

/** What is about to be deleted for good, while the writer is asked to confirm. */
type Asking = number | "all" | null;

/**
 * The trash (PROMPT-47): every note here can be put back until its 30 days
 * are over. Deleting for good — one note or all of them — always takes two
 * taps, the second in a box that says it cannot be undone; never a browser
 * dialog.
 *
 * The notes are the server's, as on the list: what was just put back or
 * deleted leaves at once (useOptimistic), and the action's own response
 * brings the trash as the server now has it.
 */
export function TrashList({ notes, now }: { notes: TrashedNote[]; now: number }) {
  const [shown, remove] = useOptimistic(notes, (current, gone: number | "all") =>
    gone === "all" ? [] : current.filter((note) => note.id !== gone),
  );
  const [busy, startChange] = useTransition();
  const [asking, setAsking] = useState<Asking>(null);
  const [error, setError] = useState<string | null>(null);
  /** The note last put back, to open from here. */
  const [restored, setRestored] = useState<{ id: number; title: string } | null>(null);

  function restore(note: TrashedNote) {
    setError(null);
    setAsking(null);
    startChange(async () => {
      remove(note.id);
      const result = await restoreNoteAction(note.id);
      if (result.ok) setRestored({ id: note.id, title: note.title });
      else setError(result.error);
    });
  }

  function deleteForever(note: TrashedNote) {
    setError(null);
    setAsking(null);
    setRestored(null);
    startChange(async () => {
      remove(note.id);
      const result = await deleteNoteForeverAction(note.id);
      if (!result.ok) setError(result.error);
    });
  }

  function emptyTrash() {
    setError(null);
    setAsking(null);
    setRestored(null);
    startChange(async () => {
      remove("all");
      const result = await emptyTrashAction();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error && (
        <p role="alert" className="mt-3 rounded-[var(--radius)] bg-ab2 px-3.5 py-3 text-[13px]" data-testid="trash-error">
          {error}
        </p>
      )}
      {restored && (
        <p role="status" className="mt-3 rounded-[var(--radius)] bg-ab px-3.5 py-2.5 text-[13px] leading-6" data-testid="trash-restored">
          <Link href={`/notes/${restored.id}`} className="inline-flex min-h-11 items-center font-semibold text-am underline">
            «{restored.title}»
          </Link>{" "}
          خاتىرە دەپتىرىگە قايتۇرۇلدى.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="paper mt-5 p-6 text-center text-[13.5px] leading-7 text-ink2" data-testid="trash-empty">
          {TRASH_EMPTY}
        </p>
      ) : (
        <>
          <div className="mt-4">
            {asking === "all" ? (
              <ConfirmBox
                testId="trash-empty-confirm-box"
                text="ئەخلەت ساندۇقىدىكى ھەممە خاتىرە مەڭگۈلۈك ئۆچىدۇ. بۇنى قايتۇرغىلى بولمايدۇ."
                confirm="ھەئە، ھەممىسىنى ئۆچۈرۈش"
                confirmTestId="trash-empty-confirm"
                busy={busy}
                onConfirm={emptyTrash}
                onCancel={() => setAsking(null)}
              />
            ) : (
              <button
                type="button"
                className="hbtn"
                data-testid="trash-empty-all"
                disabled={busy}
                onClick={() => {
                  setRestored(null);
                  setAsking("all");
                }}
              >
                <Icon name="trash" />
                ئەخلەت ساندۇقىنى بوشىتىش
              </button>
            )}
          </div>

          <ul className="mt-4 space-y-2" data-testid="trash-list">
            {shown.map((note) => (
              <li key={note.id} className="paper p-3 sm:p-3.5" data-testid="trash-row" data-note-id={note.id}>
                <Link href={`/notes/${note.id}`} className="block min-w-0" data-testid="trash-link-note">
                  <span className="block truncate text-[15px] font-bold text-ink">{note.title}</span>
                  {note.preview && (
                    <span className="mt-0.5 line-clamp-2 text-[13px] leading-6 text-ink2">{note.preview}</span>
                  )}
                  <span className="mt-1 block text-[12px] text-ink3" data-testid="trash-countdown">
                    {trashCountdown(trashDaysLeft(note.deleted_at, now))}
                  </span>
                </Link>
                {asking === note.id ? (
                  <ConfirmBox
                    testId="trash-delete-confirm-box"
                    text="بۇ خاتىرە مەڭگۈلۈك ئۆچىدۇ. بۇنى قايتۇرغىلى بولمايدۇ."
                    confirm="ھەئە، مەڭگۈلۈك ئۆچۈرۈش"
                    confirmTestId="trash-delete-confirm"
                    busy={busy}
                    onConfirm={() => deleteForever(note)}
                    onCancel={() => setAsking(null)}
                  />
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="hbtn"
                      data-testid="trash-restore"
                      aria-label={`${note.title} — قايتۇرۇش`}
                      onClick={() => restore(note)}
                    >
                      <Icon name="undo" />
                      قايتۇرۇش
                    </button>
                    <button
                      type="button"
                      className="hbtn"
                      data-testid="trash-delete"
                      aria-label={`${note.title} — مەڭگۈلۈك ئۆچۈرۈش`}
                      onClick={() => {
                        setRestored(null);
                        setAsking(note.id);
                      }}
                    >
                      <Icon name="trash" />
                      مەڭگۈلۈك ئۆچۈرۈش
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** The second step of deleting for good: what will happen, and the two ways out. */
function ConfirmBox({
  testId,
  text,
  confirm,
  confirmTestId,
  busy,
  onConfirm,
  onCancel,
}: {
  testId: string;
  text: string;
  confirm: string;
  confirmTestId: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="mt-2 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3"
      role="group"
      aria-label={text}
      data-testid={testId}
    >
      <p className="text-[13px] leading-7 text-ink">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-danger" data-testid={confirmTestId} disabled={busy} onClick={onConfirm}>
          <Icon name="trash" />
          {confirm}
        </button>
        {/* Focus starts on the way out, not on the button that destroys. */}
        <button type="button" className="hbtn" data-testid="trash-cancel" autoFocus onClick={onCancel}>
          بىكار قىلىش
        </button>
      </div>
    </div>
  );
}
