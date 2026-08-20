/**
 * Canonical URLs and structured data.
 *
 * Every absolute link the site emits — canonicals, Open Graph images, the
 * sitemap, the confirmation email's redirect — has to point at the real
 * domain. Getting this wrong is how a live site ends up advertising
 * `localhost` to Google and to people's inboxes.
 */

const FALLBACK = "http://localhost:3000";

function trim(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(trim(url));
}

/**
 * The site's public origin, without a trailing slash.
 *
 * SITE_URL wins, except when it still says localhost while running on Vercel —
 * a half-configured project would otherwise publish local URLs to the world,
 * so the deployment's own production domain takes over.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL;
  if (explicit && !isLocal(explicit)) return trim(explicit);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${trim(vercel)}`;

  return explicit ? trim(explicit) : FALLBACK;
}

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export const SITE_NAME = "بىلىم خەزىنىسى";

export const SITE_DESCRIPTION =
  "«بىلىم خەزىنىسى» — ئۇيغۇرچە ئېلكىتابلارنى ھېساباتسىز ئوقۇش، ئىزدەش ۋە قۇرئان كەرىمنى مۇتالىئە قىلىشقا بولىدىغان ئوچۇق كۇتۇپخانا.";

/** The facts a search engine needs to present a page as a book. */
export type BookFacts = {
  id: number;
  title: string;
  author?: string | null;
  description?: string | null;
  date?: string | null;
  language?: string | null;
  pageCount?: number | null;
  coverUrl?: string | null;
  genre?: string | null;
};

/**
 * schema.org/Book for one of this library's books.
 *
 * Shared by the book's own page and by the reader, so a link somebody shares
 * to an exact page describes the same book as the cover page does rather than
 * being an anonymous document. The url is always the canonical one — ?page=
 * addresses a position inside the book, not a different work.
 */
export function bookJsonLd(book: BookFacts, canonicalPath: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
    url: absoluteUrl(canonicalPath),
    inLanguage: book.language || "ug",
    ...(book.author ? { author: { "@type": "Person", name: book.author } } : {}),
    ...(book.description ? { description: book.description } : {}),
    ...(book.date ? { datePublished: book.date } : {}),
    ...(book.pageCount && book.pageCount > 0 ? { numberOfPages: book.pageCount } : {}),
    ...(book.coverUrl ? { image: book.coverUrl } : {}),
    ...(book.genre ? { genre: book.genre } : {}),
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    potentialAction: { "@type": "ReadAction", target: absoluteUrl(`/books/${book.id}/read`) },
  };
}

/**
 * Serialize JSON-LD for embedding in a <script> tag.
 *
 * `<` is escaped so a book title containing "</script>" cannot close the tag
 * and inject markup — the data comes from the library, but it is still text
 * somebody typed.
 */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
