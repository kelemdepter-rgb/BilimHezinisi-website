import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const FREE_DB_BYTES = 500 * 1024 * 1024;
export const FREE_STORAGE_BYTES = 1024 * 1024 * 1024;

/**
 * The share of the free plan past which the database stops being comfortable.
 * The same 85% `levelFor` already calls critical, so a batch import that would
 * cross it warns with the same number the dashboard shows.
 */
export const SAFE_DB_RATIO = 0.85;

export type UsageLevel = "normal" | "warning" | "critical";

export type UsageReport = {
  available: boolean;
  dbBytes: number;
  storageBytes: number;
  books: number;
  pages: number;
  /** Whole-database bytes charged per book — the honest capacity figure. */
  bytesPerBook: number;
  remainingBooks: number;
  dbLevel: UsageLevel;
  storageLevel: UsageLevel;
  lastPing: string | null;
};

/**
 * What a page of a book actually costs, measured rather than assumed.
 *
 * A batch import has to be able to say "this will add about 6 MB and you have
 * 380 MB left" BEFORE it writes anything, and a made-up multiplier would say it
 * wrong in whichever direction was convenient. The honest number is the one the
 * database already knows: the whole size of book_pages, including its indexes
 * and its search vector, divided by the rows in it.
 *
 * Service role, because RLS would hide every unpublished page from the count
 * and make each page look more expensive than it is.
 */
export type PageStorageStats = {
  available: boolean;
  dbBytes: number;
  pageRows: number;
  pageBytes: number;
  /** Whole bytes charged per stored page. 0 when there is nothing to measure. */
  bytesPerPage: number;
};

export async function getPageStorageStats(): Promise<PageStorageStats> {
  const empty: PageStorageStats = {
    available: false,
    dbBytes: 0,
    pageRows: 0,
    pageBytes: 0,
    bytesPerPage: 0,
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) return empty;

  const [{ data: dbBytes, error }, sizes, pages] = await Promise.all([
    supabase.rpc("db_total_size"),
    supabase.rpc("db_size_stats"),
    supabase.from("book_pages").select("book_id", { count: "exact", head: true }),
  ]);
  if (error) return empty;

  type SizeRow = { table_name: string; total_bytes: number };
  const pageTable = ((sizes.data as SizeRow[] | null) ?? []).find(
    (row) => row.table_name === "book_pages",
  );
  const pageBytes = Number(pageTable?.total_bytes ?? 0);
  const pageRows = pages.count ?? 0;

  return {
    available: true,
    dbBytes: Number(dbBytes ?? 0),
    pageRows,
    pageBytes,
    bytesPerPage: pageRows > 0 ? pageBytes / pageRows : 0,
  };
}

function levelFor(used: number, limit: number): UsageLevel {
  const ratio = used / limit;
  if (ratio >= 0.85) return "critical";
  if (ratio >= 0.7) return "warning";
  return "normal";
}

/**
 * Free-tier usage for the admin dashboard. Uses the service role because the
 * size functions read catalog tables; the caller must already have checked
 * that the visitor is an admin.
 */
export async function getUsageReport(): Promise<UsageReport> {
  const empty: UsageReport = {
    available: false,
    dbBytes: 0,
    storageBytes: 0,
    books: 0,
    pages: 0,
    bytesPerBook: 0,
    remainingBooks: 0,
    dbLevel: "normal",
    storageLevel: "normal",
    lastPing: null,
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) return empty;

  const [{ data: dbBytes, error }, books, pages, ping] = await Promise.all([
    supabase.rpc("db_total_size"),
    supabase.from("books").select("id", { count: "exact", head: true }),
    supabase.from("book_pages").select("book_id", { count: "exact", head: true }),
    supabase.from("settings").select("value").eq("key", "last_health_ping").maybeSingle(),
  ]);
  // The size RPCs arrive with migration 0005; before that the panel simply
  // reports itself unavailable rather than showing invented numbers.
  if (error) return empty;

  let storageBytes = 0;
  const { data: buckets } = await supabase.storage.listBuckets();
  for (const bucket of buckets ?? []) {
    const { data: top } = await supabase.storage.from(bucket.id).list("", { limit: 1000 });
    for (const entry of top ?? []) {
      if (entry.id) {
        storageBytes += Number(entry.metadata?.size ?? 0);
        continue;
      }
      const { data: inner } = await supabase.storage
        .from(bucket.id)
        .list(entry.name, { limit: 1000 });
      for (const file of inner ?? []) storageBytes += Number(file.metadata?.size ?? 0);
    }
  }

  const bookCount = books.count ?? 0;
  const total = Number(dbBytes ?? 0);
  const bytesPerBook = bookCount > 0 ? total / bookCount : 0;
  const remainingBooks =
    bytesPerBook > 0 ? Math.max(0, Math.floor((FREE_DB_BYTES - total) / bytesPerBook)) : 0;

  return {
    available: true,
    dbBytes: total,
    storageBytes,
    books: bookCount,
    pages: pages.count ?? 0,
    bytesPerBook,
    remainingBooks,
    dbLevel: levelFor(total, FREE_DB_BYTES),
    storageLevel: levelFor(storageBytes, FREE_STORAGE_BYTES),
    lastPing: (ping.data?.value as string | null) ?? null,
  };
}
