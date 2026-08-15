import { describe, expect, it } from "vitest";
import {
  countMatches,
  flattenMatches,
  positionOf,
  stepPosition,
} from "@/lib/reader/matches";
import { findMatches } from "@/lib/reader/highlight";

describe("flattenMatches", () => {
  it("expands per-page counts into one ordered list for the whole book", () => {
    expect(flattenMatches([{ page_no: 3, hits: 2 }, { page_no: 7, hits: 1 }])).toEqual([
      { pageNo: 3, index: 0 },
      { pageNo: 3, index: 1 },
      { pageNo: 7, index: 0 },
    ]);
  });

  it("ignores pages that carry nothing", () => {
    expect(flattenMatches([{ page_no: 1, hits: 0 }, { page_no: 2, hits: 1 }])).toEqual([
      { pageNo: 2, index: 0 },
    ]);
    expect(flattenMatches([])).toEqual([]);
  });
});

describe("positionOf", () => {
  const pages = [
    { page_no: 3, hits: 2 },
    { page_no: 7, hits: 3 },
    { page_no: 9, hits: 1 },
  ];

  it("counts the occurrences before the page, like the desktop's updateMatchNav", () => {
    expect(positionOf(pages, 3, 0)).toBe(0);
    expect(positionOf(pages, 7, 0)).toBe(2);
    expect(positionOf(pages, 9, 0)).toBe(5);
  });

  it("picks between repeated identical words on the same page", () => {
    // The whole point of carrying an offset: page 7 holds the same word three
    // times and the result has to land on the right one.
    expect(positionOf(pages, 7, 0)).toBe(2);
    expect(positionOf(pages, 7, 1)).toBe(3);
    expect(positionOf(pages, 7, 2)).toBe(4);
  });

  it("clamps an offset past the end of its page instead of spilling into the next", () => {
    expect(positionOf(pages, 3, 99)).toBe(1);
    expect(positionOf(pages, 7, 99)).toBe(4);
  });

  it("falls back to the first match for a page with no hits", () => {
    expect(positionOf(pages, 42, 0)).toBe(0);
  });
});

describe("stepPosition", () => {
  it("wraps at both ends, like jumpToMatch", () => {
    expect(stepPosition(0, 1, 3)).toBe(1);
    expect(stepPosition(2, 1, 3)).toBe(0);
    expect(stepPosition(0, -1, 3)).toBe(2);
    expect(stepPosition(1, -1, 3)).toBe(0);
  });

  it("stays put when there is nothing to step through", () => {
    expect(stepPosition(0, 1, 0)).toBe(0);
    expect(stepPosition(0, -1, 0)).toBe(0);
  });
});

describe("countMatches", () => {
  it("totals the book, which is what the counter's denominator shows", () => {
    expect(countMatches([{ page_no: 1, hits: 4 }, { page_no: 2, hits: 3 }])).toBe(7);
    expect(countMatches([])).toBe(0);
  });
});

describe("occurrence numbering agrees with what the reader renders", () => {
  /**
   * The database counts occurrences per page; the reader numbers the <mark>
   * elements it draws. If those two disagree, «3/17» points at the wrong word.
   * Both sides normalize, so this checks them against the same text.
   */
  it("counts repeated identical words the same way the page marks them", () => {
    const page = "ناماز ۋە ناماز، يەنە ناماز.";
    const rendered = findMatches(page, "ناماز");
    expect(rendered).toHaveLength(3);

    const pages = [{ page_no: 5, hits: rendered.length }];
    expect(countMatches(pages)).toBe(3);
    expect(positionOf(pages, 5, 2)).toBe(2);
    expect(flattenMatches(pages).at(-1)).toEqual({ pageNo: 5, index: 2 });
  });

  it("still agrees when the text carries diacritics the query omits", () => {
    const page = "ٱلْحَمْدُ ... ٱلْحَمْدُ";
    const rendered = findMatches(page, "الحمد");
    expect(rendered).toHaveLength(2);
    expect(countMatches([{ page_no: 1, hits: rendered.length }])).toBe(2);
  });
});
