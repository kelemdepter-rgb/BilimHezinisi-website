import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSupabasePublicClient } from "@/lib/supabase/public-client";
import type { ReadingPosition } from "@/lib/reader/position";

export type BookPage = { page_no: number; content: string };
export type Annotation = {
  id: number;
  page_no: number;
  position: number;
  created_at: string;
  /** bookmark name, or note text */
  text: string;
};

/**
 * Pages come straight from Supabase under RLS — no Vercel function in the path.
 *
 * A published book is read with the anon key even when someone is signed in:
 * the rows are public either way, and a request carrying only the public key
 * is one the service worker is allowed to keep for offline reading. A draft
 * is the opposite case — visible only to its editor, and never cached — so it
 * keeps the session client.
 */
export async function fetchPages(
  bookId: number,
  from: number,
  to: number,
  published = true,
): Promise<BookPage[]> {
  const supabase = published ? createSupabasePublicClient() : createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("book_pages")
    .select("page_no, content")
    .eq("book_id", bookId)
    .gte("page_no", from)
    .lte("page_no", to)
    .order("page_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as BookPage[] | null) ?? [];
}

/** One page of the book that carries the phrase, and how often. */
export type MatchPage = { page_no: number; hits: number };

/** The cap the navigator reports as "more than this". */
export const MATCH_PAGE_LIMIT = 500;

/**
 * Every page of THIS book carrying the phrase, in order, with the number of
 * occurrences on each — enough to build a whole-book match list and a "12/47"
 * counter without downloading the book.
 *
 * Uses the FTS index through book_match_pages (migration 0017) rather than an
 * ilike scan, so it costs the same whatever the library grows to, and matches
 * diacritic-insensitively the way the rest of search does.
 */
export async function fetchBookMatchPages(
  bookId: number,
  query: string,
): Promise<{ pages: MatchPage[]; capped: boolean }> {
  const term = query.trim();
  if (!term) return { pages: [], capped: false };
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("book_match_pages", {
    book_id: bookId,
    q: term,
    lim: MATCH_PAGE_LIMIT,
  });
  if (error) throw new Error(error.message);
  const pages = ((data as MatchPage[] | null) ?? []).filter((page) => page.hits > 0);
  return { pages, capped: pages.length >= MATCH_PAGE_LIMIT };
}

/** Debounced by the caller. Anonymous readers never reach this. */
export async function saveProgress(bookId: number, position: ReadingPosition): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("reading_progress").upsert(
    {
      user_id: user.id,
      book_id: bookId,
      page_no: position.pageNo,
      position: position.offset,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,book_id" },
  );
}

/** Upsert keeps recent reads deduplicated per book. */
export async function touchRecentRead(bookId: number): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("recent_reads")
    .upsert(
      { user_id: user.id, book_id: bookId, read_at: new Date().toISOString() },
      { onConflict: "user_id,book_id" },
    );
}

export async function fetchAnnotations(
  bookId: number,
): Promise<{ bookmarks: Annotation[]; notes: Annotation[] }> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { bookmarks: [], notes: [] };

  const [bookmarkRows, noteRows] = await Promise.all([
    supabase
      .from("bookmarks")
      .select("id, page_no, position, created_at, name")
      .eq("book_id", bookId)
      .order("page_no", { ascending: true }),
    supabase
      .from("book_notes")
      .select("id, page_no, position, created_at, text")
      .eq("book_id", bookId)
      .order("page_no", { ascending: true }),
  ]);

  type BookmarkRow = Omit<Annotation, "text"> & { name: string };
  return {
    bookmarks: ((bookmarkRows.data as BookmarkRow[] | null) ?? []).map((row) => ({
      id: row.id,
      page_no: row.page_no,
      position: row.position,
      created_at: row.created_at,
      text: row.name,
    })),
    notes: (noteRows.data as Annotation[] | null) ?? [],
  };
}

export async function addBookmark(
  bookId: number,
  pageNo: number,
  name: string,
): Promise<Annotation | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("bookmarks")
    .insert({ user_id: user.id, book_id: bookId, page_no: pageNo, position: 0, name })
    .select("id, page_no, position, created_at, name")
    .single();
  if (error) throw new Error(error.message);
  const row = data as { id: number; page_no: number; position: number; created_at: string; name: string };
  return { id: row.id, page_no: row.page_no, position: row.position, created_at: row.created_at, text: row.name };
}

export async function addNote(
  bookId: number,
  pageNo: number,
  text: string,
): Promise<Annotation | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("book_notes")
    .insert({ user_id: user.id, book_id: bookId, page_no: pageNo, position: 0, text })
    .select("id, page_no, position, created_at, text")
    .single();
  if (error) throw new Error(error.message);
  return data as Annotation;
}

export async function deleteAnnotation(kind: "bookmark" | "note", id: number): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const table = kind === "bookmark" ? "bookmarks" : "book_notes";
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
