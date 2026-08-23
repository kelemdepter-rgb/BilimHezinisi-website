import { createSupabaseServerClient } from "@/lib/supabase/server";
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

export async function listAuthors(options: { limit?: number; offset?: number } = {}): Promise<{
  authors: AuthorSummary[];
  total: number;
}> {
  const supabase = await createSupabaseServerClient();
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
}

export async function authorStats(): Promise<{ authors: number; unattributed: number }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { authors: 0, unattributed: 0 };
  const { data, error } = await supabase.rpc("author_stats");
  if (error || !data) return { authors: 0, unattributed: 0 };
  const row = (data as { authors: number; unattributed: number }[])[0];
  return {
    authors: Number(row?.authors) || 0,
    unattributed: Number(row?.unattributed) || 0,
  };
}

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
