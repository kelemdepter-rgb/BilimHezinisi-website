import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { NoteList } from "@/components/notes/note-list";
import { NotesUsage } from "@/components/notes/notes-usage";
import { loadNotebook } from "@/lib/notes/data";
import { NOTE_QUOTA_MAX_NOTES } from "@/lib/notes/limits";
import { notebookUsage } from "@/lib/notes/usage";

export const metadata: Metadata = {
  title: "خاتىرە دەپتىرىم",
  robots: { index: false, follow: false },
};

export default async function NotesPage() {
  // loadNotebook returns null for a visitor with no session — notes are
  // personal, so there is nothing to show them, only somewhere to sign in.
  const notebook = await loadNotebook();
  if (notebook === null) redirect("/login");

  // From the rows already loaded: the usage line costs no request of its
  // own. The trash counts, as it does for the quota (migration 0031).
  const usage = notebookUsage([...notebook.notes, ...notebook.trash]);

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="notebook-pen" className="ic-lg text-am" />
        خاتىرە دەپتىرىم
      </h1>
      <NotesUsage usage={usage} />
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        شەخسىي خاتىرىلىرىڭىز — پەقەت سىز كۆرەلەيسىز. Word ھۆججىتى قىلىپ چىقىرالايسىز.
      </p>

      <NoteList
        notes={notebook.notes}
        trashCount={notebook.trash.length}
        countFull={usage.count >= NOTE_QUOTA_MAX_NOTES}
      />
    </div>
  );
}
