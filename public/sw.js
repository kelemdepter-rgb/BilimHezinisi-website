/*
 * Bilim Hezinisi — service worker.
 *
 * Hand-written on purpose. next-pwa and friends are build-time plugins that
 * have to track every Next release; this file is plain script that nothing
 * else in the toolchain has to know about, and the whole caching policy is
 * readable in one sitting — which matters, because the policy is the security
 * boundary.
 *
 * THE RULE THAT OUTRANKS EVERY OTHER RULE HERE: nothing private is ever
 * stored. A cache is shared by everyone who uses the browser profile, so one
 * cached page carrying somebody's name, bookmarks or reading position could
 * be handed to the next person who opens the app. The lists below are
 * therefore written as "these exact things may be kept", and everything else
 * — including anything unrecognised — goes to the network untouched.
 *
 * Constants marked KEEP IN STEP are mirrored in lib/pwa/constants.ts and
 * checked by tests/unit/sw-parity.test.ts; a service worker cannot import.
 */

/* KEEP IN STEP: lib/pwa/constants.ts */
const VERSION = "v1";
const SHELL = `bh-sw-shell-${VERSION}`;
const DOCS = `bh-sw-docs-${VERSION}`;
const TEXT = `bh-sw-text-${VERSION}`;
const COVERS = `bh-sw-covers-${VERSION}`;
const STATIC = `bh-sw-static-${VERSION}`;
const OWNED = [SHELL, DOCS, TEXT, COVERS, STATIC];
/** Only the worker's own caches are swept on activate — not bh-spelldict-*. */
const SWEEP_PREFIX = "bh-sw-";

const OFFLINE_URL = "/offline";

/**
 * Registered as /sw.js?dev=1 by the dev server only.
 *
 * Next's development build serves its chunks from /_next/static under names
 * that do NOT change when the file behind them does, so caching them first
 * would hand the developer yesterday's code and quietly break hot reload.
 * In production every one of those names carries a content hash and
 * cache-first is exactly right.
 */
const DEV = new URL(self.location.href).searchParams.get("dev") === "1";
const CACHEABLE_HEADER = "x-bilim-cacheable";
const STAMP_HEADER = "x-bh-cached-at";

/** The one face the first paint needs; the rest load lazily from their CSS. */
const SHELL_ASSETS = ["/fonts/ukijekran.woff2"];

/** How many of each kind to keep before the oldest entry is dropped. */
const LIMITS = { [DOCS]: 40, [COVERS]: 60, [STATIC]: 200 };

/**
 * How long a cached book page is served without asking the network again.
 *
 * Textbook stale-while-revalidate refetches on every hit, which for a reader
 * scrolling through a book would spend MORE egress than the cache saves — and
 * this library runs on a 5 GB/month allowance. A page of a book is immutable
 * in practice (re-uploading a book replaces its rows wholesale, which is
 * rare), so the stored copy is served at once and the background refresh
 * happens at most once a day per page.
 */
const TEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Never touched, at all. Signing in, the admin area, anybody's own notes and
 * bookmarks, and the dev server's own plumbing. /spellcheck/ is excluded for
 * a different reason: the spellchecker already keeps the dictionary in its
 * own Cache Storage entry, and mirroring several megabytes here would simply
 * store it twice.
 */
const PRIVATE_PREFIXES = [
  "/admin",
  "/api/",
  "/auth/",
  "/my/",
  "/notes",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/spellcheck/",
  "/__next",
  "/_next/webpack-hmr",
];

/**
 * Public, but pointless to keep: a search result page is a different document
 * for every query typed, and search cannot work offline anyway — it is a
 * database query, not a file.
 */
const UNCACHEABLE_DOCS = ["/search", "/offline"];

/** Supabase tables whose rows are the same for every visitor. */
const PUBLIC_TABLES = ["book_pages", "books", "categories", "quran_suras", "quran_ayas"];

/* ── install ─────────────────────────────────────────────────────────────── */

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

/**
 * The minimum needed to boot with no network: the offline page, the
 * stylesheet it names, and the UI font.
 *
 * The stylesheet's filename carries a content hash that changes on every
 * deploy, so it cannot be written down here — it is read out of the offline
 * document instead. The icon sprite needs no entry: <IconSprite /> inlines it
 * into every document, so it arrives with the HTML.
 */
async function precache() {
  const cache = await caches.open(SHELL);
  const assets = new Set(SHELL_ASSETS);

  try {
    const response = await fetch(OFFLINE_URL, { credentials: "omit", cache: "reload" });
    if (response.ok && !response.redirected) {
      const body = await response.clone().text();
      await cache.put(OFFLINE_URL, response);
      for (const found of body.matchAll(/["'](\/_next\/static\/[^"']+\.css)["']/g)) {
        assets.add(found[1]);
      }
    }
  } catch {
    // Installed while offline. The runtime handlers fill the gap on the first
    // successful load; until then the browser's own error page shows.
  }

  await Promise.all(
    [...assets].map((url) =>
      cache.add(new Request(url, { credentials: "omit" })).catch(() => undefined),
    ),
  );
}

/* ── activate ────────────────────────────────────────────────────────────── */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(SWEEP_PREFIX) && !OWNED.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/* ── messages from the page ──────────────────────────────────────────────── */

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  // The reader tapped «يېڭىلاش» on the update toast.
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  // The account page has just emptied the caches; put the offline page back
  // so the site does not silently lose its fallback.
  if (data.type === "PRECACHE") event.waitUntil(precache());
});

/* ── fetch ───────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Writes are never replayed from a cache: sign-in, Server Actions, uploads,
  // and every Supabase RPC (search is a POST) go straight to the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (isPublicTableRead(url) && isAnonymousRead(request)) {
      event.respondWith(staleWhileRevalidate(event, request, TEXT));
    }
    return;
  }

  if (isPrivate(url)) return;
  // Flight data for a client-side navigation is rendered per session, exactly
  // like the document it belongs to, and is never worth the risk.
  if (url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleDocument(event, request, url));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      DEV ? networkFirst(event, request, STATIC) : cacheFirst(event, request, STATIC),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/image")) {
    event.respondWith(cacheFirst(event, request, COVERS));
    return;
  }
  event.respondWith(networkFirst(event, request, SHELL));
});

function isPrivate(url) {
  return PRIVATE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

/** A PostgREST read of a table whose rows are identical for everybody. */
function isPublicTableRead(url) {
  const match = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
  return match !== null && PUBLIC_TABLES.includes(match[1]);
}

/**
 * True only when the request carries the public anon key and nothing else.
 *
 * supabase-js sends the signed-in reader's own token in Authorization, and a
 * response fetched with it may hold rows RLS would hide from anyone else — an
 * unpublished draft an editor is previewing, for one. Comparing the two
 * headers is how this worker tells "public library text" apart from
 * "something this particular person is allowed to see".
 */
function isAnonymousRead(request) {
  const apikey = request.headers.get("apikey");
  if (!apikey) return false;
  return request.headers.get("authorization") === `Bearer ${apikey}`;
}

/* ── documents ───────────────────────────────────────────────────────────── */

/**
 * Network first, so a reader with a connection always gets the live page.
 * A copy is kept only when the server marked the response as carrying no
 * session (see proxy.ts) — a signed-in reader's document has their reading
 * position rendered into it, and that must not outlive their session.
 */
async function handleDocument(event, request, url) {
  const key = documentKey(url);
  try {
    const response = await fetch(request);
    if (isKeepableDocument(response, url)) {
      event.waitUntil(put(DOCS, key, response.clone()));
    } else if (response.ok && !response.redirected && isReaderUrl(url)) {
      event.waitUntil(cachePublicCopy(key));
    }
    return response;
  } catch {
    const cached = await caches.match(key, { cacheName: DOCS });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL });
    return offline ?? new Response("", { status: 504, statusText: "Offline" });
  }
}

function isKeepableDocument(response, url) {
  if (!response.ok || response.redirected) return false;
  if (response.headers.get(CACHEABLE_HEADER) !== "1") return false;
  return !UNCACHEABLE_DOCS.includes(url.pathname);
}

function isReaderUrl(url) {
  return /^\/books\/[^/]+\/read$/.test(url.pathname);
}

/**
 * The reader's ?page=, ?q= and ?from= address a position inside one book, not
 * a different document — one entry per book, or the cache fills with the same
 * book over and over.
 */
function documentKey(url) {
  return isReaderUrl(url) ? url.origin + url.pathname : url.origin + url.pathname + url.search;
}

/**
 * A signed-in reader's copy of a book page is personal; the same book fetched
 * without cookies is the public one, identical to what any visitor would get,
 * and that is what may be kept for offline use. Costs one extra HTML request
 * the first time such a reader opens a book — and nothing afterwards.
 */
async function cachePublicCopy(key) {
  if (await caches.match(key, { cacheName: DOCS })) return;
  try {
    const response = await fetch(key, { credentials: "omit", headers: { Accept: "text/html" } });
    if (isKeepableDocument(response, new URL(key))) await put(DOCS, key, response);
  } catch {
    // Nothing to keep. The reader still has the live page in front of them.
  }
}

/* ── strategies ──────────────────────────────────────────────────────────── */

async function cacheFirst(event, request, cacheName) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(put(cacheName, request, response.clone()));
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function networkFirst(event, request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      event.waitUntil(put(cacheName, request, response.clone()));
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName });
    return cached ?? new Response("", { status: 504, statusText: "Offline" });
  }
}

/**
 * Serve the stored copy at once, and refresh it in the background only once
 * it has gone stale — see TEXT_MAX_AGE_MS for why this is not the textbook
 * "refresh on every hit".
 */
async function staleWhileRevalidate(event, request, cacheName) {
  const cached = await caches.match(request, { cacheName });
  if (cached) {
    if (isStale(cached)) event.waitUntil(refresh(request, cacheName));
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(put(cacheName, request, response.clone()));
    return response;
  } catch {
    // Shaped like a PostgREST error, so supabase-js reports it as one and the
    // reader shows its own Uyghur message rather than a stack trace.
    return new Response(JSON.stringify({ message: "offline", code: "sw_offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function isStale(response) {
  const stamp = Number(response.headers.get(STAMP_HEADER));
  return !Number.isFinite(stamp) || Date.now() - stamp > TEXT_MAX_AGE_MS;
}

async function refresh(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) await put(cacheName, request, response);
  } catch {
    // Still offline, or the row is gone. The stored copy stays.
  }
}

/** Store one entry, stamped with the time, then trim the cache to its limit. */
async function put(cacheName, key, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, await stamp(response));
    const limit = LIMITS[cacheName];
    if (limit) await trim(cache, limit);
  } catch {
    // A full quota, or private mode. Caching is an optimisation and never a
    // requirement — the page it belongs to has already been served.
  }
}

/** Cache Storage keeps no timestamps, so the response carries its own. */
async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set(STAMP_HEADER, String(Date.now()));
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** keys() comes back in insertion order, so the front of the list is oldest. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
