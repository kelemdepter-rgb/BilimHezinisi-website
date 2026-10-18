// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { exportFileName, parseNote, takeCitations } from "@/lib/notes/export-shared";
import { sourceInsertHtml } from "@/lib/notes/insert";

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
