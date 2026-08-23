import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { BookCover } from "@/components/library/book-cover";
import type { LibraryBook } from "@/lib/library-types";

/**
 * A short, sideways shelf of covers.
 *
 * Deliberately one row that scrolls sideways rather than a grid: on a 375 px
 * phone a grid of new books would push the library's own controls off the
 * screen, and the point of the home page is the library, not the strip.
 */
export function BookStrip({
  heading,
  icon,
  books,
  covers,
  hrefFor,
  moreHref,
  moreLabel,
  testId,
}: {
  heading: string;
  icon: IconName;
  books: LibraryBook[];
  covers: Map<string, string>;
  hrefFor: (book: LibraryBook) => string;
  moreHref?: string;
  moreLabel?: string;
  testId: string;
}) {
  if (books.length === 0) return null;
  const headingId = `${testId}-heading`;

  return (
    <section aria-labelledby={headingId} className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name={icon} className="text-am" />
          {heading}
        </h2>
        {moreHref && (
          <Link
            href={moreHref}
            data-testid={`${testId}-more`}
            className="ms-auto text-[12.5px] font-semibold text-am hover:underline"
          >
            {moreLabel ?? "ھەممىسى"}
          </Link>
        )}
      </div>
      <ul
        className="-mx-3 flex gap-3 overflow-x-auto overscroll-x-contain px-3 pb-2"
        data-testid={testId}
      >
        {books.map((book) => {
          const coverUrl = book.cover_path ? covers.get(book.cover_path) : null;
          return (
            <li key={book.id} className="w-28 shrink-0">
              <Link href={hrefFor(book)} className="paper block overflow-hidden">
                <span className="relative block aspect-[3/4] w-full overflow-hidden border-b border-bd">
                  <BookCover coverUrl={coverUrl ?? null} title={book.title} sizes="112px" />
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
