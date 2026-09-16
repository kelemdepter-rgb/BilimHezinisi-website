import type { SupabaseClient } from "@supabase/supabase-js";
import { BATCH_PREFIX } from "../env";

/**
 * Remove every book whose title carries BATCH_PREFIX, Storage objects first.
 *
 * The batch-import spec and the upload-wizard spec both write REAL books into
 * the owner's library, and the wizard spec gives some of them a cover. A row
 * deleted with the service role takes its pages with it (they cascade) but
 * not its objects in Storage — so those are looked up and removed before the
 * rows go, or every interrupted run would leave a cover behind for good.
 */
export async function removePrefixedBooks(admin: SupabaseClient): Promise<void> {
  const { data } = await admin
    .from("books")
    .select("cover_path, original_file_path")
    .like("title", `${BATCH_PREFIX}%`);
  const rows = (data ?? []) as { cover_path: string | null; original_file_path: string | null }[];

  const covers = rows.map((row) => row.cover_path).filter((path): path is string => Boolean(path));
  const originals = rows
    .map((row) => row.original_file_path)
    .filter((path): path is string => Boolean(path));
  if (covers.length > 0) await admin.storage.from("covers").remove(covers);
  if (originals.length > 0) await admin.storage.from("book-files").remove(originals);

  await admin.from("books").delete().like("title", `${BATCH_PREFIX}%`);
}
