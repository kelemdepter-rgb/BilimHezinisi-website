/**
 * The arithmetic behind «بۇ كىتابتىكى بارلىق ئورۇنلارنى كۆرۈش» — which pages
 * the expander has to read, and how its count relates to the book — kept
 * free of the database so it can be held to the reader's counter in a test.
 *
 * The expander and the reader's ↑ ↓ navigator start from the SAME answer:
 * `book_match_pages`, every page of one book that carries the phrase, in
 * order, with the number of occurrences on each. Before this module the
 * expander narrowed the pages with a raw `ilike` on the stored text, which
 * knows nothing of tatweel or diacritics — so a word written stretched
 * («ـ», on half the library's pages) was found by search and answered
 * «باشقا ئورۇن تېپىلمىدى» directly beneath the result (PROMPT-34).
 */

/** One page of the book that carries the phrase, and how often. */
export type MatchPage = { page_no: number; hits: number };

/**
 * How many matching pages `book_match_pages` is asked for. Past this the
 * total is a floor, which both the navigator and the expander mark with «+».
 */
export const MATCH_PAGE_LIMIT = 500;

/** Whether the function returned its full quota — the total is then a floor. */
export function matchPagesCapped(pages: MatchPage[]): boolean {
  return pages.length >= MATCH_PAGE_LIMIT;
}

export type MatchListPlan = {
  /** The pages whose text is needed, in order — just enough to reach `limit`. */
  pageNos: number[];
  /** Every occurrence in the book: the reader's denominator. */
  total: number;
};

/**
 * Walk the matching pages in order and keep only as many as it takes to
 * reach `limit` occurrences, while still summing the whole book. The last
 * page kept may carry the list past the limit; the caller stops within it.
 */
export function planMatchList(pages: MatchPage[], limit: number): MatchListPlan {
  const pageNos: number[] = [];
  let total = 0;
  let planned = 0;
  for (const page of pages) {
    const hits = Math.max(0, page.hits);
    if (hits === 0) continue;
    total += hits;
    if (planned < limit) {
      pageNos.push(page.page_no);
      planned += hits;
    }
  }
  return { pageNos, total };
}

/**
 * Whether the list falls short of the book: occurrences beyond the ones
 * listed, or a total that is itself only a floor.
 */
export function listFallsShort(total: number, listed: number, capped: boolean): boolean {
  return capped || total > listed;
}

/** Page numbers in runs of at most `size`, so an `in` filter stays a short URL. */
export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let from = 0; from < items.length; from += size) {
    out.push(items.slice(from, from + size));
  }
  return out;
}
