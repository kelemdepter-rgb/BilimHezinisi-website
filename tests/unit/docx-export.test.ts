// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildDocx, type DocxOptions } from "@/lib/notes/export-docx";
import { ayaInsertHtml, sourceInsertHtml } from "@/lib/notes/insert";

/**
 * A .docx is a zip of XML. "Valid" here means the archive really opens, the
 * parts Word requires are present, and the writing is inside — checked by
 * reading the file back rather than trusting the builder.
 *
 * Every text below is invented for the test.
 */
async function openDocx(title: string, html: string, options?: DocxOptions) {
  const blob = await buildDocx(title, html, options);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const part = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
  return {
    blob,
    zip,
    documentXml: await part("word/document.xml"),
    stylesXml: await part("word/styles.xml"),
    numberingXml: await part("word/numbering.xml"),
    footnotesXml: await part("word/footnotes.xml"),
    footnoteRels: await part("word/_rels/footnotes.xml.rels"),
    rels: await part("word/_rels/document.xml.rels"),
  };
}

/** Word's XML splits text across runs; compare on the text content alone. */
const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

/** The `w:val` of the first `w:<name>` under `element`, if any. */
function val(element: Element, name: string): string | null {
  const found = element.getElementsByTagNameNS(W, name)[0];
  return found ? found.getAttributeNS(W, "val") : null;
}

/** The body's own paragraphs (not those inside table cells), after the title. */
function bodyParagraphs(documentXml: string): Element[] {
  const body = parse(documentXml).getElementsByTagNameNS(W, "body")[0];
  return Array.from(body.children)
    .filter((element) => element.localName === "p")
    .slice(1);
}

const paragraphText = (paragraph: Element) =>
  Array.from(paragraph.getElementsByTagNameNS(W, "t"))
    .map((t) => t.textContent)
    .join("");

describe("DOCX export", () => {
  it("produces an archive Word can open", async () => {
    const { blob, zip } = await openDocx("خاتىرە", "<p>سىناق</p>");
    expect(blob.size).toBeGreaterThan(1000);
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
      expect(zip.file(part), part).not.toBeNull();
    }
  });

  it("carries the title and the body text", async () => {
    const { documentXml } = await openDocx("مېنىڭ خاتىرەم", "<p>بىرىنچى قۇر</p><p>ئىككىنچى قۇر</p>");
    const text = textOf(documentXml);
    expect(text).toContain("مېنىڭ خاتىرەم");
    expect(text).toContain("بىرىنچى قۇر");
    expect(text).toContain("ئىككىنچى قۇر");
  });

  it("keeps bold, italic and underline, with the complex-script variants Uyghur is drawn with", async () => {
    const { documentXml } = await openDocx(
      "ف",
      "<p><b>توم</b><i>يانتۇ</i><u>سىزىق</u></p>",
    );
    expect(documentXml).toContain("<w:b/>");
    expect(documentXml).toContain("<w:i/>");
    expect(documentXml).toMatch(/<w:u\b/);
    // Text in a right-to-left run is set with the cs properties: without
    // w:bCs and w:iCs, Word shows Uyghur neither bold nor italic.
    expect(documentXml).toContain("<w:bCs/>");
    expect(documentXml).toContain("<w:iCs/>");
  });

  it("never writes «not bold» on plain text, which would undo a heading's bold", async () => {
    const { documentXml } = await openDocx("ف", "<h2>باب</h2><p>ئاددىي</p>");
    expect(documentXml).not.toMatch(/<w:b w:val="(false|0)"\/>/);
  });

  it("marks every run right-to-left, or Word lays Uyghur out backwards", async () => {
    const { documentXml } = await openDocx("ف", "<p>ئۇيغۇرچە</p>");
    expect(documentXml).toContain("<w:rtl/>");
    expect(documentXml).toContain("<w:bidi/>");
  });

  it("turns headings into Word heading styles", async () => {
    const { documentXml } = await openDocx("ف", "<h2>باب</h2><p>تېكىست</p>");
    expect(documentXml).toContain("Heading2");
  });

  it("turns list items into list paragraphs", async () => {
    const { documentXml } = await openDocx("ف", "<ul><li>بىر</li><li>ئىككى</li></ul>");
    expect(documentXml).toContain("ListParagraph");
    expect(textOf(documentXml)).toContain("بىر");
  });

  it("converts an rgb() colour to the RRGGBB Word expects", async () => {
    const { documentXml } = await openDocx("ف", `<p><span style="color: rgb(201, 162, 75)">ئالتۇن</span></p>`);
    expect(documentXml).toContain('w:color w:val="C9A24B"');
  });

  it("still writes a file for an empty note", async () => {
    const { blob, documentXml } = await openDocx("قۇرۇق", "");
    expect(blob.size).toBeGreaterThan(1000);
    expect(textOf(documentXml)).toContain("قۇرۇق");
  });
});

describe("DOCX export keeps the note's shape (N12)", () => {
  it("a <br> is a line break inside its paragraph, not a glued line", async () => {
    const { documentXml } = await openDocx("ف", "<div>بىرىنچى قۇر<br>ئىككىنچى قۇر</div>");
    const paragraphs = bodyParagraphs(documentXml);
    expect(paragraphs).toHaveLength(1);
    const [only] = paragraphs;
    expect(only.getElementsByTagNameNS(W, "br")).toHaveLength(1);
    // The break sits between the two lines.
    const inner = new XMLSerializer().serializeToString(only);
    expect(inner.indexOf("بىرىنچى قۇر")).toBeLessThan(inner.indexOf("<w:br/>"));
    expect(inner.indexOf("<w:br/>")).toBeLessThan(inner.indexOf("ئىككىنچى قۇر"));
  });

  it("a block's last <br> holds an empty line open; it is not a second break", async () => {
    const { documentXml } = await openDocx("ف", "<div>قۇر<br></div>");
    const [only] = bodyParagraphs(documentXml);
    expect(only.getElementsByTagNameNS(W, "br")).toHaveLength(0);
  });

  it("blocks inside blocks are paragraphs of their own, never merged", async () => {
    const { documentXml } = await openDocx(
      "ف",
      "<blockquote><div>بىر</div><div>ئىككى</div></blockquote><div><p>ئۈچ</p><p>تۆت</p></div>",
    );
    expect(bodyParagraphs(documentXml).map(paragraphText)).toEqual(["بىر", "ئىككى", "ئۈچ", "تۆت"]);
  });

  it("text beside a block inside the same block is a paragraph of its own", async () => {
    const { documentXml } = await openDocx("ف", "<div>ئالدى<p>ئوتتۇرا</p>ئاخىرى</div>");
    expect(bodyParagraphs(documentXml).map(paragraphText)).toEqual(["ئالدى", "ئوتتۇرا", "ئاخىرى"]);
  });

  it("an empty line (<div><br></div>) stays an empty paragraph", async () => {
    const { documentXml } = await openDocx("ف", "<div>بىر</div><div><br></div><div>ئىككى</div>");
    expect(bodyParagraphs(documentXml).map(paragraphText)).toEqual(["بىر", "", "ئىككى"]);
  });

  it("every line of a quote is indented", async () => {
    const { documentXml } = await openDocx("ف", "<blockquote><div>بىر</div><div>ئىككى</div></blockquote>");
    for (const paragraph of bodyParagraphs(documentXml)) {
      const indent = paragraph.getElementsByTagNameNS(W, "ind")[0];
      expect(indent, paragraphText(paragraph)).toBeDefined();
      // w:left is the START side of a right-to-left paragraph — see the
      // alignment test below for where that rule comes from.
      expect(Number(indent.getAttributeNS(W, "left"))).toBeGreaterThan(0);
    }
  });

  it("nested list items get their nesting level, and a parent never repeats its children", async () => {
    const { documentXml } = await openDocx(
      "ف",
      "<ul><li>سىرتقى<ul><li>ئىچكى<ol><li>ئەڭ ئىچكى</li></ol></li></ul></li><li>كېيىنكى</li></ul>",
    );
    const paragraphs = bodyParagraphs(documentXml);
    expect(paragraphs.map(paragraphText)).toEqual(["سىرتقى", "ئىچكى", "ئەڭ ئىچكى", "كېيىنكى"]);
    expect(paragraphs.map((paragraph) => val(paragraph, "ilvl"))).toEqual(["0", "1", "2", "0"]);
    // Each text exactly once in the whole document.
    const all = textOf(documentXml);
    for (const word of ["سىرتقى", "كېيىنكى"]) expect(all.split(word)).toHaveLength(2);
    expect(all.split("ئىچكى")).toHaveLength(3); // «ئىچكى» and «ئەڭ ئىچكى»
  });

  it("bullets for <ul>, numbers for <ol>, and every separate list starts again at 1", async () => {
    const { documentXml, numberingXml } = await openDocx(
      "ف",
      "<ol><li>بىرىنچى</li><li>ئىككىنچى</li></ol><p>ئارىدا</p><ol><li>يەنە بىرىنچى</li></ol><ul><li>چېكىت</li></ul>",
    );
    const paragraphs = bodyParagraphs(documentXml);
    const numId = (index: number) => val(paragraphs[index], "numId")!;
    expect(numId(0)).toBe(numId(1));
    expect(numId(0)).not.toBe(numId(3));

    const numbering = parse(numberingXml);
    /** The abstract definition a w:num points at. */
    const abstractOf = (id: string) => {
      const num = Array.from(numbering.getElementsByTagNameNS(W, "num")).find(
        (element) => element.getAttributeNS(W, "numId") === id,
      )!;
      const abstractId = val(num, "abstractNumId")!;
      return Array.from(numbering.getElementsByTagNameNS(W, "abstractNum")).find(
        (element) => element.getAttributeNS(W, "abstractNumId") === abstractId,
      )!;
    };
    // Two separate lists never share a counter: each has its own definition,
    // which starts at 1. (Two w:num over ONE abstract continue each other in
    // Word unless every level is overridden.)
    expect(abstractOf(numId(0))).not.toBe(abstractOf(numId(3)));
    for (const index of [0, 3]) {
      const firstLevel = abstractOf(numId(index)).getElementsByTagNameNS(W, "lvl")[0];
      expect(val(firstLevel, "start")).toBe("1");
      expect(val(firstLevel, "numFmt")).toBe("decimal");
    }
    const bulletLevel = abstractOf(numId(4)).getElementsByTagNameNS(W, "lvl")[0];
    expect(val(bulletLevel, "numFmt")).toBe("bullet");
  });

  it("a list written straight into a list — what the indent command makes — is one level deeper", async () => {
    const { documentXml } = await openDocx("ف", "<ul><li>سىرتقى</li><ul><li>ئىچكى</li></ul><li>يەنە</li></ul>");
    const paragraphs = bodyParagraphs(documentXml);
    expect(paragraphs.map(paragraphText)).toEqual(["سىرتقى", "ئىچكى", "يەنە"]);
    expect(paragraphs.map((paragraph) => val(paragraph, "ilvl"))).toEqual(["0", "1", "0"]);
  });

  it("a list item holding paragraphs: the first is numbered, the rest follow under it", async () => {
    const { documentXml } = await openDocx("ف", "<ol><li><p>ماددا</p><p>داۋامى</p></li></ol>");
    const [first, second] = bodyParagraphs(documentXml);
    expect(paragraphText(first)).toBe("ماددا");
    expect(val(first, "numId")).not.toBeNull();
    expect(paragraphText(second)).toBe("داۋامى");
    expect(val(second, "numId")).toBeNull();
    expect(Number(second.getElementsByTagNameNS(W, "ind")[0]?.getAttributeNS(W, "left"))).toBeGreaterThan(0);
  });

  it("a table is a real right-to-left Word table, spans and all", async () => {
    const { documentXml } = await openDocx(
      "ف",
      "<table><tbody>" +
        "<tr><th>ئىسىم</th><th>سان</th><th>ئىزاھ</th></tr>" +
        '<tr><td rowspan="2">ئۈستى</td><td colspan="2">ئىككى ستون</td></tr>' +
        "<tr><td>ئوڭ</td><td>سول</td></tr>" +
        "</tbody></table>",
    );
    const doc = parse(documentXml);
    const tables = doc.getElementsByTagNameNS(W, "tbl");
    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(table.getElementsByTagNameNS(W, "bidiVisual")).toHaveLength(1);

    const rows = Array.from(table.getElementsByTagNameNS(W, "tr"));
    expect(rows).toHaveLength(3);
    // Every row covers three grid columns.
    for (const row of rows) {
      const cells = Array.from(row.getElementsByTagNameNS(W, "tc"));
      const width = cells.reduce((sum, cell) => sum + Number(val(cell, "gridSpan") ?? "1"), 0);
      expect(width).toBe(3);
    }
    expect(val(rows[1].getElementsByTagNameNS(W, "tc")[1], "gridSpan")).toBe("2");
    // The row span: started in row 2, continued in row 3 — in the first column.
    expect(val(rows[1].getElementsByTagNameNS(W, "tc")[0], "vMerge")).toBe("restart");
    const continued = rows[2].getElementsByTagNameNS(W, "tc")[0];
    expect(continued.getElementsByTagNameNS(W, "vMerge")).toHaveLength(1);
    expect(val(continued, "vMerge") ?? "continue").toBe("continue");

    // Each cell's text in a bidirectional paragraph; nothing flattened out of
    // the table. (A merged-away cell holds the bare <w:p/> docx gives it.)
    const written = Array.from(table.getElementsByTagNameNS(W, "p")).filter((paragraph) => paragraphText(paragraph));
    expect(written).toHaveLength(7);
    for (const paragraph of written) {
      expect(paragraph.getElementsByTagNameNS(W, "bidi"), paragraphText(paragraph)).toHaveLength(1);
    }
    expect(textOf(new XMLSerializer().serializeToString(table))).toContain("ئىككى ستون");
    expect(bodyParagraphs(documentXml).map(paragraphText).join("")).not.toContain("ئىسىم");
    // A header cell is bold.
    expect(new XMLSerializer().serializeToString(rows[0])).toContain("<w:b/>");
  });

  it("a short row is filled out to the grid, so Word draws a whole table", async () => {
    const { documentXml } = await openDocx(
      "ف",
      "<table><tr><td>بىر</td><td>ئىككى</td><td>ئۈچ</td></tr><tr><td>يالغۇز</td></tr></table>",
    );
    const rows = Array.from(parse(documentXml).getElementsByTagNameNS(W, "tr"));
    expect(rows.map((row) => row.getElementsByTagNameNS(W, "tc").length)).toEqual([3, 3]);
  });

  /**
   * w:jc in a right-to-left paragraph. In the ECMA-376 1st edition values that
   * every Word reads, `left` and `right` are not physical: in a w:bidi
   * paragraph `left` is the paragraph's START — its right side — and `right`
   * its end. Checked 2026-10-18 against LibreOffice's own code (master):
   *  - import, sw/source/writerfilter/dmapper/DomainMapper.cxx
   *    `handleParaJustification`: ST_Jc `left` and `start` both become
   *    ParagraphAdjust_START, `right` and `end` become ParagraphAdjust_END,
   *    for every DOCX paragraph (only RTF and comments read them literally);
   *  - export, sw/source/filter/ww8/docxattributeoutput.cxx `ParaAdjust`:
   *    a right-to-left paragraph aligned to the physical right is written
   *    `left` in ECMA-376 1st edition mode (`start` in the newer one), and
   *    one aligned to the physical left is written `right` (`end`).
   * Word writes them the same way, which is what LibreOffice mirrors. So:
   * right → left, left → right, centre and justify unchanged.
   */
  it("aligns right-to-left paragraphs the way Word reads w:jc in them", async () => {
    const { documentXml } = await openDocx(
      "ف",
      '<div style="text-align: right">ئوڭ</div>' +
        '<div style="text-align: center">ئوتتۇرا</div>' +
        '<div style="text-align: left">سول</div>' +
        '<div style="text-align: justify">تەكشى</div>' +
        '<div style="text-align: start">باش</div>' +
        '<div style="text-align: end">ئاياغ</div>',
    );
    expect(bodyParagraphs(documentXml).map((paragraph) => val(paragraph, "jc"))).toEqual([
      "left",
      "center",
      "right",
      "both",
      "left",
      "right",
    ]);
  });

  it("alignment comes from any block, outer ones included", async () => {
    const { documentXml } = await openDocx(
      "ف",
      '<blockquote style="text-align: center"><div>بىر</div><p>ئىككى</p></blockquote>' +
        '<div><p style="text-align: left">ئىچكى</p></div>',
    );
    expect(bodyParagraphs(documentXml).map((paragraph) => val(paragraph, "jc"))).toEqual([
      "center",
      "center",
      "right",
    ]);
  });
});

describe("DOCX export uses the notebook's typography", () => {
  const typography = { font: "tuz", fontSize: 20, lineHeight: 2 } as const;

  it("the default run font is the chosen face, for every script slot", async () => {
    const { stylesXml } = await openDocx("ف", "<p>تېكىست</p>", { typography });
    const defaults = parse(stylesXml).getElementsByTagNameNS(W, "rPrDefault")[0];
    const fonts = defaults.getElementsByTagNameNS(W, "rFonts")[0];
    for (const slot of ["ascii", "hAnsi", "cs", "eastAsia"]) {
      expect(fonts.getAttributeNS(W, slot), slot).toBe("UKIJ Tuz");
    }
  });

  it("the default size is the notebook's px size in points, for complex script too", async () => {
    const { stylesXml } = await openDocx("ف", "<p>تېكىست</p>", { typography });
    const defaults = parse(stylesXml).getElementsByTagNameNS(W, "rPrDefault")[0];
    // 20 px × 0.75 = 15 pt = 30 half-points.
    expect(val(defaults, "sz")).toBe("30");
    expect(val(defaults, "szCs")).toBe("30");
  });

  it("line spacing follows the notebook's line height", async () => {
    const { stylesXml } = await openDocx("ف", "<p>تېكىست</p>", { typography });
    const defaults = parse(stylesXml).getElementsByTagNameNS(W, "pPrDefault")[0];
    const spacing = defaults.getElementsByTagNameNS(W, "spacing")[0];
    // 15 pt × 2 = 30 pt = 600 twips, at least — CSS line-height is a line
    // box of exactly that, and "at least" never clips a larger run.
    expect(spacing.getAttributeNS(W, "line")).toBe("600");
    expect(spacing.getAttributeNS(W, "lineRule")).toBe("atLeast");
  });

  it("the defaults are the notebook's own defaults when nothing was chosen", async () => {
    const { stylesXml } = await openDocx("ف", "<p>تېكىست</p>");
    const defaults = parse(stylesXml).getElementsByTagNameNS(W, "rPrDefault")[0];
    expect(defaults.getElementsByTagNameNS(W, "rFonts")[0].getAttributeNS(W, "cs")).toBe("UKIJ Ekran");
    expect(val(defaults, "szCs")).toBe("24");
  });

  it("the title is in the same face, larger", async () => {
    const { stylesXml } = await openDocx("ف", "<p>تېكىست</p>", { typography });
    const title = Array.from(parse(stylesXml).getElementsByTagNameNS(W, "style")).find(
      (style) => style.getAttributeNS(W, "styleId") === "Title",
    )!;
    expect(title.getElementsByTagNameNS(W, "rFonts")[0].getAttributeNS(W, "cs")).toBe("UKIJ Tuz");
    expect(Number(val(title, "szCs"))).toBeGreaterThan(30);
  });

  it("headings scale with the body, so none is smaller than the text", async () => {
    const { stylesXml } = await openDocx("ف", "<h4>كىچىك ماۋزۇ</h4>", { typography });
    const styles = Array.from(parse(stylesXml).getElementsByTagNameNS(W, "style"));
    for (const id of ["Heading1", "Heading2", "Heading3", "Heading4"]) {
      const style = styles.find((element) => element.getAttributeNS(W, "styleId") === id)!;
      expect(Number(val(style, "szCs")), id).toBeGreaterThanOrEqual(30);
    }
  });

  it("an inserted verse keeps its Uthmani face", async () => {
    const html = ayaInsertHtml({ sura: 1, aya: 2, text_ar: "سىناق ئايىتى", text_ug: "سىناق تەرجىمىسى" }, "both", "سىناق");
    const { documentXml } = await openDocx("ف", html, { typography });
    expect(documentXml).toContain('w:cs="Uthmanic Hafs"');
  });
});

describe("DOCX export: sources and credit", () => {
  const source = sourceInsertHtml({
    bookId: 12,
    title: "سىناق كىتاب",
    author: "ئويدۇرما ئاپتور",
    pageNo: 3,
    passage: "نەقىل قىلىنغان جۈملە.",
    query: "",
  });
  const verse = ayaInsertHtml({ sura: 1, aya: 2, text_ar: "سىناق ئايىتى", text_ug: "سىناق تەرجىمىسى" }, "both", "سىناق");
  const label = "«سىناق كىتاب» — ئويدۇرما ئاپتور — 3-بەت";

  it("with footnotes off, a citation stays an inline link, as before", async () => {
    const { documentXml, rels } = await openDocx("ف", `<p>مېنىڭ سۆزۈم.</p>${source}`);
    expect(textOf(documentXml)).toContain(label);
    expect(rels).toContain("http://localhost:3000/books/12/read?page=3");
    expect(documentXml).not.toContain("w:footnoteReference");
  });

  it("with footnotes on, the citation is a footnote marked at the end of the passage", async () => {
    const { documentXml, footnotesXml, footnoteRels } = await openDocx("ف", `<p>مېنىڭ سۆزۈم.</p>${source}${verse}`, {
      footnotes: true,
    });
    // Not repeated in the body.
    expect(textOf(documentXml)).not.toContain(label);
    expect(textOf(documentXml)).not.toContain("قۇرئان كەرىم — سىناق — 1:2");

    // The label and the absolute address, in the footnotes.
    const notes = textOf(footnotesXml);
    expect(notes).toContain(label);
    expect(notes).toContain("قۇرئان كەرىم — سىناق — 1:2");
    expect(notes).toContain("http://localhost:3000/books/12/read?page=3");
    expect(notes).toContain("http://localhost:3000/quran/1?aya=2");
    // Each footnote's link resolves in the footnotes' OWN relationships —
    // an r:id Word cannot find there makes it call the file damaged.
    const ids = [...footnotesXml.matchAll(/<w:hyperlink[^>]*r:id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(footnoteRels).toMatch(new RegExp(`Id="${id}"[^>]*Target="http://localhost:3000/`));
    // And they are set as footnotes, small, not at the body's size.
    expect(footnotesXml.match(/<w:pStyle w:val="FootnoteText"\/>/g)).toHaveLength(2);

    // The marks sit in the passage's paragraph and in the verse's, at the end.
    const paragraphs = bodyParagraphs(documentXml);
    const marked = paragraphs.filter((paragraph) => paragraph.getElementsByTagNameNS(W, "footnoteReference").length > 0);
    expect(marked.map(paragraphText)).toEqual([
      "نەقىل قىلىنغان جۈملە.",
      "﴿سىناق ئايىتى﴾«سىناق تەرجىمىسى»",
    ]);
    for (const paragraph of marked) {
      const runs = Array.from(paragraph.getElementsByTagNameNS(W, "r"));
      expect(runs.at(-1)!.getElementsByTagNameNS(W, "footnoteReference")).toHaveLength(1);
    }
  });

  it("a citation with nothing quoted before it still gets its footnote", async () => {
    const { documentXml, footnotesXml } = await openDocx("ف", source.replace(/^<blockquote[^>]*>.*?<\/blockquote>/, ""), {
      footnotes: true,
    });
    expect(documentXml).toContain("w:footnoteReference");
    expect(textOf(footnotesXml)).toContain(label);
  });

  it("appends the Qur'an's credit when a verse is in the note, and only then", async () => {
    const withVerse = await openDocx("ف", `<p>سۆز</p>${verse}`);
    expect(textOf(withVerse.documentXml)).toContain("Tanzil Project");
    const withFootnotes = await openDocx("ف", `<p>سۆز</p>${verse}`, { footnotes: true });
    expect(textOf(withFootnotes.documentXml)).toContain("Tanzil Project");
    const without = await openDocx("ف", `<p>سۆز</p>${source}`);
    expect(textOf(without.documentXml)).not.toContain("Tanzil Project");
  });
});
