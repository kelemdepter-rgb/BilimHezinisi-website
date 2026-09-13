import { describe, expect, it } from "vitest";
import {
  MATCH_PAGE_LIMIT,
  batches,
  listFallsShort,
  matchPagesCapped,
  planMatchList,
  type MatchPage,
} from "@/lib/search/book-matches";
import { countMatches } from "@/lib/reader/matches";

/** The expander's ceiling, as app/search-actions.ts sets it. */
const MAX_MATCHES = 200;

/** `count` pages in order, each carrying `hits` occurrences. */
function pagesOf(count: number, hits: number): MatchPage[] {
  return Array.from({ length: count }, (_, index) => ({ page_no: index + 1, hits }));
}

describe("planMatchList", () => {
  it("stops reading pages once 200 occurrences are planned, but sums the whole book", () => {
    // 300 pages of one hit: the list needs the first 200 pages and no more.
    const plan = planMatchList(pagesOf(300, 1), MAX_MATCHES);
    expect(plan.pageNos).toHaveLength(200);
    expect(plan.pageNos[0]).toBe(1);
    expect(plan.pageNos.at(-1)).toBe(200);
    expect(plan.total).toBe(300);
  });

  it("keeps the page that carries the list past the limit, whole", () => {
    // 199 planned, then a page of five: the page is read, the caller stops in it.
    const pages = [...pagesOf(199, 1), { page_no: 200, hits: 5 }, { page_no: 201, hits: 1 }];
    const plan = planMatchList(pages, MAX_MATCHES);
    expect(plan.pageNos).toHaveLength(200);
    expect(plan.pageNos.at(-1)).toBe(200);
    expect(plan.total).toBe(205);
  });

  it("reads every page of a book that fits within the limit", () => {
    const plan = planMatchList(pagesOf(150, 1), MAX_MATCHES);
    expect(plan.pageNos).toHaveLength(150);
    expect(plan.total).toBe(150);
  });

  it("totals the book exactly as the reader's counter does", () => {
    const pages: MatchPage[] = [
      { page_no: 3, hits: 2 },
      { page_no: 7, hits: 3 },
      { page_no: 9, hits: 1 },
    ];
    expect(planMatchList(pages, MAX_MATCHES).total).toBe(countMatches(pages));
  });

  it("walks the pages in the order they were given and skips empty ones", () => {
    const plan = planMatchList(
      [
        { page_no: 4, hits: 1 },
        { page_no: 5, hits: 0 },
        { page_no: 12, hits: 2 },
      ],
      MAX_MATCHES,
    );
    expect(plan.pageNos).toEqual([4, 12]);
    expect(plan.total).toBe(3);
  });

  it("has nothing to read for a book that carries nothing", () => {
    expect(planMatchList([], MAX_MATCHES)).toEqual({ pageNos: [], total: 0 });
  });
});

describe("listFallsShort", () => {
  it("is set when the book holds more than the list", () => {
    expect(listFallsShort(300, 200, false)).toBe(true);
  });

  it("is set when the total is only a floor — book_match_pages returned its full quota", () => {
    expect(listFallsShort(200, 200, true)).toBe(true);
  });

  it("is clear for a book with 150 matching pages of one hit each: all 150 are listed", () => {
    const pages = pagesOf(150, 1);
    const { pageNos, total } = planMatchList(pages, MAX_MATCHES);
    expect(pageNos).toHaveLength(150);
    expect(listFallsShort(total, 150, matchPagesCapped(pages))).toBe(false);
  });
});

describe("matchPagesCapped", () => {
  it("flips only when the function returned its full 500 pages", () => {
    expect(matchPagesCapped(pagesOf(MATCH_PAGE_LIMIT - 1, 1))).toBe(false);
    expect(matchPagesCapped(pagesOf(MATCH_PAGE_LIMIT, 1))).toBe(true);
  });
});

describe("batches", () => {
  it("splits page numbers into runs of at most the batch size, in order", () => {
    const numbers = Array.from({ length: 205 }, (_, index) => index + 1);
    const runs = batches(numbers, 100);
    expect(runs.map((run) => run.length)).toEqual([100, 100, 5]);
    expect(runs.flat()).toEqual(numbers);
  });

  it("has no batch for no pages", () => {
    expect(batches([], 100)).toEqual([]);
  });
});
