/**
 * The handful of names the app and the service worker both have to agree on.
 *
 * public/sw.js cannot import anything — it is a plain script the browser
 * loads on its own — so the values are written twice and
 * tests/unit/sw-parity.test.ts reads the worker's source to prove the two
 * copies still match. That is the same arrangement as the SQL and script
 * parity tests already in this suite.
 */

export const SW_URL = "/sw.js";
export const SW_VERSION = "v2";

/** Caches the worker owns; wiping these is what "clear offline data" means. */
export const SW_CACHES = [
  `bh-sw-shell-${SW_VERSION}`,
  `bh-sw-docs-${SW_VERSION}`,
  `bh-sw-text-${SW_VERSION}`,
  `bh-sw-covers-${SW_VERSION}`,
  `bh-sw-static-${SW_VERSION}`,
] as const;

/** Where the offline copies of book documents live. */
export const SW_DOCS_CACHE = `bh-sw-docs-${SW_VERSION}`;

/**
 * Every cache this site has ever created, the spellchecker's dictionary
 * included — that is the single largest thing stored on the device, so a
 * "reclaim space" button that skipped it would be lying about the total.
 */
export const SITE_CACHE_PREFIX = "bh-";

export const OFFLINE_URL = "/offline";

/**
 * Set by proxy.ts on every page response: "1" when the response carries no
 * session and is therefore safe to keep, "0" when it was rendered for a
 * signed-in reader.
 */
export const CACHEABLE_HEADER = "x-bilim-cacheable";

/**
 * The worker's FAILED_RENDER pattern, as source: a document matching it
 * failed on the server — even with a 200, once its loading skeleton had
 * streamed (PROMPT-40) — and is never stored as an offline copy.
 * `$RX(` is React's instruction to render an errored part in the browser,
 * `data-dgst=` its older form, `data-bh-error-page` our own error pages.
 */
export const FAILED_RENDER_SOURCE = String.raw`\$RX\(|data-dgst=|data-bh-error-page`;
