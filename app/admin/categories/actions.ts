"use server";

import { revalidatePath } from "next/cache";
import { revalidateCategories } from "@/lib/cache";
import { requireStaff } from "@/lib/admin/guards";
import { MSG, failureMessage, type ActionResult } from "@/lib/admin/messages";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CategoryRow = { id: number; parent_id: number | null };

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("NOT_CONFIGURED");
  return supabase;
}

/** All descendants of `id`, used to block moving a category under itself. */
function collectDescendants(rows: CategoryRow[], id: number): Set<number> {
  const byParent = new Map<number | null, number[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parent_id) ?? [];
    siblings.push(row.id);
    byParent.set(row.parent_id, siblings);
  }
  const out = new Set<number>();
  const walk = (parent: number) => {
    for (const child of byParent.get(parent) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}

export async function createCategoryAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireStaff();
    const name = String(formData.get("name") ?? "").trim();
    const icon = String(formData.get("icon") ?? "folder").trim() || "folder";
    const parentRaw = String(formData.get("parent_id") ?? "");
    const parentId = parentRaw ? Number(parentRaw) : null;
    if (!name) return { ok: false, error: MSG.nameRequired };

    const supabase = await client();
    const { data: maxRow } = await supabase
      .from("categories")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("categories").insert({
      name,
      icon,
      parent_id: parentId,
      sort_order: (maxRow?.sort_order ?? 0) + 1,
    });
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidateCategories();
    revalidatePath("/admin/categories");
    revalidatePath("/", "layout");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateCategoryAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireStaff();
    const id = Number(formData.get("id"));
    const name = String(formData.get("name") ?? "").trim();
    const icon = String(formData.get("icon") ?? "folder").trim() || "folder";
    if (!id) return { ok: false, error: MSG.unknown };
    if (!name) return { ok: false, error: MSG.nameRequired };

    const supabase = await client();
    const { error } = await supabase.from("categories").update({ name, icon }).eq("id", id);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidateCategories();
    revalidatePath("/admin/categories");
    revalidatePath("/", "layout");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deleteCategoryAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireStaff();
    const id = Number(formData.get("id"));
    if (!id) return { ok: false, error: MSG.unknown };
    const supabase = await client();

    // Refuse while the category still holds children or books, so nothing is
    // silently cascaded away.
    const [{ count: childCount }, { count: bookCount }] = await Promise.all([
      supabase.from("categories").select("id", { count: "exact", head: true }).eq("parent_id", id),
      supabase.from("books").select("id", { count: "exact", head: true }).eq("category_id", id),
    ]);
    if ((childCount ?? 0) > 0) return { ok: false, error: MSG.categoryHasChildren };
    if ((bookCount ?? 0) > 0) return { ok: false, error: MSG.categoryHasBooks(bookCount ?? 0) };

    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidateCategories();
    revalidatePath("/admin/categories");
    revalidatePath("/", "layout");
    return { ok: true, message: MSG.deleted };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Persist a whole reordered/re-parented tree in one call — used by both
 * drag-and-drop and the button fallback, so they cannot drift apart.
 */
export async function reorderCategoriesAction(
  moves: { id: number; parent_id: number | null; sort_order: number }[],
): Promise<ActionResult> {
  try {
    await requireStaff();
    if (!Array.isArray(moves) || moves.length === 0) return { ok: true };

    const supabase = await client();
    const { data: allRows } = await supabase.from("categories").select("id, parent_id");
    const rows = (allRows as CategoryRow[] | null) ?? [];

    // Reject any move that would put a category inside its own subtree.
    for (const move of moves) {
      if (move.parent_id === null) continue;
      if (move.parent_id === move.id) return { ok: false, error: MSG.categoryOwnParent };
      if (collectDescendants(rows, move.id).has(move.parent_id)) {
        return { ok: false, error: MSG.categoryOwnParent };
      }
    }

    for (const move of moves) {
      const { error } = await supabase
        .from("categories")
        .update({ parent_id: move.parent_id, sort_order: move.sort_order })
        .eq("id", move.id);
      if (error) return { ok: false, error: failureMessage(new Error(error.message)) };
    }

    revalidateCategories();
    revalidatePath("/admin/categories");
    revalidatePath("/", "layout");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
