"use server";

import { LIBRARY_PAGE_SIZE, coverUrlMap, listBooks, type BookSort, type LibraryBook } from "@/lib/library";

export type LoadMoreResult = {
  books: (LibraryBook & { coverUrl: string | null })[];
  hasMore: boolean;
};

/**
 * Fetch the next slice only — the already-rendered books stay untouched in
 * client state, so nothing above the fold is re-fetched or re-rendered.
 */
export async function loadMoreBooksAction(input: {
  offset: number;
  categoryId: number | null;
  sort: BookSort;
}): Promise<LoadMoreResult> {
  const { books, total } = await listBooks({
    categoryId: input.categoryId,
    sort: input.sort,
    limit: LIBRARY_PAGE_SIZE,
    offset: input.offset,
  });
  const covers = await coverUrlMap(books);
  return {
    books: books.map((book) => ({
      ...book,
      coverUrl: book.cover_path ? (covers.get(book.cover_path) ?? null) : null,
    })),
    hasMore: input.offset + books.length < total,
  };
}
