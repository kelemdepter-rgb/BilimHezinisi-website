import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/data";
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
 * One query for the page of books plus an exact count — no per-book follow-up
 * requests. Category names are resolved from the already-loaded tree.
 */
export async function listBooks(options: {
  categoryId?: number | null;
  sort?: BookSort;
  limit?: number;
  offset?: number;
}): Promise<{ books: LibraryBook[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { books: [], total: 0 };

  const limit = options.limit ?? LIBRARY_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const order = ORDER[options.sort ?? "new"];

  let request = supabase
    .from("books")
    .select("id, title, author, category_id, page_count, date, cover_path, status", {
      count: "exact",
    })
    .eq("status", "published")
    .order(order.column, { ascending: order.ascending })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (options.categoryId != null) {
    const categories = await getCategories();
    request = request.in("category_id", categoryWithDescendants(categories, options.categoryId));
  }

  const { data, count } = await request;
  return { books: (data as LibraryBook[] | null) ?? [], total: count ?? 0 };
}

/**
 * Book detail. Drafts resolve only for staff — RLS already enforces this, so
 * a reader simply gets nothing back.
 */
export async function getBookDetail(bookId: number): Promise<BookDetail | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("books")
    .select(
      "id, title, author, category_id, page_count, date, cover_path, status, description, language, format, original_file_path, created_at",
    )
    .eq("id", bookId)
    .maybeSingle();
  return (data as BookDetail | null) ?? null;
}

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
  return supabase.storage.from("covers").getPublicUrl(coverPath).data.publicUrl;
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
    map.set(book.cover_path, supabase.storage.from("covers").getPublicUrl(book.cover_path).data.publicUrl);
  }
  return map;
}
