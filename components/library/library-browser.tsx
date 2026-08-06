"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { BookCard } from "@/components/library/book-card";
import { loadMoreBooksAction } from "@/app/library-actions";
import {
  LIBRARY_PAGE_SIZE,
  VIEW_COOKIE,
  type BookSort,
  type LibraryBook,
} from "@/lib/library-types";
import type { Category } from "@/lib/types";

export type BrowserBook = LibraryBook & { coverUrl: string | null };

const SORTS: { value: BookSort; label: string }[] = [
  { value: "new", label: "ئەڭ يېڭى" },
  { value: "title", label: "ماۋزۇ بويىچە" },
  { value: "author", label: "ئاپتور بويىچە" },
];

export function LibraryBrowser({
  initialBooks,
  total,
  categories,
  categoryId,
  sort,
  initialView,
}: {
  initialBooks: BrowserBook[];
  total: number;
  categories: Category[];
  categoryId: number | null;
  sort: BookSort;
  initialView: "grid" | "list";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"grid" | "list">(initialView);
  const [books, setBooks] = useState<BrowserBook[]>(initialBooks);
  const [hasMore, setHasMore] = useState(initialBooks.length < total);
  const [pending, startTransition] = useTransition();

  // Server data changed (new filter/sort) — adopt it without a refetch.
  const [seenInitial, setSeenInitial] = useState(initialBooks);
  if (seenInitial !== initialBooks) {
    setSeenInitial(initialBooks);
    setBooks(initialBooks);
    setHasMore(initialBooks.length < total);
  }

  const categoryName = (id: number | null) =>
    categories.find((category) => category.id === id)?.name ?? null;

  function changeView(next: "grid" | "list") {
    setView(next);
    document.cookie = `${VIEW_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  function changeSort(next: BookSort) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "new") params.delete("sort");
    else params.set("sort", next);
    const query = params.toString();
    router.push(query ? `/?${query}` : "/");
  }

  function loadMore() {
    startTransition(async () => {
      const result = await loadMoreBooksAction({
        offset: books.length,
        categoryId,
        sort,
      });
      // Append only — existing cards keep their DOM nodes, so the scroll
      // position stays exactly where the reader left it.
      setBooks((previous) => [...previous, ...result.books]);
      setHasMore(result.hasMore);
    });
  }

  return (
    <section aria-label="كىتابلار">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="me-auto text-[13px] text-ink3" data-testid="library-count">
          {categoryId ? `${categoryName(categoryId) ?? "تۈر"}: ` : ""}
          {total} كىتاب
        </p>

        <label className="flex items-center gap-2">
          <span className="sr-only">تەرتىپلەش</span>
          <select
            className="field w-auto"
            data-testid="library-sort"
            value={sort}
            onChange={(event) => changeSort(event.target.value as BookSort)}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1" role="group" aria-label="كۆرۈنۈش شەكلى">
          <button
            type="button"
            className={view === "grid" ? "hbtn on" : "hbtn"}
            data-testid="view-grid"
            aria-pressed={view === "grid"}
            onClick={() => changeView("grid")}
          >
            <Icon name="grid" />
            <span className="sr-only sm:not-sr-only">كاتەكچە</span>
          </button>
          <button
            type="button"
            className={view === "list" ? "hbtn on" : "hbtn"}
            data-testid="view-list"
            aria-pressed={view === "list"}
            onClick={() => changeView("list")}
          >
            <Icon name="list" />
            <span className="sr-only sm:not-sr-only">تىزىم</span>
          </button>
        </div>
      </div>

      {books.length === 0 ? (
        <div className="paper grain p-8 text-center" data-testid="library-empty">
          <Icon name="book" className="ic-lg mx-auto text-am" />
          <h2 className="mt-3 text-[16px] font-bold">
            {categoryId ? "بۇ تۈردە تېخى كىتاب يوق" : "كۇتۇپخانا تېخى بوش"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-7 text-ink2">
            {categoryId
              ? "باشقا تۈرنى تاللاپ كۆرۈڭ ياكى «ھەممە كىتابلار» غا قايتىڭ."
              : "كىتابلار قوشۇلغاندىن كېيىن مۇشۇ يەردە كۆرۈنىدۇ."}
          </p>
        </div>
      ) : (
        <ul
          data-testid="book-list"
          data-view={view}
          className={
            view === "grid"
              ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              : "space-y-2"
          }
        >
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              coverUrl={book.coverUrl}
              categoryName={categoryName(book.category_id)}
              view={view}
            />
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-5 text-center">
          <button
            type="button"
            className="hbtn"
            data-testid="load-more"
            onClick={loadMore}
            disabled={pending}
          >
            {pending ? "يۈكلىنىۋاتىدۇ…" : `يەنە ${LIBRARY_PAGE_SIZE} كىتاب كۆرسىتىش`}
          </button>
        </div>
      )}
    </section>
  );
}
