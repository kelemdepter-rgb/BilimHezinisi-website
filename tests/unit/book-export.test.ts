// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildBookDocx,
  buildBookText,
  EXPORT_FONT,
  exportFileName,
  sourceLine,
  textFileExtension,
  type BookExportMeta,
} from "@/lib/books/export-book";

/**
 * A book export that opens left-to-right in Word is a failed feature, not a
 * partial one — so the direction properties are read back out of the archive
 * rather than trusted. `.docx` is a zip of XML; these tests unzip it and look.
 */

const MD: BookExportMeta = {
  title: "قۇتادغۇ بىلىك",
  author: "يۈسۈپ خاس ھاجىپ",
  contentFormat: "markdown",
  sourceUrl: "https://bilim-hezinisi-website.vercel.app/books/7",
};

const TXT: BookExportMeta = { ...MD, contentFormat: "text" };

async function open(meta: BookExportMeta, pages: string[]) {
  const blob = await buildBookDocx(meta, pages);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return { blob, zip, xml: await zip.file("word/document.xml")!.async("string") };
}

/** Word splits text across runs; compare on the text content alone. */
const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");

describe("the DOCX a reader keeps", () => {
  it("produces an archive Word can open", async () => {
    const { blob, zip } = await open(TXT, ["بىرىنچى بەت"]);
    expect(blob.size).toBeGreaterThan(1000);
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
      expect(zip.file(part), part).not.toBeNull();
    }
  });

  it("marks every paragraph bidirectional and right-aligned", async () => {
    const { xml } = await open(TXT, ["ئۇيغۇرچە قۇر"]);
    expect(xml, "w:bidi is what tells Word the paragraph runs right to left").toContain(
      "<w:bidi/>",
    );
    expect(xml).toMatch(/<w:jc w:val="right"\/>/);
  });

  it("marks every run right-to-left", async () => {
    const { xml } = await open(TXT, ["ئۇيغۇرچە قۇر"]);
    expect(xml, "w:rtl on the run keeps punctuation and digits in place").toContain("<w:rtl/>");
    // One <w:rtl/> per run, not just one in the whole document.
    const runs = xml.match(/<w:rtl\/>/g) ?? [];
    expect(runs.length).toBeGreaterThan(1);
  });

  it("names the font for complex script, not only for Latin", async () => {
    const { xml } = await open(TXT, ["ئۇيغۇرچە"]);
    // Word picks the face for Arabic script from w:cs; naming only w:ascii
    // would leave Uyghur to whatever Word felt like substituting.
    expect(xml).toContain(`w:cs="${EXPORT_FONT}"`);
    expect(xml).toContain(`w:ascii="${EXPORT_FONT}"`);
  });

  it("carries the title, the author and where the book came from", async () => {
    const { xml } = await open(TXT, ["مەزمۇن"]);
    const text = textOf(xml);
    expect(text).toContain(MD.title);
    expect(text).toContain(MD.author);
    expect(text).toContain(MD.sourceUrl);
    expect(text).toContain("بىلىم خەزىنىسى");
  });

  it("keeps every page of the book, in order", async () => {
    const { xml } = await open(TXT, ["بىرىنچى", "ئىككىنچى", "ئۈچىنچى"]);
    const text = textOf(xml);
    expect(text.indexOf("بىرىنچى")).toBeLessThan(text.indexOf("ئىككىنچى"));
    expect(text.indexOf("ئىككىنچى")).toBeLessThan(text.indexOf("ئۈچىنچى"));
  });

  it("keeps a Markdown book's headings, emphasis, lists and quotes", async () => {
    const { xml } = await open(MD, [
      "## بىرىنچى باب\n\nئاددىي **توم** ۋە *يانتۇ* تېكىست.\n\n- بىر\n- ئىككى\n\n> نەقىل\n",
    ]);
    expect(xml).toContain("Heading2");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("ListParagraph");
    const text = textOf(xml);
    expect(text).toContain("بىرىنچى باب");
    expect(text).toContain("نەقىل");
    // The Markdown syntax itself must not survive into the document.
    expect(text).not.toContain("**");
    expect(text).not.toContain("## ");
  });

  it("keeps a Markdown table, laid out right to left", async () => {
    const { xml } = await open(MD, ["| ئىسىم | يىل |\n| --- | --- |\n| بابۇر | 1483 |\n"]);
    expect(xml).toContain("<w:tbl>");
    expect(xml, "the first column must sit on the right").toContain("<w:bidiVisual/>");
    expect(textOf(xml)).toContain("بابۇر");
  });

  it("leaves a plain-text book's Markdown-looking characters alone", async () => {
    // A text book was never Markdown: "# 1" is a heading nowhere, it is text.
    const { xml } = await open(TXT, ["# بۇ ماۋزۇ ئەمەس", "**يۇلتۇز**"]);
    const text = textOf(xml);
    expect(text).toContain("# بۇ ماۋزۇ ئەمەس");
    expect(text).toContain("**يۇلتۇز**");
  });

  it("still writes a file for a book with no pages", async () => {
    const { blob, xml } = await open(TXT, []);
    expect(blob.size).toBeGreaterThan(1000);
    expect(textOf(xml)).toContain(MD.title);
  });
});

describe("the text file a reader keeps", () => {
  it("keeps a Markdown book as Markdown", () => {
    const out = buildBookText(MD, ["## باب\n\nمەزمۇن"]);
    expect(out).toContain(`# ${MD.title}`);
    expect(out).toContain(`**${MD.author}**`);
    expect(out).toContain(sourceLine(MD));
    // The formatting is the content here — stripping it would lose the book.
    expect(out).toContain("## باب");
    expect(textFileExtension("markdown")).toBe("md");
  });

  it("writes a plain-text book plainly", () => {
    const out = buildBookText(TXT, ["بىرىنچى بەت", "ئىككىنچى بەت"]);
    expect(out.startsWith(TXT.title)).toBe(true);
    expect(out).toContain(TXT.author);
    expect(out).toContain(sourceLine(TXT));
    expect(out).toContain("بىرىنچى بەت");
    expect(out).toContain("ئىككىنچى بەت");
    expect(out).not.toContain("#");
    expect(textFileExtension("text")).toBe("txt");
  });

  it("omits the author line when a book has none", () => {
    const out = buildBookText({ ...TXT, author: "" }, ["مەزمۇن"]);
    expect(out.split("\n")[1]).toBe(sourceLine({ ...TXT, author: "" }));
  });
});

describe("file names", () => {
  it("drops the characters Windows refuses", () => {
    expect(exportFileName('كىتاب: 1/2 <سىناق>', "docx")).toBe("كىتاب_ 1_2 _سىناق_.docx");
  });

  it("falls back to a name rather than producing a bare extension", () => {
    expect(exportFileName("   ", "txt")).toBe("كىتاب.txt");
  });

  it("keeps the name short enough for every filesystem", () => {
    expect(exportFileName("ب".repeat(200), "docx").length).toBeLessThanOrEqual(85);
  });
});
