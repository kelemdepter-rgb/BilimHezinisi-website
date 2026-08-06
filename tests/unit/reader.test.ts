import { describe, expect, it } from "vitest";
import {
  findMatches,
  highlightTermsFromQuery,
  parseMarkedSnippet,
  toSegments,
} from "@/lib/reader/highlight";
import {
  clampPosition,
  initialPageWindow,
  parseStoredPosition,
  shouldRestore,
} from "@/lib/reader/position";

describe("findMatches", () => {
  it("finds a plain Uyghur term", () => {
    const text = "بۇ كىتاب بىلىم ھەققىدە. بىلىم كۈچتۇر.";
    const matches = findMatches(text, "بىلىم");
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(text.slice(match.start, match.end)).toBe("بىلىم");
    }
  });

  it("keeps ى and ي distinct, matching the SQL normalizer", () => {
    // ى (U+0649) is the Uyghur vowel "i" and must not match ي (U+064A).
    expect(findMatches("تىل", "تيل")).toHaveLength(0);
    expect(findMatches("تىل", "تىل")).toHaveLength(1);
  });

  it("matches across Arabic diacritics without shifting offsets", () => {
    const text = "أَلْكِتَابُ جميل";
    const matches = findMatches(text, "الكتاب");
    expect(matches).toHaveLength(1);
    // The slice must cover the original, diacritic-carrying word.
    const slice = text.slice(matches[0].start, matches[0].end);
    expect(slice.startsWith("أ")).toBe(true);
    expect(slice).toContain("ب");
  });

  it("unifies alif variants like the database does", () => {
    expect(findMatches("آية", "اية")).toHaveLength(1);
    expect(findMatches("إسلام", "اسلام")).toHaveLength(1);
  });

  it("treats runs of whitespace as one space", () => {
    expect(findMatches("بىلىم    خەزىنىسى", "بىلىم خەزىنىسى")).toHaveLength(1);
  });

  it("returns nothing for an empty query or text", () => {
    expect(findMatches("", "بىلىم")).toEqual([]);
    expect(findMatches("بىلىم", "")).toEqual([]);
    expect(findMatches("بىلىم", "   ")).toEqual([]);
  });

  it("does not overlap consecutive matches", () => {
    const matches = findMatches("aaaa", "aa");
    expect(matches).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe("toSegments", () => {
  it("splits text into plain and matched parts that rebuild the original", () => {
    const text = "بىلىم كۈچتۇر، بىلىم نۇردۇر";
    const segments = toSegments(text, "بىلىم");
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.filter((s) => s.match)).toHaveLength(2);
  });

  it("returns a single plain segment when nothing matches", () => {
    expect(toSegments("ھېچنېمە", "يوق")).toEqual([{ text: "ھېچنېمە", match: false }]);
  });
});

describe("parseMarkedSnippet", () => {
  it("splits the RPC snippet on its mark tags", () => {
    const segments = parseMarkedSnippet("ئۇيغۇر <mark>تىلى</mark> گۈزەل");
    expect(segments).toEqual([
      { text: "ئۇيغۇر ", match: false },
      { text: "تىلى", match: true },
      { text: " گۈزەل", match: false },
    ]);
  });

  it("handles several marks and rebuilds the text", () => {
    const segments = parseMarkedSnippet("<mark>a</mark> b <mark>c</mark>");
    expect(segments.map((s) => s.text).join("")).toBe("a b c");
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(["a", "c"]);
  });

  it("treats any other markup as literal text, never as HTML", () => {
    const segments = parseMarkedSnippet("<script>alert(1)</script>");
    expect(segments).toEqual([{ text: "<script>alert(1)</script>", match: false }]);
  });

  it("returns nothing for an empty snippet", () => {
    expect(parseMarkedSnippet("")).toEqual([]);
  });
});

describe("highlightTermsFromQuery", () => {
  it("prefers a quoted phrase", () => {
    expect(highlightTermsFromQuery('كىتاب "ئۇيغۇر تىلى" ھەققىدە')).toBe("ئۇيغۇر تىلى");
  });

  it("drops OR and negated tokens", () => {
    expect(highlightTermsFromQuery("بىلىم OR ھېكمەت -ئويۇن")).toBe("بىلىم ھېكمەت");
  });
});

describe("clampPosition", () => {
  it("keeps a valid position untouched", () => {
    expect(clampPosition({ pageNo: 5, offset: 0.5 }, 10)).toEqual({ pageNo: 5, offset: 0.5 });
  });

  it("clamps beyond the last page and below the first", () => {
    expect(clampPosition({ pageNo: 999, offset: 0.5 }, 10).pageNo).toBe(10);
    expect(clampPosition({ pageNo: 0, offset: 0.5 }, 10).pageNo).toBe(1);
    expect(clampPosition({ pageNo: -3, offset: 0.5 }, 10).pageNo).toBe(1);
  });

  it("clamps the offset into 0–1", () => {
    expect(clampPosition({ pageNo: 1, offset: 5 }, 10).offset).toBe(1);
    expect(clampPosition({ pageNo: 1, offset: -2 }, 10).offset).toBe(0);
  });

  it("falls back to the start for missing or broken values", () => {
    expect(clampPosition(null, 10)).toEqual({ pageNo: 1, offset: 0 });
    expect(clampPosition({ pageNo: Number.NaN, offset: Number.NaN }, 10)).toEqual({
      pageNo: 1,
      offset: 0,
    });
  });

  it("survives a book with no pages yet", () => {
    expect(clampPosition({ pageNo: 4, offset: 0.5 }, 0)).toEqual({ pageNo: 1, offset: 0.5 });
  });
});

describe("shouldRestore", () => {
  it("ignores a position at the very beginning", () => {
    expect(shouldRestore({ pageNo: 1, offset: 0 })).toBe(false);
    expect(shouldRestore({ pageNo: 1, offset: 0.01 })).toBe(false);
  });

  it("restores once the reader has moved on", () => {
    expect(shouldRestore({ pageNo: 2, offset: 0 })).toBe(true);
    expect(shouldRestore({ pageNo: 1, offset: 0.5 })).toBe(true);
  });
});

describe("initialPageWindow", () => {
  it("starts at page 1 for a fresh read", () => {
    expect(initialPageWindow({ pageNo: 1, offset: 0 }, 100, 10)).toEqual({ from: 1, to: 10 });
  });

  it("includes the saved page with a little lead-in", () => {
    const window = initialPageWindow({ pageNo: 50, offset: 0 }, 100, 10);
    expect(window.from).toBe(48);
    expect(window.to).toBe(57);
    expect(window.from).toBeLessThanOrEqual(50);
    expect(window.to).toBeGreaterThanOrEqual(50);
  });

  it("does not run past the end of the book", () => {
    const window = initialPageWindow({ pageNo: 100, offset: 0 }, 100, 10);
    expect(window.to).toBe(100);
    expect(window.from).toBe(91);
  });

  it("handles a book shorter than the window", () => {
    expect(initialPageWindow({ pageNo: 2, offset: 0 }, 3, 10)).toEqual({ from: 1, to: 3 });
  });
});

describe("parseStoredPosition", () => {
  it("reads a stored position", () => {
    expect(parseStoredPosition('{"pageNo":7,"offset":0.25}', 20)).toEqual({
      pageNo: 7,
      offset: 0.25,
    });
  });

  it("falls back to the start for missing or corrupt data", () => {
    expect(parseStoredPosition(null, 20)).toEqual({ pageNo: 1, offset: 0 });
    expect(parseStoredPosition("not json", 20)).toEqual({ pageNo: 1, offset: 0 });
  });

  it("clamps a stored page beyond a shortened book", () => {
    expect(parseStoredPosition('{"pageNo":99,"offset":0.5}', 5).pageNo).toBe(5);
  });
});
