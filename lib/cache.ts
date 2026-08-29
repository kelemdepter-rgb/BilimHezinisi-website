import "server-only";
import { updateTag } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseEnv } from "@/lib/env";

/**
 * What may be cached here, and what may never be.
 *
 * ONLY data that is the same for every visitor on earth AND that nobody is
 * waiting to see change: the category tree, the author index, the list of
 * suras, and the cheap "does this exist" checks the segment layouts make.
 *
 * The book listings themselves are NOT here, though they would fit the first
 * half of that rule. They fail the second: the owner adds a book and looks for
 * it, and a write that reached the database by some other road than this site
 * — the migration script, the SQL editor — has no tag to drop. See the note on
 * listBooks in lib/library.ts. Nothing If the answer depends on WHO is asking, it does not belong in this
 * file: bookmarks, notes, reading progress, the notebook, AI state and every
 * /admin view are per-reader, and a cache entry is shared by everyone, so
 * caching one of them would hand one reader another reader's page.
 *
 * The safety net is `cachedClient()` below: it carries the anon key and no
 * session at all, so RLS answers it as an anonymous visitor. A draft book, a
 * private setting or somebody's notes cannot come back through it even by
 * mistake — the database itself refuses. Never swap it for a client built
 * from `cookies()`; `unstable_cache` cannot read request state anyway, and
 * the point of using this client is that it has no reader to leak.
 *
 * Everything cached is tagged, and every write that could change it calls
 * `revalidateTag` with the matching tag (see `revalidateLibrary`). The
 * `revalidate` seconds on each entry are only a backstop for a tag that was
 * somehow missed — publishing a book must never wait on a timer.
 */

/** The category tree: name, icon, parent, order. */
export const CATEGORIES_TAG = "categories";
/** Anything that changes when a book is added, edited, published or removed. */
export const BOOKS_TAG = "books";
/** The Qur'an tables, which change only when the seed script is re-run. */
export const QURAN_TAG = "quran";

let anonClient: SupabaseClient | null = null;

/**
 * The client every cached read uses: anon key, no cookies, no session.
 *
 * A cache entry is shared by everyone, so it must be built from a request
 * that has no reader behind it. Reused across calls because a cached read is
 * meant to be cheap.
 */
export function cachedClient(): SupabaseClient | null {
  if (!hasSupabaseEnv()) return null;
  if (anonClient) return anonClient;
  anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return anonClient;
}

/**
 * Five minutes.
 *
 * Long enough that almost every request is answered from the cache, short
 * enough to forgive a write that never reached a tag. The tags cover every
 * way a book normally changes — the admin actions, the upload wizard and the
 * batch importer all drop them — but a bulk load run straight against the
 * database (scripts/migrate-from-desktop.mjs, or SQL typed into the Supabase
 * editor) has nothing to drop them with. This is the longest the library can
 * then look unchanged.
 */
export const CACHE_SECONDS = 300;

/**
 * Drop the shared cache after a write.
 *
 * `updateTag` and not `revalidateTag`: revalidateTag's recommended "max"
 * profile serves the STALE entry to the next visitor and refreshes behind
 * them, so the owner would publish a book and still not see it. updateTag
 * expires the entry there and then, and the next request waits for the real
 * answer. It may only be called from a Server Action, which is where every
 * one of these calls sits.
 *
 * Categories drop the book tag as well: moving or deleting a category moves
 * the books inside it, so the cached listings are no longer true either.
 */
export function revalidateBooks(): void {
  updateTag(BOOKS_TAG);
}

export function revalidateCategories(): void {
  updateTag(CATEGORIES_TAG);
  updateTag(BOOKS_TAG);
}
