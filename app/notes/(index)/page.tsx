import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { NoteList } from "@/components/notes/note-list";
import { listNotes } from "@/lib/notes/data";

export const metadata: Metadata = {
  title: "خاتىرە دەپتىرىم",
  robots: { index: false, follow: false },
};

export default async function NotesPage() {
  // listNotes returns null for a visitor with no session — notes are personal,
  // so there is nothing to show them, only somewhere to sign in.
  const notes = await listNotes();
  if (notes === null) redirect("/login");

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="notebook-pen" className="ic-lg text-am" />
        خاتىرە دەپتىرىم
      </h1>
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        شەخسىي خاتىرىلىرىڭىز — پەقەت سىز كۆرەلەيسىز. Word ھۆججىتى قىلىپ چىقىرالايسىز.
      </p>

      <NoteList notes={notes} />
    </div>
  );
}
