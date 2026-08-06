import Link from "next/link";
import { Icon } from "@/components/icons";
import type { LibraryBook } from "@/lib/library";

/** Signed-in only — the caller passes an empty list for anonymous visitors. */
export function RecentStrip({
  books,
  covers,
}: {
  books: LibraryBook[];
  covers: Map<string, string>;
}) {
  if (books.length === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className="mb-6">
      <h2 id="recent-heading" className="mb-3 flex items-center gap-2 text-[15px] font-bold">
        <Icon name="clock" className="text-am" />
        ئاخىرقى ئوقۇغانلىرىم
      </h2>
      <ul className="-mx-3 flex gap-3 overflow-x-auto overscroll-x-contain px-3 pb-2" data-testid="recent-strip">
        {books.map((book) => {
          const coverUrl = book.cover_path ? covers.get(book.cover_path) : null;
          return (
            <li key={book.id} className="w-28 shrink-0">
              <Link href={`/books/${book.id}/read`} className="paper block overflow-hidden">
                <span className="block aspect-[3/4] w-full overflow-hidden border-b border-bd">
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="grain flex h-full w-full items-center justify-center bg-paper">
                      <Icon name="book" className="ic-lg text-am" />
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 p-2 text-[12px] font-semibold leading-5">
                  {book.title}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
