/**
 * The reviewed vocabulary list.
 *
 * Two properties matter more than the parsing, and both are here because
 * getting either wrong would waste somebody's afternoon rather than break a
 * build:
 *
 *   a correction keeps the wrong form OUT and puts the right form IN, and
 *   ships the pair so the wrong form is corrected rather than merely flagged;
 *
 *   regenerating the list from the corpus preserves every decision already
 *   made. A build that quietly reverted 2,000 lines of review would be
 *   indistinguishable from one that worked, until the next deploy.
 */
import { describe, expect, it } from "vitest";
import { formatVocabulary, parseVocabulary } from "../../scripts/lib/vocabulary.mjs";

describe("reading a reviewed list", () => {
  it("understands the three decisions", () => {
    const entries = parseVocabulary(
      [
        "# a comment",
        "ئەلەيھى\t20988\t15",
        "رسول\t1162\t15\t= رەسۇل",
        "نىڭ\t3962\t15\t-",
      ].join("\n"),
    );
    expect(entries).toEqual([
      { word: "ئەلەيھى", total: 20988, books: 15, decision: "admitted", correction: null },
      { word: "رسول", total: 1162, books: 15, decision: "corrected", correction: "رەسۇل" },
      { word: "نىڭ", total: 3962, books: 15, decision: "rejected", correction: null },
    ]);
  });

  it("forgives however the line was typed", () => {
    // Someone editing two thousand lines by hand will not preserve a column
    // layout, and a format that punishes them for it will not get used.
    const entries = parseVocabulary(
      ["رسول 1162 15 = رەسۇل", "رسول2   =   رەسۇل", "نىڭ  -", "  ", "سۆز\t5\t3  "].join("\n"),
    );
    expect(entries.map((entry) => [entry.word, entry.decision, entry.correction])).toEqual([
      ["رسول", "corrected", "رەسۇل"],
      ["رسول2", "corrected", "رەسۇل"],
      ["نىڭ", "rejected", null],
      ["سۆز", "admitted", null],
    ]);
  });

  it("survives a round trip through the file format", () => {
    const entries = parseVocabulary(
      ["ئەلەيھى\t20988\t15", "رسول\t1162\t15\t= رەسۇل", "نىڭ\t3962\t15\t-"].join("\n"),
    );
    expect(parseVocabulary(formatVocabulary(entries, "test"))).toEqual(entries);
  });

  it("ignores the header without mistaking it for words", () => {
    const written = formatVocabulary(
      [{ word: "سۆز", total: 5, books: 3, decision: "admitted", correction: null }],
      "test",
    );
    expect(parseVocabulary(written)).toHaveLength(1);
  });
});

describe("the shipped list", () => {
  it("is readable and every line parses", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const text = readFileSync(
      fileURLToPath(new URL("../../data/spellcheck/vocabulary.txt", import.meta.url)),
      "utf8",
    );
    const entries = parseVocabulary(text);
    const bodyLines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    // Every non-comment line became an entry — a line silently skipped is a
    // word silently dropped from the dictionary.
    expect(entries).toHaveLength(bodyLines.length);
    for (const entry of entries) {
      expect(entry.word.length, entry.word).toBeGreaterThan(0);
      if (entry.decision === "corrected") expect(entry.correction).toBeTruthy();
    }
  });
});
