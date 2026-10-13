import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { TrashList } from "@/components/notes/trash-list";
import { openTrash } from "@/lib/notes/data";
import { NOTE_TRASH_DAYS } from "@/lib/notes/limits";

export const metadata: Metadata = {
  title: "ئەخلەت ساندۇقى",
  robots: { index: false, follow: false },
};

/**
 * The notebook's trash (PROMPT-47). The /notes layout already sends a visitor
 * with no session to sign in; openTrash answers null for one all the same,
 * and first deletes this writer's notes whose time in the trash is over.
 */
export default async function NotesTrashPage() {
  const trash = await openTrash();
  if (trash === null) redirect("/login");

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <Link
        href="/notes"
        className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-ink2 hover:text-ink"
        data-testid="trash-back"
      >
        <Icon name="arrow-right" />
        خاتىرە دەپتىرىم
      </Link>
      <h1 className="mt-1 flex items-center gap-2.5 text-xl font-bold">
        <Icon name="trash" className="ic-lg text-am" />
        ئەخلەت ساندۇقى
      </h1>
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        ئۆچۈرۈلگەن خاتىرە بۇ يەردە {NOTE_TRASH_DAYS} كۈن تۇرىدۇ، ئاندىن مەڭگۈلۈك ئۆچىدۇ. ئۇنىڭغىچە
        قايتۇرالايسىز. ئەخلەت ساندۇقىدىكى خاتىرىلەرمۇ خاتىرە دەپتىرىنىڭ سىغىمىغا ھېسابلىنىدۇ.
      </p>

      <TrashList notes={trash.notes} now={trash.now} />
    </div>
  );
}
