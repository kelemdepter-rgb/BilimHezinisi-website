import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category, Role, SessionInfo } from "@/lib/types";

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .maybeSingle();
  const role: Role =
    profile?.role === "admin" || profile?.role === "uploader" ? profile.role : "reader";
  return {
    email: user.email ?? "",
    displayName: (profile?.display_name as string | null) || user.email || "",
    role,
  };
}

export async function getCategories(): Promise<Category[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("categories")
    .select("id, parent_id, name, icon, sort_order")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  return (data as Category[] | null) ?? [];
}

export async function getAdminCounts(): Promise<{ books: number; categories: number }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { books: 0, categories: 0 };
  const [books, categories] = await Promise.all([
    supabase.from("books").select("id", { count: "exact", head: true }),
    supabase.from("categories").select("id", { count: "exact", head: true }),
  ]);
  return { books: books.count ?? 0, categories: categories.count ?? 0 };
}
