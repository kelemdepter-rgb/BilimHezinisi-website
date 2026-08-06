import Link from "next/link";
import { Icon } from "@/components/icons";
import type { LibraryBook } from "@/lib/library-types";

/**
 * Manuscript-style placeholder used when a book has no cover — a paper panel
 * carrying the title and author, so the grid never shows a broken image.
 */
function PlaceholderCover({ title, author }: { title: string; author: string }) {
  return (
    <div className="grain flex h-full w-full flex-col items-center justify-center gap-2 bg-paper p-3 text-center">
      <Icon name="book" className="ic-lg text-am" />
      <span className="line-clamp-3 text-[12.5px] font-bold leading-5 text-ink">{title}</span>
      {author && <span className="line-clamp-1 text-[11px] text-ink3">{author}</span>}
    </div>
  );
}

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
          <span className="h-20 w-14 shrink-0 overflow-hidden rounded-[var(--radius2)] border border-bd">
            {coverUrl ? (
              // Covers live in Supabase Storage; next/image would need remote config.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <PlaceholderCover title={book.title} author={book.author} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-bold text-ink">{book.title}</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-ink3">
              {book.author || "ئاپتور كۆرسىتىلمىگەن"}
            </span>
            {meta && <span className="mt-0.5 block truncate text-[12px] text-ink3">{meta}</span>}
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
        <span className="block aspect-[3/4] w-full overflow-hidden border-b border-bd">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <PlaceholderCover title={book.title} author={book.author} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col p-3">
          <span className="line-clamp-2 text-[13.5px] font-bold leading-6 text-ink">{book.title}</span>
          <span className="mt-1 truncate text-[12px] text-ink3">
            {book.author || "ئاپتور كۆرسىتىلمىگەن"}
          </span>
          {meta && <span className="mt-auto pt-2 truncate text-[11.5px] text-ink3">{meta}</span>}
        </span>
      </Link>
    </li>
  );
}
