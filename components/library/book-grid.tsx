import Link from "next/link";
import { Icon } from "@/components/icons";
import { BookCard } from "@/components/library/book-card";
import type { LibraryBook } from "@/lib/library-types";

export type GridBook = LibraryBook & { coverUrl: string | null };

/**
 * A page of books with links to the next and previous page.
 *
 * Server-rendered on purpose, unlike the home page's LibraryBrowser: those
 * pages have a filter, a sort and an endless "load more", none of which belong
 * on an author's shelf or on «يېڭى كىتابلار». What they share is BookCard —
 * one card component for the whole site, so a book looks the same wherever it
 * is met.
 */
export function BookGrid({
  books,
  total,
  page,
  pageSize,
  basePath,
  categoryName,
  emptyMessage,
}: {
  books: GridBook[];
  total: number;
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Where the pager links point; the page number is appended as ?p=. */
  basePath: string;
  categoryName: (id: number | null) => string | null;
  emptyMessage: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (books.length === 0) {
    return (
      <div className="paper grain p-8 text-center" data-testid="book-grid-empty">
        <Icon name="book" className="ic-lg mx-auto text-ink3" />
        <p className="mt-3 text-[13.5px] leading-7 text-ink2">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <ul
        data-testid="book-list"
        data-view="grid"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            coverUrl={book.coverUrl}
            categoryName={categoryName(book.category_id)}
            view="grid"
          />
        ))}
      </ul>

      {pages > 1 && (
        <nav
          aria-label="بەت تىزىملىكى"
          data-testid="pager"
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
        >
          {/* Links, not buttons: a pager that only works with JavaScript is a
              pager a crawler cannot follow, and this is a discovery page. */}
          {page > 1 ? (
            <Link href={pageHref(basePath, page - 1)} className="hbtn" data-testid="pager-prev">
              <Icon name="chevron-up" className="rotate-90" />
              ئالدىنقى
            </Link>
          ) : (
            <span className="hbtn opacity-40" aria-disabled="true">
              ئالدىنقى
            </span>
          )}
          <span className="text-[12.5px] text-ink3" data-testid="pager-position" dir="ltr">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(basePath, page + 1)} className="hbtn" data-testid="pager-next">
              كېيىنكى
              <Icon name="chevron-down" className="rotate-90" />
            </Link>
          ) : (
            <span className="hbtn opacity-40" aria-disabled="true">
              كېيىنكى
            </span>
          )}
        </nav>
      )}
    </>
  );
}

export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}${basePath.includes("?") ? "&" : "?"}p=${page}`;
}

/** ?p= as a 1-based page number, tolerating anything a URL can carry. */
export function parsePageParam(value: unknown): number {
  const page = Number(typeof value === "string" ? value : 1);
  return Number.isFinite(page) && page > 1 ? Math.min(Math.floor(page), 2000) : 1;
}
