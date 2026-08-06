import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MyAnnotation } from "@/components/my/annotation-list";

type Row = {
  id: number;
  book_id: number;
  page_no: number;
  created_at: string;
  name?: string;
  text?: string;
  books: { id: number; title: string } | { id: number; title: string }[] | null;
};

/**
 * All of the signed-in user's bookmarks or notes, grouped by book.
 * One joined query brings the book titles along — no per-row lookups.
 */
export async function getMyAnnotations(
  kind: "bookmark" | "note",
): Promise<{ bookId: number; bookTitle: string; items: MyAnnotation[] }[] | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const table = kind === "bookmark" ? "bookmarks" : "book_notes";
  const valueColumn = kind === "bookmark" ? "name" : "text";
  const { data } = await supabase
    .from(table)
    .select(`id, book_id, page_no, created_at, ${valueColumn}, books!inner(id, title)`)
    .eq("user_id", user.id)
    .order("book_id", { ascending: true })
    .order("page_no", { ascending: true });

  const grouped = new Map<number, { bookId: number; bookTitle: string; items: MyAnnotation[] }>();
  for (const row of (data as unknown as Row[] | null) ?? []) {
    const book = Array.isArray(row.books) ? row.books[0] : row.books;
    if (!book) continue;
    const group = grouped.get(book.id) ?? { bookId: book.id, bookTitle: book.title, items: [] };
    group.items.push({
      id: row.id,
      bookId: book.id,
      bookTitle: book.title,
      pageNo: row.page_no,
      text: (kind === "bookmark" ? row.name : row.text) ?? "",
      createdAt: String(row.created_at).slice(0, 10),
    });
    grouped.set(book.id, group);
  }
  return [...grouped.values()];
}
