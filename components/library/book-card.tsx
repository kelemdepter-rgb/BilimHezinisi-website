import Link from "next/link";
import { Icon } from "@/components/icons";
import { BookCover } from "@/components/library/book-cover";
import type { LibraryBook } from "@/lib/library-types";

export function BookCard({
  book,
  coverUrl,
  categoryName,
  view,
}: {
  book: LibraryBook;
  coverUrl: string | null;
  categoryName: string | null;
  view: "grid" | "list";
}) {
  const meta = [categoryName, book.page_count ? `${book.page_count} بەت` : null, book.date]
    .filter(Boolean)
    .join(" · ");

  if (view === "list") {
    return (
      <li>
        <Link
          href={`/books/${book.id}`}
          data-testid="book-card"
          className="paper flex items-center gap-3 p-2.5 hover:shadow-[var(--shadow-2)]"
        >
          <span className="relative h-20 w-14 shrink-0 overflow-hidden rounded-[var(--radius2)] border border-bd">
            <BookCover coverUrl={coverUrl} title={book.title} author={book.author} sizes="56px" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-bold text-ink">{book.title}</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-ink2">
              {book.author || "ئاپتور كۆرسىتىلمىگەن"}
            </span>
            {meta && <span className="mt-0.5 block truncate text-[12px] text-ink2">{meta}</span>}
          </span>
          <Icon name="book-open" className="shrink-0 text-am" />
        </Link>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={`/books/${book.id}`}
        data-testid="book-card"
        className="paper grain flex h-full flex-col overflow-hidden hover:shadow-[var(--shadow-2)]"
      >
        <span className="relative block aspect-[3/4] w-full overflow-hidden border-b border-bd">
          <BookCover
            coverUrl={coverUrl}
            title={book.title}
            author={book.author}
            sizes="(min-width: 1280px) 200px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col p-3">
          <span className="line-clamp-2 text-[13.5px] font-bold leading-6 text-ink">{book.title}</span>
          <span className="mt-1 truncate text-[12px] text-ink2">
            {book.author || "ئاپتور كۆرسىتىلمىگەن"}
          </span>
          {meta && <span className="mt-auto pt-2 truncate text-[12px] text-ink2">{meta}</span>}
        </span>
      </Link>
    </li>
  );
}
