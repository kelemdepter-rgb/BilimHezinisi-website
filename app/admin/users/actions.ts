"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/guards";
import { MSG, failureMessage, type ActionResult } from "@/lib/admin/messages";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

const ROLES: Role[] = ["reader", "uploader", "admin"];

export async function changeRoleAction(formData: FormData): Promise<ActionResult> {
  try {
    // Role management is admin-only, re-verified from the database.
    const actor = await requireAdmin();

    const userId = String(formData.get("user_id") ?? "");
    const nextRole = String(formData.get("role") ?? "") as Role;
    if (!userId || !ROLES.includes(nextRole)) return { ok: false, error: MSG.unknown };

    // Demoting yourself is how an owner accidentally locks themselves out.
    if (userId === actor.userId && nextRole !== "admin") {
      return { ok: false, error: MSG.selfDemote };
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, error: MSG.notConfigured };

    // Belt and braces: the database trigger also refuses to drop the last
    // admin, so this holds even if something bypasses the app.
    const { data: target } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (target?.role === "admin" && nextRole !== "admin") {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) return { ok: false, error: MSG.lastAdmin };
    }

    const { error } = await supabase.from("profiles").update({ role: nextRole }).eq("id", userId);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    revalidatePath("/admin/users");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
