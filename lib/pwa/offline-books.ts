import { SW_DOCS_CACHE } from "@/lib/pwa/constants";

/**
 * The short list of books the reader has actually opened.
 *
 * The service worker keeps the book documents themselves, but a cache entry
 * is only a URL — it cannot tell the offline page what «/books/41/read» is
 * called. So the reader writes the title down here as it opens a book, and
 * the offline page shows the ones whose document is genuinely still cached.
 *
 * localStorage rather than the cache: it is readable synchronously, it
 * survives with no network, and a list of titles somebody has read on their
 * own device is exactly the kind of thing that should never leave it.
 */

const STORAGE_KEY = "bh-offline-books";
/** Long enough to cover a reading habit, short enough not to grow forever. */
const LIMIT = 40;

export type OfflineBook = {
  id: number;
  title: string;
  /** Epoch milliseconds, so the list can be shown newest first. */
  at: number;
};

function isOfflineBook(value: unknown): value is OfflineBook {
  if (typeof value !== "object" || value === null) return false;
  const book = value as Partial<OfflineBook>;
  return (
    typeof book.id === "number" &&
    Number.isFinite(book.id) &&
    typeof book.title === "string" &&
    typeof book.at === "number"
  );
}

export function readOfflineBooks(): OfflineBook[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOfflineBook).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Called by the reader on open. Moves an already-known book back to the top. */
export function rememberOfflineBook(id: number, title: string): void {
  if (typeof window === "undefined") return;
  try {
    const rest = readOfflineBooks().filter((book) => book.id !== id);
    const next = [{ id, title, at: Date.now() }, ...rest].slice(0, LIMIT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota. The offline page simply lists less.
  }
}

export function forgetOfflineBooks(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the list is a convenience, not state anything depends on.
  }
}

/**
 * Of the books the reader has opened, the ones whose page is genuinely still
 * in the cache. The remembered list can outlive a cache the browser evicted
 * under storage pressure, and offering a link that leads to the offline page
 * again would be worse than offering nothing.
 */
export async function readableOffline(origin: string): Promise<OfflineBook[]> {
  const remembered = readOfflineBooks();
  if (remembered.length === 0 || typeof caches === "undefined") return [];
  try {
    const cache = await caches.open(SW_DOCS_CACHE);
    const present = await Promise.all(
      remembered.map(async (book) =>
        (await cache.match(`${origin}/books/${book.id}/read`)) ? book : null,
      ),
    );
    return present.filter((book): book is OfflineBook => book !== null);
  } catch {
    return [];
  }
}
