"use server";

import { requireStaff } from "@/lib/admin/guards";
import { failureMessage, type ActionResult } from "@/lib/admin/messages";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FREE_DB_BYTES, SAFE_DB_RATIO, getPageStorageStats } from "@/lib/usage";

/**
 * Server-side support for the batch import: what the database costs, and what
 * a half-finished import left behind.
 *
 * Both re-verify the role on every call, like everything else under /admin —
 * the client is never trusted to have checked.
 */

export type ImportHeadroom = {
  available: boolean;
  dbBytes: number;
  limitBytes: number;
  /** Measured cost of one stored page — see lib/usage.ts. */
  bytesPerPage: number;
  /** Bytes at which the free plan stops being comfortable. */
  safeBytes: number;
};

const UNAVAILABLE: ImportHeadroom = {
  available: false,
  dbBytes: 0,
  limitBytes: FREE_DB_BYTES,
  bytesPerPage: 0,
  safeBytes: FREE_DB_BYTES * SAFE_DB_RATIO,
};

/**
 * How much room is left, and what a page costs.
 *
 * Called before an import to estimate, and again after it to report what the
 * batch actually cost — the difference between the two is the honest answer to
 * "was the estimate right", which is the only way the estimate ever improves.
 */
export async function getImportHeadroomAction(): Promise<ImportHeadroom> {
  try {
    await requireStaff();
    const stats = await getPageStorageStats();
    if (!stats.available) return UNAVAILABLE;
    return {
      available: true,
      dbBytes: stats.dbBytes,
      limitBytes: FREE_DB_BYTES,
      bytesPerPage: stats.bytesPerPage,
      safeBytes: FREE_DB_BYTES * SAFE_DB_RATIO,
    };
  } catch {
    return UNAVAILABLE;
  }
}

export type IncompleteBook = {
  id: number;
  title: string;
  expectedPages: number;
  actualPages: number;
  createdAt: string;
};

/** Only drafts can be incomplete — the importer publishes nothing unverified. */
const MAX_DRAFTS_CHECKED = 60;

/**
 * Drafts whose stored pages do not match what they claim.
 *
 * A batch import writes a book as a draft, inserts its pages, checks the count
 * and only then applies the status the admin chose. So a tab closed mid-run
 * leaves a draft with too few pages and nothing published or broken — but it
 * does leave something, and the admin needs to be able to find and remove it
 * without going through the whole library by hand.
 */
export async function findIncompleteBooksAction(): Promise<
  ActionResult & { books?: IncompleteBook[] }
> {
  try {
    await requireStaff();
    const supabase = createSupabaseAdminClient();
    if (!supabase) return { ok: false, error: "ساندان ئۇلانمىغان." };

    const { data: drafts, error } = await supabase
      .from("books")
      .select("id, title, page_count, created_at")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(MAX_DRAFTS_CHECKED);
    if (error) return { ok: false, error: failureMessage(new Error(error.message)) };

    type Draft = { id: number; title: string; page_count: number; created_at: string };
    const rows = (drafts as Draft[] | null) ?? [];
    if (rows.length === 0) return { ok: true, books: [] };

    // One round trip for every draft's pages, counted here rather than with a
    // query per book — PostgREST cannot group, and this stays small because
    // only drafts are ever checked.
    const ids = rows.map((row) => row.id);
    const { data: pages } = await supabase.from("book_pages").select("book_id").in("book_id", ids);

    const counted = new Map<number, number>();
    for (const page of ((pages as { book_id: number }[] | null) ?? [])) {
      counted.set(page.book_id, (counted.get(page.book_id) ?? 0) + 1);
    }

    const books: IncompleteBook[] = [];
    for (const row of rows) {
      const actual = counted.get(row.id) ?? 0;
      const expected = row.page_count ?? 0;
      // A draft written by hand in the editor has no pages and claims none;
      // that is a book somebody is still working on, not a wreck.
      if (expected > 0 && actual >= expected) continue;
      if (expected === 0 && actual === 0) continue;
      books.push({
        id: row.id,
        title: row.title,
        expectedPages: expected,
        actualPages: actual,
        createdAt: row.created_at,
      });
    }

    return { ok: true, books };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
