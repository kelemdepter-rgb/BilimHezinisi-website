/**
 * Canonical URLs and structured data.
 *
 * Every absolute link the site emits — canonicals, Open Graph images, the
 * sitemap, the confirmation email's redirect — has to point at the real
 * domain. Getting this wrong is how a live site ends up advertising
 * `localhost` to Google and to people's inboxes.
 */

const FALLBACK = "http://localhost:3000";

/**
 * The library's own address, written down rather than discovered.
 *
 * The site moved here from bilim-hezinisi-website.vercel.app on 2026-08-29.
 * It is a constant, and not an environment lookup, because neither variable
 * Vercel offers can be trusted to name it:
 *
 * - VERCEL_PROJECT_PRODUCTION_URL is documented as "the shortest production
 *   custom domain, or vercel.app domain if no custom domain is available". It
 *   answers bilimhezinisi.com today, but it would fall back to the old
 *   vercel.app host the day the custom domain came off the project — an
 *   expired registration, a DNS change — and it would change on its own the
 *   day a shorter domain was added.
 * - VERCEL_URL is always the deployment's own *.vercel.app host.
 *
 * Either one would put an address on this library that nobody chose, in the
 * canonical tags Google reads and in the links Supabase mails to people. A
 * constant in git is reviewable and testable; a fallback that guesses is
 * neither.
 */
export const CANONICAL_ORIGIN = "https://bilimhezinisi.com";

function trim(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(trim(url));
}

/** True on any Vercel deployment, whichever system variables are exposed. */
function onVercel(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
}

/**
 * The site's public origin, without a trailing slash.
 *
 * SITE_URL wins, except when it still says localhost while running on Vercel —
 * a half-configured project would otherwise publish local URLs to the world.
 * A deployment that has lost SITE_URL, or never had it, then answers with the
 * canonical domain rather than with whichever host it happens to be reachable
 * on; that is the whole reason CANONICAL_ORIGIN is written down above.
 *
 * It does not throw when SITE_URL is missing, deliberately. A variable going
 * astray must never be able to take a free public library offline, and a
 * canonical that is right anyway is a better failure than a 500 on every page.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL;
  if (explicit && !isLocal(explicit)) return trim(explicit);
  if (onVercel()) return CANONICAL_ORIGIN;
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
