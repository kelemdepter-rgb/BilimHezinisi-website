"use server";

import { revalidatePath } from "next/cache";
import { isForbidden, requireAdmin } from "@/lib/admin/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The inbox's own actions.
 *
 * Every one re-verifies the role from the database before it touches a row —
 * the /admin layout's guard decides what is RENDERED, and a Server Action is
 * reachable without ever rendering anything. RLS refuses these writes to a
 * non-admin as well; this is the second lock, not the only one.
 */

type Result = { ok: boolean; message?: string };

const FORBIDDEN = "بۇ ئىشنى قىلىش ھوقۇقىڭىز يوق.";
const FAILED = "ئىش ئادا بولمىدى. قايتا سىناڭ.";

async function withAdmin(run: (supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>) => Promise<Result>): Promise<Result> {
  try {
    await requireAdmin();
  } catch (error) {
    if (isForbidden(error)) return { ok: false, message: FORBIDDEN };
    return { ok: false, message: FAILED };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: FAILED };
  const result = await run(supabase);
  if (result.ok) revalidatePath("/admin/requests");
  return result;
}

function idOf(formData: FormData): number | null {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function setRequestHandledAction(formData: FormData): Promise<Result> {
  const id = idOf(formData);
  const handled = formData.get("handled") === "true";
  if (id === null) return { ok: false, message: FAILED };

  return withAdmin(async (supabase) => {
    const { error } = await supabase.from("book_requests").update({ handled }).eq("id", id);
    return error ? { ok: false, message: FAILED } : { ok: true };
  });
}

export async function deleteRequestAction(formData: FormData): Promise<Result> {
  const id = idOf(formData);
  if (id === null) return { ok: false, message: FAILED };

  return withAdmin(async (supabase) => {
    const { error } = await supabase.from("book_requests").delete().eq("id", id);
    return error ? { ok: false, message: FAILED } : { ok: true };
  });
}

/**
 * Empty out everything already dealt with.
 *
 * This is how the table is kept small enough never to matter to the 500 MB
 * budget — the daily and total caps in migration 0022 stop it growing, and
 * this is what gives the room back.
 */
export async function deleteHandledRequestsAction(): Promise<Result> {
  return withAdmin(async (supabase) => {
    const { error } = await supabase.from("book_requests").delete().eq("handled", true);
    return error ? { ok: false, message: FAILED } : { ok: true };
  });
}
