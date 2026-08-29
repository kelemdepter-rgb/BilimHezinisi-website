import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BOOKS_TAG, CACHE_SECONDS, cachedClient } from "@/lib/cache";
import { getCategories } from "@/lib/data";
import { getPublicUrl } from "@/lib/storage";
import {
  LIBRARY_PAGE_SIZE,
  categoryWithDescendants,
  type BookDetail,
  type BookSort,
  type LibraryBook,
} from "@/lib/library-types";

export {
  LIBRARY_PAGE_SIZE,
  categoryTrail,
  categoryWithDescendants,
  type BookDetail,
  type BookSort,
  type LibraryBook,
} from "@/lib/library-types";

const ORDER: Record<BookSort, { column: string; ascending: boolean }> = {
  new: { column: "created_at", ascending: false },
  title: { column: "title", ascending: true },
  author: { column: "author", ascending: true },
};

/**
 * listBooks is reachable from a Server Action, so its arguments arrive from
 * the network however the UI is written. A deep OFFSET makes Postgres walk
 * every row before it, so both ends are clamped here — the one place every
 * caller passes through.
 */
const MAX_OFFSET = 5000;

/**
 * One query for the page of books plus an exact count — no per-book follow-up
 * requests. Category names are resolved from the already-loaded tree.
 *
 * Cached, and safe to cache: the query filters on status itself and the client
 * carries no session, so what comes back is what an anonymous visitor may see
 * and nothing more. It is the same answer for everybody, which is what makes
 * it shareable.
 *
 * The category tree is resolved OUTSIDE the cached function and the resulting
 * ids are passed in. Two reasons: one cached read must not be nested inside
 * another, and the ids belong in the cache key — a category that gains a child
 * is a different question, and would otherwise keep the old answer.
 */
const loadBooks = unstable_cache(
  async (options: {
    categoryIds: number[] | null;
    sort: BookSort;
    limit: number;
    offset: number;
  }): Promise<{ books: LibraryBook[]; total: number }> => {
    const supabase = cachedClient();
    if (!supabase) return { books: [], total: 0 };
    const order = ORDER[options.sort] ?? ORDER.new;

    let request = supabase
      .from("books")
      .select("id, title, author, category_id, page_count, date, cover_path, status", {
        count: "exact",
      })
      .eq("status", "published")
      .order(order.column, { ascending: order.ascending })
      .order("id", { ascending: true })
      .range(options.offset, options.offset + options.limit - 1);

    if (options.categoryIds) request = request.in("category_id", options.categoryIds);

    const { data, count } = await request;
    return { books: (data as LibraryBook[] | null) ?? [], total: count ?? 0 };
  },
  ["books-list"],
  { tags: [BOOKS_TAG], revalidate: CACHE_SECONDS },
);

export async function listBooks(options: {
  categoryId?: number | null;
  sort?: BookSort;
  limit?: number;
  offset?: number;
}): Promise<{ books: LibraryBook[]; total: number }> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? LIBRARY_PAGE_SIZE)),
    LIBRARY_PAGE_SIZE,
  );
  const offset = Math.min(Math.max(0, Math.floor(options.offset ?? 0)), MAX_OFFSET);
  const categoryIds =
    options.categoryId != null
      ? categoryWithDescendants(await getCategories(), options.categoryId)
      : null;
  return loadBooks({ categoryIds, sort: options.sort ?? "new", limit, offset });
}

/**
 * Recently published books, newest first.
 *
 * "Recently published" is books.published_at (migration 0021) — the moment a
 * book became visible on this site — and not created_at, which for the books
 * imported from the desktop app is all the same afternoon and says nothing
 * about when a reader could first see them.
 *
 * Fails soft: the migration is pasted by hand into the SQL Editor, so there is
 * a window where this code is deployed and the column does not exist. During
 * it the home page simply shows no "new books" strip, which is a great deal
 * better than showing an error.
 */
export const listNewBooks = unstable_cache(
  async (options: { limit?: number; offset?: number } = {}): Promise<{
    books: LibraryBook[];
    total: number;
  }> => {
    const supabase = cachedClient();
    if (!supabase) return { books: [], total: 0 };

    const limit = Math.min(Math.max(1, Math.floor(options.limit ?? LIBRARY_PAGE_SIZE)), LIBRARY_PAGE_SIZE);
    const offset = Math.min(Math.max(0, Math.floor(options.offset ?? 0)), MAX_OFFSET);

    const { data, count, error } = await supabase
      .from("books")
      .select("id, title, author, category_id, page_count, date, cover_path, status", {
        count: "exact",
      })
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return { books: [], total: 0 };
    return { books: (data as LibraryBook[] | null) ?? [], total: count ?? 0 };
  },
  ["books-new"],
  { tags: [BOOKS_TAG], revalidate: CACHE_SECONDS },
);

/**
 * Book detail. Drafts resolve only for staff — RLS already enforces this, so
 * a reader simply gets nothing back.
 */
/**
 * Deduplicated per request but deliberately NOT put in the shared cache.
 *
 * A book page asks for this twice — once for the share card and title, once
 * for the page itself — and cache() collapses that into one query. The shared
 * cache is a different matter: a draft is visible here to staff, through their
 * own session and RLS, and a cache entry is handed to everybody. Nothing that
 * can differ by who is asking goes in there.
 */
export const getBookDetail = cache(async (bookId: number): Promise<BookDetail | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("books")
    .select(
      "id, title, author, category_id, page_count, date, cover_path, status, description, language, format, content_format, original_file_path, created_at",
    )
    .eq("id", bookId)
    .maybeSingle();
  return (data as BookDetail | null) ?? null;
});

export async function getReadingProgress(
  bookId: number,
): Promise<{ pageNo: number; offset: number } | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("reading_progress")
    .select("page_no, position")
    .eq("book_id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return { pageNo: Number(data.page_no) || 1, offset: Number(data.position) || 0 };
}

/** Recent reads for the signed-in user, newest first. Empty when anonymous. */
export async function getRecentReads(limit = 8): Promise<LibraryBook[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Single joined query — the book columns come back with the recent rows.
  const { data } = await supabase
    .from("recent_reads")
    .select(
      "book_id, read_at, books!inner(id, title, author, category_id, page_count, date, cover_path, status)",
    )
    .eq("user_id", user.id)
    .eq("books.status", "published")
    .order("read_at", { ascending: false })
    .limit(limit);

  type Row = { books: LibraryBook | LibraryBook[] | null };
  return ((data as Row[] | null) ?? [])
    .map((row) => (Array.isArray(row.books) ? row.books[0] : row.books))
    .filter((book): book is LibraryBook => Boolean(book));
}

/** Public URL for a cover object, or null when the book has none. */
export async function coverUrlFor(coverPath: string | null): Promise<string | null> {
  if (!coverPath) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  return getPublicUrl(supabase, "covers", coverPath);
}

/** Resolve many cover paths at once (one client, no extra round trips). */
export async function coverUrlMap(
  books: { cover_path: string | null }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return map;
  for (const book of books) {
    if (!book.cover_path || map.has(book.cover_path)) continue;
    map.set(book.cover_path, getPublicUrl(supabase, "covers", book.cover_path));
  }
  return map;
}
