import { BookStrip } from "@/components/library/book-strip";
import type { LibraryBook } from "@/lib/library-types";

/** Signed-in only — the caller passes an empty list for anonymous visitors. */
export function RecentStrip({
  books,
  covers,
}: {
  books: LibraryBook[];
  covers: Map<string, string>;
}) {
  return (
    <BookStrip
      testId="recent-strip"
      heading="ئاخىرقى ئوقۇغانلىرىم"
      icon="clock"
      books={books}
      covers={covers}
      // Straight back into the book, at the page they left.
      hrefFor={(book) => `/books/${book.id}/read`}
    />
  );
}
