// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { noteMarkdown } from "@/lib/notes/export-markdown";
import { exportFileName, parseNote, takeCitations } from "@/lib/notes/export-shared";
import { noteText } from "@/lib/notes/export-text";
import { ayaInsertHtml, sourceInsertHtml } from "@/lib/notes/insert";
import { QURAN_ATTRIBUTION } from "@/lib/notes/attribution";

/**
 * What the note exports share (PROMPT-50). Every text here is invented.
 */

const CITATION = {
  bookId: 12,
  title: "سىناق كىتاب",
  author: "ئويدۇرما ئاپتور",
  pageNo: 3,
  passage: "نەقىل قىلىنغان جۈملە.",
  query: "",
};
const LINE = `<p dir="rtl"><a href="/books/12/read?page=3">«سىناق كىتاب» — 3-بەت</a></p>`;

/** Run takeCitations over some HTML; return what it found and the HTML left behind. */
function take(html: string) {
  const root = parseNote(html);
  const found = takeCitations(root, "http://localhost:3000/notes/1");
  return { found, html: root.innerHTML };
}

describe("citations become footnote marks", () => {
  it("the mark ends the quoted passage, and the citation line is gone", () => {
    const { found, html } = take(`<p>سۆز.</p>${sourceInsertHtml(CITATION)}`);
    expect(found).toEqual([
      { label: "«سىناق كىتاب» — ئويدۇرما ئاپتور — 3-بەت", url: "http://localhost:3000/books/12/read?page=3" },
    ]);
    expect(html).toBe(
      `<p>سۆز.</p><blockquote dir="rtl">نەقىل قىلىنغان جۈملە.<bh-footnote data-n="1"></bh-footnote></blockquote><p><br></p>`,
    );
  });

  it("before a line's last <br>, which only holds the line open", () => {
    expect(take(`<div>نەقىل<br></div>${LINE}`).html).toBe(`<div>نەقىل<bh-footnote data-n="1"></bh-footnote><br></div>`);
  });

  it("at the end of the last item of a list", () => {
    expect(take(`<ul><li>بىر</li><li>ئىككى</li></ul>${LINE}`).html).toBe(
      `<ul><li>بىر</li><li>ئىككى<bh-footnote data-n="1"></bh-footnote></li></ul>`,
    );
  });

  it("right after words that are not in a block of their own", () => {
    expect(take(`ئۆز سۆزۈم${LINE}`).html).toBe(`ئۆز سۆزۈم<bh-footnote data-n="1"></bh-footnote>`);
  });

  it("in a paragraph of its own when nothing is quoted before it", () => {
    expect(take(`<div><br></div>${LINE}`).html).toBe(`<div><br></div><p><bh-footnote data-n="1"></bh-footnote></p>`);
    expect(take(LINE).html).toBe(`<p><bh-footnote data-n="1"></bh-footnote></p>`);
  });

  it("numbers them in the order they are read", () => {
    const { found, html } = take(`<p>بىر</p>${LINE}<p>ئىككى</p>${LINE.replace("12", "13")}`);
    expect(found.map((source) => source.url)).toEqual([
      "http://localhost:3000/books/12/read?page=3",
      "http://localhost:3000/books/13/read?page=3",
    ]);
    expect(html).toBe(
      `<p>بىر<bh-footnote data-n="1"></bh-footnote></p><p>ئىككى<bh-footnote data-n="2"></bh-footnote></p>`,
    );
  });

  it("leaves a paragraph of the writer's own words with a link in it alone", () => {
    const own = `<p>قاراڭ: <a href="/books/12/read?page=3">«كىتاب»</a></p>`;
    expect(take(own)).toEqual({ found: [], html: own });
  });
});

describe("file names", () => {
  it("are the title, with what a file system refuses replaced", () => {
    expect(exportFileName("مېنىڭ: خاتىرەم?", "md")).toBe("مېنىڭ_ خاتىرەم_.md");
    expect(exportFileName("", "txt")).toBe("خاتىرە.txt");
  });
});

/**
 * One invented note with every shape the exports must carry: a heading, two
 * lines in one block, an empty line, bold, a nested list, a numbered list, a
 * cited passage, a table and a cited verse.
 */
const NOTE =
  "<h2>بىرىنچى باب</h2>" +
  "<div>ئاددىي قۇر<br>ئىككىنچى قۇر</div>" +
  "<div><br></div>" +
  "<div>بىر <b>توم</b> سۆز.</div>" +
  "<ul><li>سىرتقى<ul><li>ئىچكى</li></ul></li><li>كېيىنكى</li></ul>" +
  "<ol><li>ئالدى</li><li>كېيىن</li></ol>" +
  sourceInsertHtml(CITATION) +
  "<table><tbody><tr><td>ئىسىم</td><td>سان</td></tr><tr><td>بىر</td><td>1</td></tr></tbody></table>" +
  ayaInsertHtml({ sura: 1, aya: 2, text_ar: "سىناق ئايىتى", text_ug: "سىناق تەرجىمىسى" }, "both", "سىناق");

const BOOK = "http://localhost:3000/books/12/read?page=3";
const VERSE = "http://localhost:3000/quran/1?aya=2";

describe("Markdown export", () => {
  it("writes the title, the note's shape, absolute links and the credit", () => {
    expect(noteMarkdown("مېنىڭ خاتىرەم", NOTE)).toBe(
      [
        "# مېنىڭ خاتىرەم",
        "",
        "## بىرىنچى باب",
        "",
        "ئاددىي قۇر  ",
        "ئىككىنچى قۇر",
        "",
        "بىر **توم** سۆز.",
        "",
        "-   سىرتقى",
        "    -   ئىچكى",
        "-   كېيىنكى",
        "",
        "1.  ئالدى",
        "2.  كېيىن",
        "",
        "> نەقىل قىلىنغان جۈملە.",
        "",
        `[«سىناق كىتاب» — ئويدۇرما ئاپتور — 3-بەت](${BOOK})`,
        "",
        "| ئىسىم | سان |",
        "| --- | --- |",
        "| بىر | 1 |",
        "",
        "﴿سىناق ئايىتى﴾  ",
        "«سىناق تەرجىمىسى»",
        "",
        `[قۇرئان كەرىم — سىناق — 1:2](${VERSE})`,
        "",
        QURAN_ATTRIBUTION,
        "",
      ].join("\n"),
    );
  });

  it("with footnotes on, marks each passage [^n] and lists the sources under the note", () => {
    expect(noteMarkdown("مېنىڭ خاتىرەم", NOTE, { footnotes: true })).toBe(
      [
        "# مېنىڭ خاتىرەم",
        "",
        "## بىرىنچى باب",
        "",
        "ئاددىي قۇر  ",
        "ئىككىنچى قۇر",
        "",
        "بىر **توم** سۆز.",
        "",
        "-   سىرتقى",
        "    -   ئىچكى",
        "-   كېيىنكى",
        "",
        "1.  ئالدى",
        "2.  كېيىن",
        "",
        "> نەقىل قىلىنغان جۈملە.[^1]",
        "",
        "| ئىسىم | سان |",
        "| --- | --- |",
        "| بىر | 1 |",
        "",
        "﴿سىناق ئايىتى﴾  ",
        "«سىناق تەرجىمىسى»[^2]",
        "",
        `[^1]: «سىناق كىتاب» — ئويدۇرما ئاپتور — 3-بەت — <${BOOK}>`,
        `[^2]: قۇرئان كەرىم — سىناق — 1:2 — <${VERSE}>`,
        "",
        QURAN_ATTRIBUTION,
        "",
      ].join("\n"),
    );
  });

  it("drops a link it would not open, keeping its words, and escapes the title", () => {
    const out = noteMarkdown(
      "# ماۋزۇ",
      `<p><a href="javascript:alert(1)">بۇ</a> ۋە <a href="mailto:x@example.com">ئۇ</a></p>`,
    );
    expect(out).toBe(String.raw`# \# ماۋزۇ` + "\n\nبۇ ۋە ئۇ\n");
  });

  it("names an untitled note as the notebook does", () => {
    expect(noteMarkdown("  ", "<p>سۆز</p>")).toBe("# يېڭى خاتىرە\n\nسۆز\n");
  });
});

describe("text export", () => {
  it("a line per line, a blank line between paragraphs, the title first and the credit last", () => {
    expect(noteText("مېنىڭ خاتىرەم", NOTE)).toBe(
      "\uFEFF" +
        [
          "مېنىڭ خاتىرەم",
          "",
          "بىرىنچى باب",
          "",
          "ئاددىي قۇر",
          "ئىككىنچى قۇر",
          // The note's own empty line.
          "",
          "بىر توم سۆز.",
          "",
          "• سىرتقى",
          "   • ئىچكى",
          "• كېيىنكى",
          "",
          "1. ئالدى",
          "2. كېيىن",
          "",
          "نەقىل قىلىنغان جۈملە.",
          "",
          `«سىناق كىتاب» — ئويدۇرما ئاپتور — 3-بەت (${BOOK})`,
          "",
          // The empty paragraph the insert leaves after a citation.
          "",
          "ئىسىم | سان",
          "بىر | 1",
          "",
          "﴿سىناق ئايىتى﴾",
          "«سىناق تەرجىمىسى»",
          "",
          `قۇرئان كەرىم — سىناق — 1:2 (${VERSE})`,
          "",
          QURAN_ATTRIBUTION,
          "",
        ].join("\r\n"),
    );
  });

  it("collapses the whitespace the browser collapses, and keeps a no-break space", () => {
    expect(noteText("ف", "<p>  بىر\n   ئىككى\u00a0 ئۈچ  </p>")).toBe("\uFEFFف\r\n\r\nبىر ئىككى  ئۈچ\r\n");
  });

  it("has no credit when no verse is quoted", () => {
    expect(noteText("ف", "<p>سۆز</p>")).not.toContain("Tanzil");
  });
});
