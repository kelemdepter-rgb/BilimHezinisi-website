import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { DownloadBook } from "@/components/books/download-book";
import { BookCover } from "@/components/library/book-cover";
import { getCategories, getSessionInfo } from "@/lib/data";
import {
  categoryTrail,
  coverUrlFor,
  getBookDetail,
  getReadingProgress,
} from "@/lib/library";
import { SITE_NAME, absoluteUrl, jsonLd } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/books/[id]">): Promise<Metadata> {
  const { id } = await params;
  const book = await getBookDetail(Number(id));
  if (!book) return { title: "كىتاب تېپىلمىدى", robots: { index: false, follow: false } };

  const description =
    book.description || `${book.title}${book.author ? ` — ${book.author}` : ""}. ${SITE_NAME}دىن ھېساباتسىز ئوقۇڭ.`;
  const canonical = `/books/${book.id}`;

  // A draft is visible to staff only, so it must never be advertised: no
  // indexing, and no share card carrying its title.
  if (book.status !== "published") {
    return { title: book.title, description, robots: { index: false, follow: false } };
  }

  // With a cover, share the cover. Without one, the site's card
  // (app/opengraph-image.tsx) is what Next attaches, and the title and author
  // still reach the preview as og:title / og:description text.
  const coverUrl = await coverUrlFor(book.cover_path);
  const images = coverUrl ? [{ url: coverUrl, alt: book.title }] : undefined;

  return {
    title: book.title,
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

export default async function BookDetailPage({ params }: PageProps<"/books/[id]">) {
  const { id } = await params;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) notFound();

  // RLS already hides drafts from readers, so a missing row is a 404 for them
  // and staff still see their own unpublished work.
  const book = await getBookDetail(bookId);
  if (!book) notFound();

  const [categories, session, progress, coverUrl, requestHeaders] = await Promise.all([
    getCategories(),
    getSessionInfo(),
    getReadingProgress(bookId),
    coverUrlFor(book.cover_path),
    headers(),
  ]);
  // Inline <script>, so the CSP nonce the proxy minted has to travel with it.
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  const trail = categoryTrail(categories, book.category_id);
  const isDraft = book.status !== "published";

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      {/* Structured data, so a search engine can present this as a book
          rather than as an anonymous page. Drafts describe nothing. */}
      {!isDraft && (
        <script
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLd({
              "@context": "https://schema.org",
              "@type": "Book",
              name: book.title,
              url: absoluteUrl(`/books/${book.id}`),
              inLanguage: book.language || "ug",
              ...(book.author ? { author: { "@type": "Person", name: book.author } } : {}),
              ...(book.description ? { description: book.description } : {}),
              ...(book.date ? { datePublished: book.date } : {}),
              ...(book.page_count > 0 ? { numberOfPages: book.page_count } : {}),
              ...(coverUrl ? { image: coverUrl } : {}),
              ...(trail.length > 0 ? { genre: trail[trail.length - 1].name } : {}),
              isAccessibleForFree: true,
              publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
              potentialAction: {
                "@type": "ReadAction",
                target: absoluteUrl(`/books/${book.id}/read`),
              },
            }),
          }}
        />
      )}

      {trail.length > 0 && (
        <nav aria-label="تۈر يولى" className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink3">
          <Link href="/" className="hover:text-ink">
            كۇتۇپخانا
          </Link>
          {trail.map((category) => (
            <span key={category.id} className="flex items-center gap-1.5">
              <span aria-hidden="true">‹</span>
              <Link href={`/?cat=${category.id}`} className="hover:text-ink">
                {category.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <div className="paper grain mx-auto w-40 overflow-hidden lg:mx-0 lg:w-full">
          <div className="relative aspect-[3/4] w-full">
            <BookCover
              coverUrl={coverUrl}
              title={book.title}
              author={book.author}
              sizes="(min-width: 1024px) 220px, 160px"
              priority
            />
          </div>
        </div>

        <div className="min-w-0">
          {isDraft && (
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-ab2 px-3 py-1 text-[12px] font-semibold">
              <Icon name="info" />
              قارالما — پەقەت باشقۇرغۇچىلارغا كۆرۈنىدۇ
            </p>
          )}
          <h1 className="text-2xl font-bold leading-relaxed">{book.title}</h1>
          {book.author && <p className="mt-1.5 text-[15px] text-ink2">{book.author}</p>}

          {/* A plain list, not a <dl>: these are single facts, not term and
              definition pairs, and a <dl> holding bare spans is invalid. */}
          <ul className="mt-4 flex flex-wrap gap-2 text-[12.5px]">
            {book.page_count > 0 && <Fact icon="file-text" text={`${book.page_count} بەت`} />}
            {book.date && <Fact icon="clock" text={book.date} />}
            {book.format && <Fact icon="tag" text={book.format} />}
            {trail.length > 0 && <Fact icon="layers" text={trail[trail.length - 1].name} />}
          </ul>

          {progress && progress.pageNo > 1 && (
            <p className="mt-4 rounded-[var(--radius)] bg-ab px-3.5 py-2.5 text-[13px]" data-testid="book-progress">
              ئوقۇش ئىزىڭىز: {progress.pageNo}-بەت / {book.page_count} بەت
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            {progress && progress.pageNo > 1 ? (
              <>
                <Link href={`/books/${book.id}/read`} className="btn-am" data-testid="continue-reading">
                  <Icon name="book-open" />
                  داۋاملاشتۇرۇش
                </Link>
                <Link href={`/books/${book.id}/read?page=1`} className="hbtn">
                  باشتىن ئوقۇش
                </Link>
              </>
            ) : (
              <Link href={`/books/${book.id}/read`} className="btn-am" data-testid="start-reading">
                <Icon name="book-open" />
                ئوقۇش
              </Link>
            )}
            {/* A draft has nothing to hand out yet, so it is not offered. */}
            {!isDraft && <DownloadBook bookId={book.id} />}
          </div>

          {book.description && (
            <div className="mt-6">
              <h2 className="text-[15px] font-bold">چۈشەندۈرۈش</h2>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-8 text-ink2">
                {book.description}
              </p>
            </div>
          )}

          {!session && (
            <p className="mt-6 rounded-[var(--radius)] bg-bg2 px-3.5 py-3 text-[13px] leading-6 text-ink2">
              خەتكۈچ قويۇش، خاتىرە يېزىش ۋە ئوقۇش ئىزىڭىزنى ساقلاش ئۈچۈن{" "}
              <Link href="/login" className="font-semibold text-am underline">
                كىرىڭ
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, text }: { icon: "file-text" | "clock" | "tag" | "layers"; text: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-bg2 px-3 py-1.5 text-ink2">
      <Icon name={icon} />
      {text}
    </li>
  );
}
