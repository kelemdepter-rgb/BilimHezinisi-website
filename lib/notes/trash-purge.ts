import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * At most this many notes go per daily run; a bigger backlog is taken over
 * the following days. purge_note_trash (migration 0031) deletes the oldest
 * first.
 */
export const TRASH_PURGE_LIMIT = 500;

/**
 * Delete, for every account, the notes that have been in the trash longer
 * than 30 days — run by /api/health once a day, on the production deployment
 * only. Returns how many went, or null when it did not run. Only that number
 * is ever logged: never a title, a text or an account.
 */
export async function purgeNoteTrash(): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("purge_note_trash", { p_limit: TRASH_PURGE_LIMIT });
  if (error) {
    console.error(`[notes] trash purge failed: code=${error.code ?? "?"}`);
    return null;
  }
  const purged = typeof data === "number" ? data : 0;
  console.log(`[notes] trash purge deleted ${purged} note(s)`);
  return purged;
}
