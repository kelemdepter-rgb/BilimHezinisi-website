import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BOOKS_TAG, CACHE_SECONDS, CATEGORIES_TAG, cachedClient } from "@/lib/cache";
import { rollUpCategoryCounts } from "@/lib/library-types";
import { timed } from "@/lib/perf/timing";
import type { Category, Role, SessionInfo } from "@/lib/types";

/**
 * Who is reading, for the header and the sidebar.
 *
 * The identity comes from the access token, verified here with WebCrypto
 * against the project's published ES256 key — not from an unchecked cookie,
 * and not from a round trip to the Auth server that the proxy has already
 * made on this same request. The ROLE still comes from the profiles table on
 * every call, exactly as before: the token says who you are, the database
 * says what you may do. Nothing here decides an authorisation question —
 * /admin and every mutating action re-ask lib/admin/guards.ts, which reads
 * profiles for itself.
 *
 * cache() because the shell and the page both ask.
 */
export const getSessionInfo = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data: verified } = await timed("layout.auth.getClaims", () =>
    supabase.auth.getClaims(),
  );
  const userId = typeof verified?.claims?.sub === "string" ? verified.claims.sub : null;
  if (!userId) return null;
  const email = typeof verified?.claims?.email === "string" ? verified.claims.email : "";
  const { data: profile } = await timed("layout.profiles", async () =>
    supabase.from("profiles").select("role, display_name").eq("id", userId).maybeSingle(),
  );
  const role: Role =
    profile?.role === "admin" || profile?.role === "uploader" ? profile.role : "reader";
  return {
    email,
    displayName: (profile?.display_name as string | null) || email,
    role,
  };
});

/**
 * The category tree, out of the shared cache.
 *
 * It is the same handful of rows for every visitor and it changes when the
 * owner edits the tree — perhaps once a month — so re-reading it from London
 * on every click was the largest avoidable cost on the site. The category
 * actions in app/admin/categories/actions.ts drop the tag on every write, so
 * an edit shows up immediately and never waits for the hour below.
 */
const loadCategories = unstable_cache(
  async (): Promise<Category[]> => {
    const supabase = cachedClient();
    if (!supabase) return [];
    const { data } = await supabase
      .from("categories")
      .select("id, parent_id, name, icon, sort_order")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    return (data as Category[] | null) ?? [];
  },
  ["categories-tree"],
  { tags: [CATEGORIES_TAG], revalidate: CACHE_SECONDS },
);

/**
 * `cache` on top of the cached read is not belt and braces: the shell, the
 * page, its metadata and listBooks all ask for the tree in the same render,
 * and this collapses those four asks into one.
 */
export const getCategories = cache(
  async (): Promise<Category[]> => timed("categories", () => loadCategories()),
);

export async function getAdminCounts(): Promise<{ books: number; categories: number }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { books: 0, categories: 0 };
  const [books, categories] = await Promise.all([
    supabase.from("books").select("id", { count: "exact", head: true }),
    supabase.from("categories").select("id", { count: "exact", head: true }),
  ]);
  return { books: books.count ?? 0, categories: categories.count ?? 0 };
}

/**
 * How many published books sit in each category, before the tree is walked.
 *
 * One round trip for the whole library — a page of category_id values, tallied
 * here — rather than a counted query per category. At 42 books it is a few
 * kilobytes; at a few hundred it still is, and PostgREST's own row ceiling is
 * far above either.
 *
 * Tagged BOOKS_TAG, so every write the site itself makes drops it. A book
 * written STRAIGHT into Postgres — the migration script, a row typed into the
 * SQL editor — has no tag to drop, so a count can be up to CACHE_SECONDS out
 * of date. For a number beside a category name that is a fair trade; the shelf
 * it points at is uncached and always current.
 */
const loadDirectBookCounts = unstable_cache(
  async (): Promise<Record<number, number>> => {
    const supabase = cachedClient();
    if (!supabase) return {};
    const { data } = await supabase.from("books").select("category_id").eq("status", "published");
    const direct: Record<number, number> = {};
    for (const row of (data as { category_id: number | null }[] | null) ?? []) {
      if (row.category_id == null) continue;
      direct[row.category_id] = (direct[row.category_id] ?? 0) + 1;
    }
    return direct;
  },
  ["category-book-counts"],
  { tags: [BOOKS_TAG], revalidate: CACHE_SECONDS },
);

/**
 * The number shown beside every category, in the sidebar, the drawer and the
 * search box's scope picker. cache() so those three ask once between them.
 */
export const getCategoryCounts = cache(async (): Promise<Record<number, number>> => {
  const [categories, direct] = await Promise.all([
    getCategories(),
    timed("category-counts", () => loadDirectBookCounts()),
  ]);
  return rollUpCategoryCounts(categories, direct);
});
