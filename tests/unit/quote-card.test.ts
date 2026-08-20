import { describe, expect, it } from "vitest";
import {
  CARD_SIZE,
  QUOTE_MAX_CHARS,
  checkQuote,
  fitLines,
} from "@/lib/share/quote-card";

/**
 * The wrap is where a quote card goes wrong: a line that overruns the card is
 * invisible in review and obvious the moment somebody posts the image. These
 * tests measure with a stand-in for the canvas — a fixed width per character —
 * so the logic can be checked without a browser.
 */
const measure = (line: string) => line.length * 10;

describe("wrapping a passage to the card", () => {
  it("never lets a line exceed the width it was given", () => {
    const text = "ئۇيغۇر تىلى تارىختىن بۇيان نۇرغۇن يازما ئەسەرلەرنى مىراس قالدۇرغان";
    const lines = fitLines(text, 200, measure);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(200);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("keeps every word, in order", () => {
    const text = "بىر ئىككى ئۈچ تۆت بەش ئالتە يەتتە";
    expect(fitLines(text, 60, measure).join(" ")).toBe(text);
  });

  it("keeps a paragraph break rather than running two thoughts together", () => {
    const lines = fitLines("بىرىنچى ئابزاس\n\nئىككىنچى ئابزاس", 1000, measure);
    expect(lines).toEqual(["بىرىنچى ئابزاس", "ئىككىنچى ئابزاس"]);
  });

  it("gives a word longer than the line its own line rather than dropping it", () => {
    const lines = fitLines("قىسقا ئۇزۇنئۇزۇنئۇزۇنسۆز", 60, measure);
    expect(lines).toContain("ئۇزۇنئۇزۇنئۇزۇنسۆز");
  });

  it("returns nothing for text that is only whitespace", () => {
    expect(fitLines("   \n  ", 200, measure)).toEqual([]);
  });
});

describe("what may become a card", () => {
  it("accepts an ordinary passage and tidies its spacing", () => {
    const result = checkQuote("  بىلىم   ئىزدەڭلار  ");
    expect(result).toEqual({ ok: true, quote: "بىلىم ئىزدەڭلار" });
  });

  it("refuses an empty selection with something to do about it", () => {
    const result = checkQuote("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("تاللاڭ");
  });

  it("refuses a passage too long to stay readable, and says how long is too long", () => {
    const result = checkQuote("ب".repeat(QUOTE_MAX_CHARS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(String(QUOTE_MAX_CHARS));
  });

  it("accepts a passage exactly at the limit", () => {
    expect(checkQuote("ب".repeat(QUOTE_MAX_CHARS)).ok).toBe(true);
  });
});

describe("the card itself", () => {
  it("is square and large enough to survive a messaging app re-encoding it", () => {
    expect(CARD_SIZE).toBeGreaterThanOrEqual(1080);
  });
});
