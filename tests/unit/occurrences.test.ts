import { describe, expect, it } from "vitest";
import {
  countOccurrences,
  findOccurrences,
  highlightHtml,
  toSegments,
} from "@/lib/search/occurrences";

/** The phrase from the production bug report, and the words it must NOT touch. */
const PHRASE = "نامازغا چا";

/**
 * A real paragraph from book 72, page 203 — the page that made the bug obvious.
 * It carries the phrase four times and, separately, a standalone «چالايلى»
 * twice and a standalone «چاقىر» once.
 */
const PAGE =
  "مۇسۇلمانلار مەدىنىگە كەلگەندە، ھەممەيلەن نامازنىڭ ۋاقتىدا يىغىلاتتى، لېكىن " +
  "نامازغا چاقىرىدىغان ئىش يوق ئىدى. بىر كۈنى، ساھابىلار نامازغا چاقىرىش توغرۇلۇق " +
  "سۆزلىشىپ، بەزىلەر: ”ناسارالارغا ئوخشاش داڭ چالايلى“ دېسە، يەنە بەزىلەر: " +
  "”يەھۇدىيلارنىڭ بۇرغىسىغا ئوخشاش بۇرغا چالايلى“ دېدى. ئۆمەر رەزىيەللاھۇ ئەنھۇ: " +
  "”بىر كىشىنى نامازغا چاقىرىدىغانغا تەيىنلەيلى“ دېدى. پەيغەمبەر سەللاللاھۇ " +
  "ئەلەيھى ۋەسەللەم: «ھەي بىلال ئورنىڭدىن تۇر، نامازغا چاقىر!» دېدى.";

describe("findOccurrences — the whole phrase, never a fragment of it", () => {
  it("matches the literal phrase wherever it occurs, including inside a longer word", () => {
    const found = findOccurrences(PAGE, PHRASE);
    // «نامازغا چاقىرىدىغان», «نامازغا چاقىرىش», «نامازغا چاقىرىدىغانغا», «نامازغا چاقىر»
    expect(found).toHaveLength(4);
    for (const occurrence of found) {
      expect(PAGE.slice(occurrence.start, occurrence.end)).toBe(PHRASE);
    }
  });

  it("never highlights a standalone word that merely starts with the last fragment", () => {
    const found = findOccurrences(PAGE, PHRASE);
    const marked = found.map((o) => PAGE.slice(o.start, o.end));

    // This is the bug, stated: ts_headline marked these because it matched the
    // lexeme «چا» on its own. The phrase never does.
    expect(marked).not.toContain("چالايلى");
    expect(marked).not.toContain("چاقىر");
    expect(marked).not.toContain("چاقىرىش");

    // A «چا…» word is covered by a match if and only if «نامازغا » sits
    // immediately before it — which is the whole rule, stated as an assertion.
    const lead = "نامازغا ";
    for (const bare of ["چالايلى", "چاقىرىش"]) {
      let at = PAGE.indexOf(bare);
      expect(at).toBeGreaterThan(-1);
      while (at !== -1) {
        const precededByPhrase = PAGE.slice(Math.max(0, at - lead.length), at) === lead;
        const covered = found.some((o) => at >= o.start && at < o.end);
        expect(covered).toBe(precededByPhrase);
        at = PAGE.indexOf(bare, at + 1);
      }
    }
  });

  it("takes the first ten characters of «نامازغا چاقىرىش» and nothing more", () => {
    const text = "نامازغا چاقىرىش";
    const [match] = findOccurrences(text, PHRASE);
    expect(match).toEqual({ start: 0, end: PHRASE.length });
    expect(text.slice(match.start, match.end)).toBe("نامازغا چا");
  });

  it("finds nothing when the phrase is not there, however many of its words are", () => {
    const text = "بىلال ئورنىدىن تۇرۇپ داڭ چالايلى دېدى، ئاندىن نامازنى ئوقۇدى.";
    expect(findOccurrences(text, PHRASE)).toEqual([]);
    expect(toSegments(text, PHRASE)).toEqual([{ text, match: false, occurrence: -1 }]);
  });

  it("never returns two adjacent matches for one logical occurrence", () => {
    const found = findOccurrences(PAGE, PHRASE);
    for (let i = 1; i < found.length; i++) {
      expect(found[i].start).toBeGreaterThan(found[i - 1].end);
    }
    // Repeated text is matched without overlap, the way indexOf walks it.
    expect(findOccurrences("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("ignores empty input on either side", () => {
    expect(findOccurrences("", PHRASE)).toEqual([]);
    expect(findOccurrences(PAGE, "")).toEqual([]);
    expect(findOccurrences(PAGE, "   ")).toEqual([]);
  });
});

describe("findOccurrences — offsets survive normalization", () => {
  /**
   * The second half of the bug. ug_normalize strips diacritics, so a position
   * measured on the normalized string points at the wrong character in the
   * original — and a naive slice on a vocalised page lands on text that does
   * not match, which is why clicking a result highlighted nothing at all.
   */
  it("lands on the exact characters on a page full of vocalised Arabic", () => {
    const text =
      "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ۝ ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ";
    const [match] = findOccurrences(text, "الحمد");

    // 39 characters of diacritics and alif wasla precede it: an offset taken
    // from the normalized string would be far short of this.
    expect(text.slice(match.start, match.end)).toBe("ٱلْحَمْدُ");
    expect(match.start).toBeGreaterThan("الحمد".length);
  });

  it("keeps the drift honest across a long vocalised page", () => {
    const verse = "إِنَّ ٱللَّهَ مَعَ ٱلصَّٰبِرِينَ ";
    const text = verse.repeat(40) + "ئاخىرقى ئايەت";
    const found = findOccurrences(text, "ان الله");

    expect(found).toHaveLength(40);
    for (const occurrence of found) {
      // Every match still starts on a real ألف and covers real characters —
      // the check that fails the moment offsets are measured on normalized text.
      const slice = text.slice(occurrence.start, occurrence.end);
      expect(slice.startsWith("إِ")).toBe(true);
      expect(slice.replace(/[ً-ْٰ]/g, "")).toBe("إن ٱلله");
    }
  });

  it("carries trailing marks on the last letter into the match", () => {
    const [match] = findOccurrences("ٱلرَّحِيمِ", "الرحيم");
    expect("ٱلرَّحِيمِ".slice(match.start, match.end)).toBe("ٱلرَّحِيمِ");
  });

  it("matches across a line break inside the phrase", () => {
    const found = findOccurrences("نامازغا\n   چاقىرىش", PHRASE);
    expect(found).toHaveLength(1);
  });

  it("folds alif variants but keeps ى and ې apart", () => {
    expect(findOccurrences("آية", "اية")).toHaveLength(1);
    expect(findOccurrences("إسلام", "اسلام")).toHaveLength(1);
    // ى is the Uyghur vowel "i", a different letter from ي — never folded.
    expect(findOccurrences("تىل", "تيل")).toHaveLength(0);
    expect(findOccurrences("تىل", "تىل")).toHaveLength(1);
  });
});

describe("toSegments", () => {
  it("numbers each match so the navigator can address one occurrence", () => {
    const segments = toSegments(PAGE, PHRASE);
    const matches = segments.filter((segment) => segment.match);
    expect(matches.map((segment) => segment.occurrence)).toEqual([0, 1, 2, 3]);
    expect(matches.every((segment) => segment.text === PHRASE)).toBe(true);
  });

  it("rebuilds the original text exactly", () => {
    expect(toSegments(PAGE, PHRASE).map((segment) => segment.text).join("")).toBe(PAGE);
  });
});

describe("countOccurrences", () => {
  it("is the per-page number the «n/total» counter sums", () => {
    expect(countOccurrences(PAGE, PHRASE)).toBe(4);
    expect(countOccurrences(PAGE, "چالايلى")).toBe(2);
    expect(countOccurrences(PAGE, "قۇرئان")).toBe(0);
  });
});

describe("highlightHtml — the Markdown reader path", () => {
  it("marks the phrase inside generated HTML", () => {
    const html = "<p>ساھابىلار نامازغا چاقىرىش توغرۇلۇق سۆزلەشتى.</p>";
    const out = highlightHtml(html, PHRASE);
    expect(out).toContain('<mark data-match="0"');
    expect(out).toContain(`>${PHRASE}</mark>`);
    // The paragraph itself is untouched.
    expect(out.startsWith("<p>")).toBe(true);
    expect(out.endsWith("</p>")).toBe(true);
  });

  it("does not mark a standalone word that starts with the last fragment", () => {
    const html = "<p>ناسارالارغا ئوخشاش داڭ چالايلى دېدى.</p>";
    expect(highlightHtml(html, PHRASE)).toBe(html);
  });

  it("numbers every occurrence in document order", () => {
    const html = "<p>نامازغا چاقىرىش</p><p>يەنە نامازغا چاقىر</p>";
    const out = highlightHtml(html, PHRASE);
    expect(out).toContain('data-match="0"');
    expect(out).toContain('data-match="1"');
    expect(out).not.toContain('data-match="2"');
  });

  it("flags the occurrence the navigator is sitting on", () => {
    const html = "<p>نامازغا چاقىرىش، نامازغا چاقىر</p>";
    const out = highlightHtml(html, PHRASE, 1);
    expect(out).toMatch(/data-match="1" class="match-active/);
    expect(out).toMatch(/data-match="0" class="rounded/);
  });

  it("keeps nesting valid when a match straddles inline markup", () => {
    // «نامازغا **چا**قىرىش» — turndown output puts the phrase across a <strong>.
    const html = "<p>نامازغا <strong>چا</strong>قىرىش</p>";
    const out = highlightHtml(html, PHRASE);

    // Both halves belong to the same occurrence, so the navigator sees one hit.
    expect([...out.matchAll(/data-match="(\d+)"/g)].map((m) => m[1])).toEqual(["0", "0"]);
    // No tag is straddled: every <mark> opened is closed inside its own run.
    expect(out).toBe(
      '<p><mark data-match="0" class="rounded bg-ab2 px-0.5 text-ink">نامازغا </mark>' +
        '<strong><mark data-match="0" class="rounded bg-ab2 px-0.5 text-ink">چا</mark></strong>' +
        "قىرىش</p>",
    );
  });

  it("does not match text that only exists as markup", () => {
    const html = '<p><a href="https://example.com/نامازغا-چاقىرىش">ئۇلىنىش</a></p>';
    expect(highlightHtml(html, PHRASE)).toBe(html);
  });

  it("matches through an escaped entity without corrupting it", () => {
    const html = "<p>ناماز &amp; چاقىرىش</p>";
    const out = highlightHtml(html, "ناماز & چا");
    expect(out).toContain("&amp;");
    expect(out).toContain('<mark data-match="0"');
    // The entity survives whole — never split into &am + p;
    expect(out).not.toMatch(/&am(?!p;)/);
  });

  it("leaves the page alone when there is nothing to mark", () => {
    const html = "<p>ھېچنېمە</p>";
    expect(highlightHtml(html, PHRASE)).toBe(html);
    expect(highlightHtml(html, "")).toBe(html);
  });
});
