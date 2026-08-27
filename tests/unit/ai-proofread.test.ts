/**
 * The ⟦N⟧ protocol, and what it refuses.
 *
 * These are the tests that stand between a model having a bad day and somebody
 * losing a paragraph of their own writing. The interesting cases are all
 * failures: a reply that came back short, long, shuffled, or empty must change
 * NOTHING, and the writer must be told in Uyghur rather than shown a document
 * that is quietly missing its last line.
 */
import { describe, expect, it } from "vitest";
import {
  BATCH_CHARS,
  buildBatches,
  buildDiff,
  checkBatch,
  describeChars,
  formatBatch,
  malformedMessage,
  parseSegments,
  type Segment,
} from "@/lib/ai/proofread";
import { buildProofreadPrompt, SYSTEM_BASE } from "@/lib/ai/prompts";

const segments = (...texts: string[]): Segment[] =>
  texts.map((text, index) => ({ num: index + 1, text }));

/** What a well-behaved model returns. */
const reply = (...pairs: [number, string][]) =>
  pairs.map(([num, text]) => `⟦${num}⟧ ${text}`).join("\n");

describe("what goes out", () => {
  it("numbers every segment and puts the marker first", () => {
    expect(formatBatch(segments("بىرىنچى قۇر", "ئىككىنچى قۇر"))).toBe(
      "⟦1⟧ بىرىنچى قۇر\n⟦2⟧ ئىككىنچى قۇر",
    );
  });

  it("batches by the output budget, not the context window", () => {
    // A proofread reply is as long as its input, so the model's OUTPUT budget
    // is the limit that bites — one giant request came back truncated.
    const long = segments("ئا".repeat(4000), "ب".repeat(4000), "ج".repeat(100));
    const batches = buildBatches(long);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const size = batch.reduce((total, segment) => total + segment.text.length + 8, 0);
      // Only a single oversized segment may exceed the budget on its own.
      if (batch.length > 1) expect(size).toBeLessThanOrEqual(BATCH_CHARS);
    }
    // Nothing is lost in the splitting.
    expect(batches.flat().map((segment) => segment.num)).toEqual([1, 2, 3]);
  });

  it("sends an oversized paragraph alone rather than refusing it", () => {
    // Refusing would leave the writer with a paragraph that can never be
    // checked at all.
    const batches = buildBatches(segments("ئا".repeat(BATCH_CHARS * 2)));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it("keeps the writer's own words out of SYSTEM_BASE's way", () => {
    const prompt = buildProofreadPrompt("⟦1⟧ سىناق");
    expect(prompt).not.toContain(SYSTEM_BASE);
    expect(prompt).toContain("Fix ONLY spelling, orthography, and punctuation");
    // The rule that keeps a quoted verse from being "corrected".
    expect(prompt).toContain("leave Arabic passages exactly as written");
    // The rule that keeps it from rewriting somebody's sentence.
    expect(prompt).toContain("Word choice belongs to the author");
    expect(prompt.endsWith("⟦1⟧ سىناق")).toBe(true);
  });
});

describe("what comes back", () => {
  it("reads segments in the order the markers appeared", () => {
    const got = parseSegments(reply([1, "بىر"], [2, "ئىككى"], [3, "ئۈچ"]));
    expect(got.map((segment) => segment.num)).toEqual([1, 2, 3]);
    expect(got.map((segment) => segment.text)).toEqual(["بىر", "ئىككى", "ئۈچ"]);
  });

  it("accepts a well-formed reply", () => {
    const sent = segments("بىر", "ئىككى");
    const result = checkBatch(sent, reply([1, "بىر."], [2, "ئىككى."]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.segments.map((s) => s.text)).toEqual(["بىر.", "ئىككى."]);
  });
});

describe("what is refused", () => {
  const sent = segments("بىر", "ئىككى", "ئۈچ");

  it("refuses a reply with a segment missing", () => {
    const result = checkBatch(sent, reply([1, "بىر."], [3, "ئۈچ."]));
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses a reply with a segment added", () => {
    const result = checkBatch(sent, reply([1, "بىر."], [2, "ئىككى."], [3, "ئۈچ."], [4, "تۆت."]));
    expect(result).toEqual({ ok: false, reason: "extra" });
  });

  it("refuses a reply whose segments came back shuffled", () => {
    // The desktop keyed segments into a map, where this is invisible. Here the
    // order IS the contract: shuffled paragraphs are a corrupted document.
    const result = checkBatch(sent, reply([1, "بىر."], [3, "ئۈچ."], [2, "ئىككى."]));
    expect(result).toEqual({ ok: false, reason: "reordered" });
  });

  it("refuses a reply with no markers at all", () => {
    expect(checkBatch(sent, "بىر. ئىككى. ئۈچ.")).toEqual({ ok: false, reason: "empty" });
  });

  it("says in Uyghur what went wrong, and that nothing was changed", () => {
    for (const reason of ["missing", "extra", "reordered", "empty"] as const) {
      const message = malformedMessage(reason);
      expect(message).toContain("جاۋاب فورماتى خاتا");
      // The sentence that matters most to whoever is reading it.
      expect(message).toContain("ھېچقانداق ئۆزگەرتىش قىلىنمىدى");
      expect(message).not.toMatch(/[A-Za-z]{4,}/);
    }
  });
});

describe("the diff the writer accepts or rejects", () => {
  it("lists only what actually changed", () => {
    const originals = ["بىرىنچى", "ئىككىنچى", "ئۈچىنچى"];
    const corrected = new Map([
      [0, "بىرىنچى"], // untouched
      [1, "ئىككىنچى."], // a full stop added
      [2, "ئۈچىنچى"], // untouched
    ]);
    const changes = buildDiff(originals, corrected);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ index: 1, before: "ئىككىنچى", after: "ئىككىنچى." });
  });

  it("says when accepting would flatten a block's formatting", () => {
    const changes = buildDiff(
      ["قېلىن سۆز بار ئابزاس"],
      new Map([[0, "قېلىن سۆز بار ئابزاس."]]),
      (index) => index === 0,
    );
    expect(changes[0].flattensFormatting).toBe(true);
  });

  it("reports nothing when a reply changed nothing", () => {
    expect(buildDiff(["ئۆزگەرمىگەن"], new Map([[0, "ئۆزگەرمىگەن"]]))).toEqual([]);
  });

  it("leaves a block alone when the reply had nothing for it", () => {
    // A quoted block is never sent, so it never has a correction — and must
    // never be treated as "changed to empty".
    expect(buildDiff(["نەقىل"], new Map())).toEqual([]);
  });
});

describe("telling the writer the size", () => {
  it("groups the digits and stays in Latin numerals", () => {
    expect(describeChars(12480)).toBe("12,480 ھەرپ");
    expect(describeChars(0)).toBe("0 ھەرپ");
  });
});
