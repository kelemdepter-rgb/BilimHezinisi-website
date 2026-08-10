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
