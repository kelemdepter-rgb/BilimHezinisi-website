import { createSupabaseBrowserClient, currentUserId } from "@/lib/supabase/client";

/**
 * Aya bookmarks for the signed-in reader. Book bookmarks live in `bookmarks`
 * (book_id NOT NULL); Quran bookmarks are addressed by sura + aya, so they
 * get their own table (migration 0007) and leave the book side untouched.
 * Anonymous visitors never reach these — everything else on /quran works
 * without an account.
 */

export async function addQuranBookmark(sura: number, aya: number): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("quran_bookmarks")
    .upsert({ user_id: userId, sura, aya }, { onConflict: "user_id,sura,aya" });
  if (error) throw new Error(error.message);
}

export async function removeQuranBookmark(sura: number, aya: number): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("quran_bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("sura", sura)
    .eq("aya", aya);
  if (error) throw new Error(error.message);
}
