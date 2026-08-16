"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { createNoteAction, deleteNoteAction } from "@/app/notes/actions";
import type { NoteSummary } from "@/lib/notes/data";

export function NoteList({ notes }: { notes: NoteSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create() {
    startTransition(async () => {
      const result = await createNoteAction();
      if (result.ok && result.id) router.push(`/notes/${result.id}`);
      else setError(result.ok ? null : result.error);
    });
  }

  function remove(id: number, title: string) {
    if (!window.confirm(`«${title}» ئۆچۈرۈلسۇنمۇ؟ بۇنى قايتۇرغىلى بولمايدۇ.`)) return;
    const formData = new FormData();
    formData.set("id", String(id));
    startTransition(async () => {
      const result = await deleteNoteAction(formData);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-am" data-testid="new-note" disabled={pending} onClick={create}>
          <Icon name="plus" />
          يېڭى خاتىرە
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-[var(--radius)] bg-ab2 px-3.5 py-3 text-[13px]">
          {error}
        </p>
      )}

      {notes.length === 0 ? (
        <p className="paper mt-5 p-6 text-center text-[13.5px] leading-7 text-ink2" data-testid="notes-empty">
          تېخى خاتىرە يوق. «يېڭى خاتىرە» نى بېسىپ يېزىشنى باشلاڭ — خاتىرىلىرىڭىزنى
          پەقەت سىزلا كۆرەلەيسىز.
        </p>
      ) : (
        <ul className="mt-4 space-y-2" data-testid="note-list">
          {notes.map((note) => (
            <li key={note.id} className="paper flex items-center gap-2 p-3.5">
              <Link href={`/notes/${note.id}`} className="min-w-0 flex-1" data-testid="note-link">
                <span className="block truncate text-[15px] font-bold text-ink">{note.title}</span>
                <span className="mt-0.5 block text-[12px] text-ink3">
                  {String(note.updated_at).slice(0, 10)} · {note.length.toLocaleString("en-US")} ھەرپ
                </span>
              </Link>
              <button
                type="button"
                className="ibtn shrink-0"
                aria-label={`${note.title} — ئۆچۈرۈش`}
                data-testid="delete-note"
                disabled={pending}
                onClick={() => remove(note.id, note.title)}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
