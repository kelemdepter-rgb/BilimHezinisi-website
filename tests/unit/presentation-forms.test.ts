import { describe, expect, it } from "vitest";
import { foldPresentationForms, normalizeImportedText } from "@/lib/books/presentation-forms";
import {
  CANDIDATE_SHARE,
  foldPresentationForms as foldMjs,
  isCandidate,
  normalizeImportedText as normalizeMjs,
  presentationFormShare,
} from "../../scripts/lib/presentation-forms.mjs";

/**
 * Book 989 exactly as the library held it: «قاراخانىيلار خانلىقى ۋە قارلۇقلار»
 * by «غەيرەتجان ئوسمان», written entirely in glyph codepoints. Escaped rather
 * than pasted, because the two spellings are indistinguishable on screen and
 * this test is about the difference between them.
 */
const BROKEN_TITLE =
  "\uFED7\uFE8E\uFEAD\uFE8D\uFEA7\uFE8E\uFEE7\uFBE9\uFEF4\uFEFC\uFEAD " +
  "\uFEA7\uFE8E\uFEE7\uFEE0\uFBE9\uFED8\uFEF0 \uFBDE\uFEE9 " +
  "\uFED7\uFE8E\uFEAD\uFEDF\uFBD8\uFED7\uFEFC\uFEAD";
const REPAIRED_TITLE = "قاراخانىيلار خانلىقى ۋە قارلۇقلار";

/** The author, whose name returned no results at all before the repair. */
const BROKEN_AUTHOR = "\uFECF\uFEEA\uFEF3\uFEAE\uFEE9\uFE97\uFEA0\uFE8E\uFEE5 \uFE8B\uFEEE\uFEB3\uFEE4\uFE8E\u0646";
const REPAIRED_AUTHOR = "غەيرەتجان ئوسمان";

/** The religious ligatures, which NFKC would expand into whole phrases. */
const SALLALLAHU = "\uFDFA"; // ﷺ
const ALLAH = "\uFDF2"; // ﷲ
const BISMILLAH = "\uFDFD"; // ﷽
const JALLA_JALALUHU = "\uFDFB"; // ﷻ

describe("folding glyph codepoints back into letters", () => {
  it("turns book 989's title into ordinary Uyghur", () => {
    expect(foldPresentationForms(BROKEN_TITLE)).toBe(REPAIRED_TITLE);
    expect(normalizeImportedText(BROKEN_TITLE)).toBe(REPAIRED_TITLE);
  });

  it("turns book 989's author into a name the author index can group", () => {
    expect(foldPresentationForms(BROKEN_AUTHOR)).toBe(REPAIRED_AUTHOR);
  });

  it("splits the lam-alef ligature into the two letters it stands for", () => {
    // U+FEFC is one codepoint drawing ل followed by ا.
    expect(foldPresentationForms("\uFEFC")).toBe("\u0644\u0627");
    expect([...foldPresentationForms("\uFEFC")]).toHaveLength(2);
    // The isolated form of the same ligature behaves the same way.
    expect(foldPresentationForms("\uFEFB")).toBe("\u0644\u0627");
  });

  it("leaves the religious ligatures exactly as they are", () => {
    for (const ligature of [SALLALLAHU, ALLAH, BISMILLAH, JALLA_JALALUHU]) {
      expect(foldPresentationForms(ligature)).toBe(ligature);
      expect(normalizeImportedText(ligature)).toBe(ligature);
    }
    // In context, next to text that IS folded.
    expect(foldPresentationForms(`\uFED7${SALLALLAHU}\uFE8E`)).toBe(`ق${SALLALLAHU}ا`);
  });

  it("leaves every codepoint of U+FDF0–U+FDFD alone", () => {
    for (let codePoint = 0xfdf0; codePoint <= 0xfdfd; codePoint++) {
      const character = String.fromCodePoint(codePoint);
      expect(foldPresentationForms(character), `U+${codePoint.toString(16)}`).toBe(character);
    }
  });

  it("leaves the ornate Qur'an parentheses alone", () => {
    // ﴾ ﴿ sit between the two folded ranges and appear ~10,000 times here.
    expect(foldPresentationForms("\uFD3E\uFD3F")).toBe("\uFD3E\uFD3F");
  });

  it("returns ordinary Uyghur text unchanged, character for character", () => {
    const uyghur = "بىلىم خەزىنىسى — ئۇيغۇرچە كىتابخانا. ھەدىس، تارىخ ۋە ئەدەبىيات.";
    expect(foldPresentationForms(uyghur)).toBe(uyghur);
    expect(normalizeImportedText(uyghur)).toBe(uyghur);
    const markdown = "# ماۋزۇ\n\n**توم** ـ 1\n\n| ئا | ب |\n| --- | --- |\n";
    expect(normalizeImportedText(markdown)).toBe(markdown);
  });

  it("handles an empty string, null and undefined", () => {
    expect(foldPresentationForms("")).toBe("");
    expect(foldPresentationForms(null)).toBe("");
    expect(foldPresentationForms(undefined)).toBe("");
    expect(normalizeImportedText("")).toBe("");
    expect(normalizeImportedText(null)).toBe("");
    expect(normalizeImportedText(undefined)).toBe("");
  });

  it("is idempotent — folding a repaired string changes nothing", () => {
    const once = foldPresentationForms(BROKEN_TITLE);
    expect(foldPresentationForms(once)).toBe(once);
  });

  it("gives the Uyghur ە back, not the Arabic heh it is drawn like", () => {
    // U+FEE9/U+FEEA are how the legacy encoders wrote ە. NFKC alone answers
    // ه (U+0647), which is not a letter of the Uyghur alphabet and would leave
    // the book unsearchable by author.
    expect(foldPresentationForms("\uFEE9")).toBe("\u06D5");
    expect(foldPresentationForms("\uFEEA")).toBe("\u06D5");
    expect("\uFEE9".normalize("NFKC")).toBe("\u0647");
    // A heh that joins forward can only be a real heh, and stays one.
    expect(foldPresentationForms("\uFEEB")).toBe("\u0647");
    expect(foldPresentationForms("\uFEEC")).toBe("\u0647");
  });
});

describe("the repair script's detector", () => {
  it("calls a page that is 80% glyph codepoints a candidate", () => {
    const page = "\uFED7\uFE8E\uFEAD\uFE8D".repeat(20) + "ئادەتتىكى ھەرپ".repeat(1);
    const { share } = presentationFormShare(page);
    expect(share).toBeGreaterThan(0.8);
    expect(isCandidate(page)).toBe(true);
  });

  it("does not call a page carrying one ﷺ a candidate", () => {
    const page = `پەيغەمبەر ${SALLALLAHU} نىڭ يولى. `.repeat(40);
    expect(presentationFormShare(page).forms).toBe(0);
    expect(isCandidate(page)).toBe(false);
  });

  it("does not call a healthy page with one stray glyph a candidate", () => {
    // The real worst case in this library: one form in 176,565 characters.
    const page = "ئۇيغۇر تىلىدىكى ئادەتتىكى بەت. ".repeat(200) + "\uFED7";
    const { forms, share } = presentationFormShare(page);
    expect(forms).toBe(1);
    expect(share).toBeLessThan(CANDIDATE_SHARE);
    expect(isCandidate(page)).toBe(false);
  });

  it("counts nothing in an empty or missing row", () => {
    expect(presentationFormShare("")).toEqual({ forms: 0, total: 0, share: 0 });
    expect(presentationFormShare(null)).toEqual({ forms: 0, total: 0, share: 0 });
    expect(isCandidate("")).toBe(false);
  });
});

/**
 * The script and the pipeline must fold identically, or a book repaired by one
 * would differ from the same book imported by the other — the same arrangement
 * tests/unit/script-parity.test.ts makes for the spellchecker's tables.
 */
describe("the script's copy and the pipeline's copy", () => {
  const corpus = [
    BROKEN_TITLE,
    BROKEN_AUTHOR,
    `${SALLALLAHU}${ALLAH}${BISMILLAH}${JALLA_JALALUHU}`,
    "\uFEFB\uFEFC\uFEF5\uFEF6\uFEF7\uFEF8\uFEF9\uFEFA",
    "بىلىم خەزىنىسى",
    "",
    "\uFD3E\uFD3F",
  ];

  it("agrees on every character of both presentation-form blocks", () => {
    for (const [first, last] of [
      [0xfb50, 0xfbff],
      [0xfe70, 0xfeff],
      [0xfdf0, 0xfdfd],
    ]) {
      for (let codePoint = first; codePoint <= last; codePoint++) {
        const character = String.fromCodePoint(codePoint);
        expect(foldMjs(character), `U+${codePoint.toString(16)}`).toBe(
          foldPresentationForms(character),
        );
      }
    }
  });

  it("agrees on real strings", () => {
    for (const text of corpus) {
      expect(foldMjs(text), text).toBe(foldPresentationForms(text));
      expect(normalizeMjs(text), text).toBe(normalizeImportedText(text));
    }
  });
});
