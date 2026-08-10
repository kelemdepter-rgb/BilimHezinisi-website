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
/** Ceilings applied here, not only in the UI — the query string is a visitor's. */
const MAX_LIMIT = 50;
const MAX_OFFSET = 1000;

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

  const limit = Math.min(Math.max(1, Math.floor(input.limit)), MAX_LIMIT);
  const offset = Math.min(Math.max(0, Math.floor(input.offset)), MAX_OFFSET);

  const started = Date.now();
  const { data, error } = await supabase.rpc("search_books", {
    q: input.query,
    category_id: input.categoryId,
    lim: limit + 1,
    off: offset,
  });
  const elapsedMs = Date.now() - started;

  const rows = (data as SearchHit[] | null) ?? [];
  return {
    hits: rows.slice(0, limit),
    elapsedMs,
    failed: Boolean(error),
    moreAvailable: rows.length > limit,
  };
}
