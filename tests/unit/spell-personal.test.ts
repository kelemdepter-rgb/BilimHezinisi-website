import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { hasWord, unpackDictionary, type PackedDictionary } from "@/lib/spellcheck/dictionary";
import { isCorrect } from "@/lib/spellcheck/check";
import { looksGlued } from "@/lib/spellcheck/glued";
import {
  MAX_PERSONAL_WORDS,
  exportPersonal,
  isPersonalWord,
  mergeImport,
  parsePersonal,
} from "@/lib/spellcheck/personal";

/**
 * The personal dictionary's file and its hints (PROMPT-48 D). An imported
 * file is untrusted input; every entry here is invented test text.
 */

/** `count` distinct invented words, each one token. */
function inventedWords(count: number): string[] {
  const letters = "ابتجخدرزسشغفقكلمنوي";
  return Array.from({ length: count }, (_, index) => {
    let word = "سۆز";
    for (let rest = index; ; rest = Math.floor(rest / letters.length) - 1) {
      word += letters[rest % letters.length];
      if (rest < letters.length) break;
    }
    return word;
  });
}

describe("importing a file", () => {
  it("adds the words, rejects everything that is not one word, and drops repeats", () => {
    const file = JSON.stringify([
      "تەستسۆز",
      "يېڭىسۆز",
      "تەستسۆز", // twice in the file
      "بارسۆز", // already in the dictionary
      "ئىككى سۆز", // two words
      "<b>سۆز</b>", // markup
      "<img src=x onerror=alert(1)>",
      42,
      null,
      { word: "سۆز" },
      ["سۆز"],
      "ئ", // too short
      "ا".repeat(65), // too long
      "hello", // not Uyghur
      "سۆز\nسۆز", // a line break inside
    ]);
    const result = mergeImport(["بارسۆز"], file);
    expect(result).toEqual({
      ok: true,
      words: ["بارسۆز", "تەستسۆز", "يېڭىسۆز"],
      added: 2,
      rejected: 11,
    });
  });

  it("refuses a file that is not a list, or not JSON at all", () => {
    expect(mergeImport([], '{"words": ["سۆز"]}')).toEqual({ ok: false, reason: "not_array" });
    expect(mergeImport([], '"سۆز"')).toEqual({ ok: false, reason: "not_array" });
    expect(mergeImport([], "42")).toEqual({ ok: false, reason: "not_array" });
    expect(mergeImport([], "<html><script>alert(1)</script>")).toEqual({ ok: false, reason: "not_json" });
    expect(mergeImport([], "")).toEqual({ ok: false, reason: "not_json" });
  });

  it("stops at 5,000 words, counting the rest as rejected", () => {
    const existing = inventedWords(MAX_PERSONAL_WORDS - 2);
    expect(new Set(existing).size).toBe(MAX_PERSONAL_WORDS - 2);
    const result = mergeImport(existing, JSON.stringify(["ئالما", "ئۆرۈك", "نەشپۈت", "ئۈزۈم"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.words).toHaveLength(MAX_PERSONAL_WORDS);
    expect(result.added).toBe(2);
    expect(result.rejected).toBe(2);
  });

  it("takes words of 2 to 64 characters, hyphenated ones included", () => {
    expect(isPersonalWord("ئا")).toBe(true);
    expect(isPersonalWord("ئاق-قارا")).toBe(true);
    expect(isPersonalWord("ب".repeat(64))).toBe(true);
    expect(isPersonalWord("ب".repeat(65))).toBe(false);
    expect(isPersonalWord("ا")).toBe(false);
    expect(isPersonalWord(" سۆز")).toBe(false);
  });

  it("round-trips its own export", () => {
    const words = ["تەستسۆز", "يېڭىسۆز", "ئاق-قارا"];
    const text = exportPersonal(words);
    expect(JSON.parse(text)).toEqual(words);
    expect(mergeImport([], text)).toEqual({ ok: true, words, added: 3, rejected: 0 });
  });
});

describe("what is stored, read back", () => {
  it("keeps every string the writer has, so it can be seen and deleted", () => {
    // An entry from before the import rules existed is shown, not hidden.
    expect(parsePersonal(JSON.stringify(["سۆز", "سۆز", 5, "", "ئۇزۇن سۆز"]))).toEqual(["سۆز", "ئۇزۇن سۆز"]);
    expect(parsePersonal("{}")).toEqual([]);
    expect(parsePersonal("not json")).toEqual([]);
    expect(parsePersonal(null)).toEqual([]);
  });
});

describe("entries that look glued", () => {
  const asset = (name: string) => fileURLToPath(new URL(`../../public/spellcheck/${name}`, import.meta.url));
  let dictionary: PackedDictionary;
  beforeAll(() => {
    const raw = readFileSync(asset("uyghur-dict.bin"));
    dictionary = unpackDictionary(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  });

  it("points out two words stuck together", () => {
    // «ئالما» + «ئۆرۈك», «ياخشى» + «كىتاب»: each half a word, the whole not.
    for (const glued of ["ئالمائۆرۈك", "ياخشىكىتاب"]) {
      expect(isCorrect(dictionary, glued), glued).toBe(false);
      expect(looksGlued(dictionary, glued), glued).toBe(true);
    }
  });

  it("leaves a real compound alone when the dictionary has it", () => {
    // «ئابدۇل» + «باقى» — and a name the dictionary lists as one word.
    expect(hasWord(dictionary, "ئابدۇلباقى")).toBe(true);
    expect(hasWord(dictionary, "ئابدۇل") && hasWord(dictionary, "باقى")).toBe(true);
    expect(looksGlued(dictionary, "ئابدۇلباقى")).toBe(false);
  });

  it("leaves short entries, hyphenated ones and lone misspellings alone", () => {
    // Under 8 letters, however it splits.
    expect(looksGlued(dictionary, "ئاتئات")).toBe(false);
    // The writer's own join.
    expect(looksGlued(dictionary, "ئالما-ئۆرۈك")).toBe(false);
    // Not a word, but not two words either.
    expect(looksGlued(dictionary, "ققققققققققق")).toBe(false);
    // Accepted by the checker on its own (an inflection the list lacks).
    expect(looksGlued(dictionary, "قالدۇرمىغۇدەك")).toBe(false);
  });
});
