import { notFound, redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/data";
import { getNote } from "@/lib/notes/data";

/**
 * Is this note yours?
 *
 * The answer has to be a real 404 — a note nobody may open must not come back
 * as 200 with a not-found page inside it — and after loading.tsx flushes its
 * skeleton the status line has already been sent. So the question is asked in
 * front of the boundary, in the one place that still can.
 *
 * getSessionInfo and getNote are both deduplicated per request, so the page
 * asking again costs nothing. RLS is what actually enforces this; the check
 * here decides what the response says.
 */
export default async function NoteLayout({ children, params }: LayoutProps<"/notes/[id]">) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId <= 0) notFound();
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!(await getNote(noteId))) notFound();
  return children;
}
