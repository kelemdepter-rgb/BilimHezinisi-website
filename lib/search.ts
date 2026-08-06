import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SearchHit = {
  book_id: number;
  title: string;
  author: string;
  cover_path: string | null;
  page_no: number;
  snippet: string;
  rank: number;
};

export type SearchOutcome = {
  hits: SearchHit[];
  elapsedMs: number;
  failed: boolean;
  moreAvailable: boolean;
};

/**
 * Run the existing `search_books` RPC (migration 0001). Lives outside the page
 * component so timing the call does not break the render-purity rule.
 *
 * Asks for one row beyond the page size to know whether a next page exists,
 * which avoids a second counting query.
 */
export async function runBookSearch(input: {
  query: string;
  categoryId: number | null;
  limit: number;
  offset: number;
}): Promise<SearchOutcome> {
  const empty: SearchOutcome = { hits: [], elapsedMs: 0, failed: false, moreAvailable: false };
  if (!input.query) return empty;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return empty;

  const started = Date.now();
  const { data, error } = await supabase.rpc("search_books", {
    q: input.query,
    category_id: input.categoryId,
    lim: input.limit + 1,
    off: input.offset,
  });
  const elapsedMs = Date.now() - started;

  const rows = (data as SearchHit[] | null) ?? [];
  return {
    hits: rows.slice(0, input.limit),
    elapsedMs,
    failed: Boolean(error),
    moreAvailable: rows.length > input.limit,
  };
}
