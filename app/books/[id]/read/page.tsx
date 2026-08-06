import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Reader } from "@/components/reader/reader";
import { getSessionInfo } from "@/lib/data";
import { getBookDetail, getReadingProgress } from "@/lib/library";
import { clampPosition, initialPageWindow } from "@/lib/reader/position";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { THEME_COOKIE, isTheme } from "@/lib/theme";
import type { BookPage } from "@/lib/reader/pages";

const WINDOW_SIZE = 8;

export async function generateMetadata({ params }: PageProps<"/books/[id]/read">): Promise<Metadata> {
  const { id } = await params;
  const book = await getBookDetail(Number(id));
  return { title: book ? `${book.title} — ئوقۇش` : "ئوقۇش" };
}

export default async function ReadPage({ params, searchParams }: PageProps<"/books/[id]/read">) {
  const { id } = await params;
  const query = await searchParams;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) notFound();

  const book = await getBookDetail(bookId);
  if (!book) notFound();

  const [session, progress, cookieStore, supabase] = await Promise.all([
    getSessionInfo(),
    getReadingProgress(bookId),
    cookies(),
    createSupabaseServerClient(),
  ]);

  const requestedPage = typeof query.page === "string" ? Number(query.page) : NaN;
  const highlight = typeof query.q === "string" ? query.q : "";

  // Anonymous readers restore from localStorage in the client; the server
  // window still has to include an explicitly requested page.
  const position = clampPosition(
    Number.isFinite(requestedPage) ? { pageNo: requestedPage, offset: 0 } : progress,
    book.page_count,
  );
  const window_ = initialPageWindow(position, book.page_count, WINDOW_SIZE);

  let initialPages: BookPage[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("book_pages")
      .select("page_no, content")
      .eq("book_id", bookId)
      .gte("page_no", window_.from)
      .lte("page_no", window_.to)
      .order("page_no", { ascending: true });
    initialPages = (data as BookPage[] | null) ?? [];
  }

  const rawTheme = cookieStore.get(THEME_COOKIE)?.value;

  return (
    <Reader
      bookId={bookId}
      title={book.title}
      pageCount={book.page_count}
      initialPages={initialPages}
      initialPosition={position}
      signedIn={Boolean(session)}
      theme={isTheme(rawTheme) ? rawTheme : null}
      jumpToPage={Number.isFinite(requestedPage) ? position.pageNo : null}
      highlight={highlight}
    />
  );
}
