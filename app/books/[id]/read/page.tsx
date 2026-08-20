import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { Reader } from "@/components/reader/reader";
import { getSessionInfo } from "@/lib/data";
import { coverUrlFor, getBookDetail, getReadingProgress } from "@/lib/library";
import { bookJsonLd, jsonLd } from "@/lib/seo";
import { clampPosition, initialPageWindow } from "@/lib/reader/position";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { THEME_COOKIE, isTheme } from "@/lib/theme";
import type { BookPage } from "@/lib/reader/pages";

const WINDOW_SIZE = 8;

export async function generateMetadata({ params }: PageProps<"/books/[id]/read">): Promise<Metadata> {
  const { id } = await params;
  const book = await getBookDetail(Number(id));
  if (!book) return { title: "ئوقۇش", robots: { index: false, follow: false } };

  // ?page= and ?q= are the same text at a different scroll position, so they
  // all point back at the clean reading URL. Drafts stay out of the index.
  const canonical = `/books/${book.id}/read`;
  const description = `${book.title}${book.author ? ` — ${book.author}` : ""}. تور بەتتە ھېساباتسىز ئوقۇڭ.`;
  if (book.status !== "published") {
    return { title: `${book.title} — ئوقۇش`, robots: { index: false, follow: false } };
  }

  /**
   * A link to an exact page is the most shared thing on this site — somebody
   * sends a friend the passage they are reading — so the preview card has to
   * be the book's own cover and blurb, not the site's generic card. The
   * canonical deliberately keeps no ?page=: it addresses a position inside
   * this text, not another document.
   */
  const coverUrl = await coverUrlFor(book.cover_path);
  const images = coverUrl ? [{ url: coverUrl, alt: book.title }] : undefined;

  return {
    title: `${book.title} — ئوقۇش`,
    description,
    alternates: { canonical },
    openGraph: {
      type: "book",
      title: book.title,
      description,
      url: canonical,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: book.title,
      description,
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
  };
}

export default async function ReadPage({ params, searchParams }: PageProps<"/books/[id]/read">) {
  const { id } = await params;
  const query = await searchParams;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) notFound();

  const book = await getBookDetail(bookId);
  if (!book) notFound();

  const [session, progress, cookieStore, supabase, coverUrl, requestHeaders] = await Promise.all([
    getSessionInfo(),
    getReadingProgress(bookId),
    cookies(),
    createSupabaseServerClient(),
    coverUrlFor(book.cover_path),
    headers(),
  ]);

  const requestedPage = typeof query.page === "string" ? Number(query.page) : NaN;
  const highlight = typeof query.q === "string" ? query.q : "";
  // ?m= addresses one occurrence within the requested page, so a result from
  // the search page's expanded list lands on that exact word.
  const requestedMatch = typeof query.m === "string" ? Number(query.m) : NaN;
  // Set by links on the search results page, so the reader knows the way back
  // is the results list rather than this book's own page.
  const cameFromSearch = query.from === "search";

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
  const isDraft = book.status !== "published";

  return (
    <>
      {/* The same Book description the cover page carries, so a shared
          ?page= link is understood as this book rather than as an untitled
          document. Inline <script>, so it needs the proxy's CSP nonce.
          Drafts describe nothing. */}
      {!isDraft && (
        <script
          nonce={requestHeaders.get("x-nonce") ?? undefined}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLd(
              bookJsonLd(
                {
                  id: book.id,
                  title: book.title,
                  author: book.author,
                  description: book.description,
                  date: book.date,
                  language: book.language,
                  pageCount: book.page_count,
                  coverUrl,
                },
                `/books/${book.id}/read`,
              ),
            ),
          }}
        />
      )}
      <Reader
        bookId={bookId}
        title={book.title}
        author={book.author ?? ""}
        pageCount={book.page_count}
        contentFormat={book.content_format === "markdown" ? "markdown" : "text"}
        published={book.status === "published"}
        initialPages={initialPages}
        initialPosition={position}
        signedIn={Boolean(session)}
        theme={isTheme(rawTheme) ? rawTheme : null}
        jumpToPage={Number.isFinite(requestedPage) ? position.pageNo : null}
        highlight={highlight}
        jumpToMatch={Number.isInteger(requestedMatch) && requestedMatch >= 0 ? requestedMatch : null}
        cameFromSearch={cameFromSearch}
      />
    </>
  );
}
