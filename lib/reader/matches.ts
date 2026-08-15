import type { MatchPage } from "@/lib/reader/pages";

/** One occurrence of the query, addressed the way the DOM addresses it. */
export type Occurrence = { pageNo: number; index: number };

/**
 * Flatten "page 3 has 2 hits, page 7 has 1" into the ordered list the
 * navigator steps through. The desktop keeps the same idea: one list for the
 * whole book, so «12/47» counts against every occurrence in it and not just
 * the ones on screen.
 */
export function flattenMatches(pages: MatchPage[]): Occurrence[] {
  return pages.flatMap((page) =>
    Array.from({ length: Math.max(0, page.hits) }, (_, index) => ({
      pageNo: page.page_no,
      index,
    })),
  );
}

/**
 * Where a given occurrence sits in the whole-book list — the desktop's
 * updateMatchNav, which counts the hits before a position to decide which one
 * it is looking at.
 *
 * `withinPage` selects between repeated identical words on the same page; a
 * value past the end of that page clamps to its last occurrence rather than
 * running into the next page's.
 */
export function positionOf(pages: MatchPage[], pageNo: number, withinPage: number): number {
  let before = 0;
  for (const page of pages) {
    if (page.page_no === pageNo) {
      const clamped = Math.min(Math.max(0, withinPage), Math.max(0, page.hits - 1));
      return before + clamped;
    }
    before += Math.max(0, page.hits);
  }
  return 0;
}

/** Step forward or back, wrapping at both ends like the desktop's jumpToMatch. */
export function stepPosition(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

/** Total occurrences across the book. */
export function countMatches(pages: MatchPage[]): number {
  return pages.reduce((sum, page) => sum + Math.max(0, page.hits), 0);
}
