import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BOOKS_TAG, CACHE_SECONDS, cachedClient } from "@/lib/cache";
import type { LibraryBook } from "@/lib/library-types";

/**
 * Browsing the shelf by who wrote it.
 *
 * The grouping happens in Postgres (migration 0021), not here: pulling every
 * book into a route handler to group it in JavaScript would read the whole
 * table on every visit, which is precisely what the free tier's egress cannot
 * afford. What comes back is one page of authors and a total.
 *
 * Every function here fails soft. The migration is applied by hand in the
 * Supabase SQL Editor, so there is a window where this code is deployed and
 * the function it calls does not exist yet; an empty author list is a far
 * better answer during that window than a broken page.
 */

export type AuthorSummary = {
  /** ug_normalize(author) — the grouping key, and the URL segment. */
  key: string;
  /** A real spelling from the shelf, for showing to a reader. */
  name: string;
  bookCount: number;
};

export const AUTHORS_PAGE_SIZE = 30;
export const AUTHOR_BOOKS_PAGE_SIZE = 24;

type AuthorRow = {
  author_key: string;
  author: string;
  book_count: number;
  total_authors: number;
};

/**
 * The author index is built out of the published books, so it is the same for
 * every visitor and changes only when a book does — which is exactly what
 * BOOKS_TAG is dropped for.
 */
export const listAuthors = unstable_cache(
  async (options: { limit?: number; offset?: number } = {}): Promise<{
    authors: AuthorSummary[];
    total: number;
  }> => {
    const supabase = cachedClient();
    if (!supabase) return { authors: [], total: 0 };

    const limit = Math.min(Math.max(1, Math.floor(options.limit ?? AUTHORS_PAGE_SIZE)), 100);
    const offset = Math.max(0, Math.floor(options.offset ?? 0));

    const { data, error } = await supabase.rpc("list_authors", { lim: limit, off: offset });
    if (error || !data) return { authors: [], total: 0 };

    const rows = data as AuthorRow[];
    return {
      authors: rows.map((row) => ({
        key: row.author_key,
        name: row.author,
        bookCount: Number(row.book_count) || 0,
      })),
      total: Number(rows[0]?.total_authors) || 0,
    };
  },
  ["authors-list"],
  { tags: [BOOKS_TAG], revalidate: CACHE_SECONDS },
);

export const authorStats = unstable_cache(
  async (): Promise<{ authors: number; unattributed: number }> => {
    const supabase = cachedClient();
    if (!supabase) return { authors: 0, unattributed: 0 };
    const { data, error } = await supabase.rpc("author_stats");
    if (error || !data) return { authors: 0, unattributed: 0 };
    const row = (data as { authors: number; unattributed: number }[])[0];
    return {
      authors: Number(row?.authors) || 0,
      unattributed: Number(row?.unattributed) || 0,
    };
  },
  ["author-stats"],
  { tags: [BOOKS_TAG], revalidate: CACHE_SECONDS },
);

/**
 * Does this author exist at all?
 *
 * Its own question, and a cheap one — a counted head request, no rows. The
 * segment layout asks it before the page renders, because a guessed URL has
 * to come back as a 404 and not as a 200 carrying an empty shelf, and a
 * layout is the last place in a route that can still set the status: once
 * loading.tsx has flushed the shell, the status line has already gone.
 *
 * cache() keyed on the string, so asking twice in one request costs one query.
 */
export const authorHasBooks = cache(async (key: string): Promise<boolean> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase || !key) return false;
  const { count } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .eq("author_key", key);
  return (count ?? 0) > 0;
});

/**
 * One author's published books.
 *
 * A plain indexed lookup on books.author_key — no RPC needed, because the
 * generated column lets PostgREST filter on the normalized name directly.
 */
export async function booksByAuthor(
  key: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ books: LibraryBook[]; total: number; name: string }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase || !key) return { books: [], total: 0, name: "" };

  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? AUTHOR_BOOKS_PAGE_SIZE)), 50);
  const offset = Math.min(Math.max(0, Math.floor(options.offset ?? 0)), 5000);

  const { data, count, error } = await supabase
    .from("books")
    .select("id, title, author, category_id, page_count, date, cover_path, status", {
      count: "exact",
    })
    .eq("status", "published")
    .eq("author_key", key)
    .order("title", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return { books: [], total: 0, name: "" };
  const books = (data as LibraryBook[] | null) ?? [];
  // The spelling on the books themselves, so the page shows the name as it is
  // actually written rather than the lower-cased normalized key.
  return { books, total: count ?? 0, name: books[0]?.author?.trim() ?? "" };
}
