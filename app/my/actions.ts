"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/admin/messages";

/**
 * Delete one of the caller's own annotations. RLS already restricts these
 * tables to their owner; the explicit user check is a second gate so a
 * mistyped id can never touch someone else's row.
 */
const TABLES: Record<string, string> = {
  bookmark: "bookmarks",
  note: "book_notes",
  "quran-bookmark": "quran_bookmarks",
};

export async function deleteMyAnnotationAction(formData: FormData): Promise<ActionResult> {
  const kind = String(formData.get("kind") ?? "");
  const id = Number(formData.get("id"));
  const table = TABLES[kind];
  if (!table || !Number.isInteger(id)) {
    return { ok: false, error: "مەشغۇلات مەغلۇپ بولدى." };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: "سايت ساندانغا ئۇلانمىغان." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ھېساباتقا كىرىشىڭىز كېرەك." };

  const { error } = await supabase.from(table).delete().eq("id", id).eq("user_id", user.id);
  if (error) return { ok: false, error: "ئۆچۈرگىلى بولمىدى." };

  revalidatePath("/my/bookmarks");
  revalidatePath("/my/notes");
  return { ok: true, message: "ئۆچۈرۈلدى." };
}
