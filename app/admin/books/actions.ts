"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/guards";
import { MSG, failureMessage, type ActionResult } from "@/lib/admin/messages";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("NOT_CONFIGURED");
  return supabase;
}

function parseIds(formData: FormData): number[] {
  return formData
    .getAll("ids")
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export async function updateBookAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireStaff();
    const id = Number(formData.get("id"));
    const title = String(formData.get("title") ?? "").trim();
    if (!id) return { ok: false, error: MSG.bookNotFound };
    if (!title) return { ok: false, error: MSG.nameRequired };

    const categoryRaw = String(formData.get("category_id") ?? "");
    const status = String(formData.get("status") ?? "draft");

    const supabase = await client();
    const { error } = await supabase
      .from("books")
      .update({
        title,
        author: String(formData.get("author") ?? "").trim(),
        category_id: categoryRaw ? Number(categoryRaw) : null,
        date: String(formData.get("date") ?? "").trim(),
        description: String(formData.get("description") ?? "").trim(),
        language: String(formData.get("language") ?? "ug"),
        status: status === "published" ? "published" : "draft",
      })
      .eq("id", id);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidatePath("/admin/books");
    revalidatePath("/");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Delete books and their Storage objects. Pages cascade at the database
 * level; the bucket objects have to be removed explicitly.
 */
export async function deleteBooksAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireStaff();
    const ids = parseIds(formData);
    if (ids.length === 0) return { ok: false, error: MSG.bookNotFound };

    const supabase = await client();
    const { data: rows } = await supabase
      .from("books")
      .select("id, cover_path, original_file_path")
      .in("id", ids);

    const covers = (rows ?? []).map((r) => r.cover_path).filter(Boolean) as string[];
    const originals = (rows ?? []).map((r) => r.original_file_path).filter(Boolean) as string[];
    if (covers.length) await supabase.storage.from("covers").remove(covers);
    if (originals.length) await supabase.storage.from("book-files").remove(originals);

    const { error } = await supabase.from("books").delete().in("id", ids);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidatePath("/admin/books");
    revalidatePath("/");
    return { ok: true, message: MSG.deleted };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function bulkStatusAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireStaff();
    const ids = parseIds(formData);
    if (ids.length === 0) return { ok: false, error: MSG.bookNotFound };
    const status = String(formData.get("status") ?? "draft") === "published" ? "published" : "draft";

    const supabase = await client();
    const { error } = await supabase.from("books").update({ status }).in("id", ids);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidatePath("/admin/books");
    revalidatePath("/");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function bulkMoveCategoryAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireStaff();
    const ids = parseIds(formData);
    if (ids.length === 0) return { ok: false, error: MSG.bookNotFound };
    const categoryRaw = String(formData.get("category_id") ?? "");

    const supabase = await client();
    const { error } = await supabase
      .from("books")
      .update({ category_id: categoryRaw ? Number(categoryRaw) : null })
      .in("id", ids);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidatePath("/admin/books");
    revalidatePath("/");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
