import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reportServerError } from "@/lib/server-log";

export type SearchHit = {
  book_id: number;
  title: string;
  author: string;
  cover_path: string | null;
  page_no: number;
  snippet: string;
  rank: number;
  /** True when the word matched more pages than the RPC is willing to rank. */
  capped?: boolean;
};

/**
 * Why a search failed, when it did. A timeout is the database giving up at
 * the statement timeout of the caller's role (3 s for an anonymous visitor)
 * — the failure a reader can do something about, by narrowing the search.
 */
export type SearchFailure = "timeout" | "error" | null;

export type SearchOutcome = {
  hits: SearchHit[];
  elapsedMs: number;
  failed: boolean;
  failure: SearchFailure;
  moreAvailable: boolean;
  /**
   * The query matched more pages than search_books ranks (migration 0014), so
   * these are the best of an early slice rather than of everything. The page
   * says so and suggests a second word.
   */
  tooCommon: boolean;
};

/** Postgres's SQLSTATE for "canceling statement due to statement timeout". */
const STATEMENT_TIMEOUT = "57014";

/**
 * Run the existing `search_books` RPC (migration 0001). Lives outside the page
 * component so timing the call does not break the render-purity rule.
 *
 * Asks for one row beyond the page size to know whether a next page exists,
 * which avoids a second counting query.
 */
/**
 * Ceilings applied here, not only in the UI — the query string is a visitor's.
 * The offset ceiling matches the 300 candidate pages search_books ranks
 * (migration 0014); past that there is nothing left to page into.
 */
const MAX_LIMIT = 50;
const MAX_OFFSET = 300;

export async function runBookSearch(input: {
  query: string;
  categoryId: number | null;
  limit: number;
  offset: number;
}): Promise<SearchOutcome> {
  const empty: SearchOutcome = {
    hits: [],
    elapsedMs: 0,
    failed: false,
    failure: null,
    moreAvailable: false,
    tooCommon: false,
  };
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

  let failure: SearchFailure = null;
  if (error) {
    failure = error.code === STATEMENT_TIMEOUT ? "timeout" : "error";
    // The code, the time and the scope — never the words. What a reader types
    // is not inspected or logged anywhere on this site (PROMPT-29), and the
    // database's message for anything but a timeout can quote the input, so
    // it is left out too. This line is what a whole-library search failing
    // for every visitor (2026-09-11) was missing.
    reportServerError(
      `search_books ${failure} after ${elapsedMs} ms (${input.categoryId === null ? "whole library" : "one category"})`,
      { code: error.code, message: failure === "timeout" ? "statement timeout" : "rpc error" },
    );
  }

  const rows = (data as SearchHit[] | null) ?? [];
  return {
    hits: rows.slice(0, limit),
    elapsedMs,
    failed: Boolean(error),
    failure,
    moreAvailable: rows.length > limit,
    // Every row carries the same flag, so the first one answers for all.
    tooCommon: Boolean(rows[0]?.capped),
  };
}
