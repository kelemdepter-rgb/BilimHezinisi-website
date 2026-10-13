import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";
import { TrashedNoteView } from "@/components/notes/trashed-note";
import { getNote } from "@/lib/notes/data";
import { getSessionInfo } from "@/lib/data";

export const metadata: Metadata = {
  title: "خاتىرە",
  // Personal writing has no business in a search index.
  robots: { index: false, follow: false },
};

export default async function NotePage({ params }: PageProps<"/notes/[id]">) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId <= 0) notFound();

  // Two gates: the session check sends a visitor to sign in, and getNote
  // filters by owner on top of the table's RLS. Someone else's note is a 404,
  // not a "forbidden" — its existence is not theirs to learn.
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const note = await getNote(noteId);
  if (!note) notFound();

  // A note in the trash is read, never written: put back, it opens in the
  // editor (PROMPT-47).
  if (note.deleted_at) return <TrashedNoteView note={note} />;

  // Keyed by note: moving from one note to another is a new editor, never
  // the old one holding the previous note's text.
  return <NoteEditor key={note.id} note={note} />;
}
