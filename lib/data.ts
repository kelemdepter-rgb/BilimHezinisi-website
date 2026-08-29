import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CACHE_SECONDS, CATEGORIES_TAG, cachedClient } from "@/lib/cache";
import { timed } from "@/lib/perf/timing";
import type { Category, Role, SessionInfo } from "@/lib/types";

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await timed("layout.auth.getUser", () => supabase.auth.getUser());
  if (!user) return null;
  const { data: profile } = await timed("layout.profiles", async () =>
    supabase.from("profiles").select("role, display_name").eq("id", user.id).maybeSingle(),
  );
  const role: Role =
    profile?.role === "admin" || profile?.role === "uploader" ? profile.role : "reader";
  return {
    email: user.email ?? "",
    displayName: (profile?.display_name as string | null) || user.email || "",
    role,
  };
}

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
