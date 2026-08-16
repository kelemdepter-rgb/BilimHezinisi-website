// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildDocx } from "@/lib/notes/export-docx";

/**
 * A .docx is a zip of XML. "Valid" here means the archive really opens, the
 * parts Word requires are present, and the writing is inside — checked by
 * reading the file back rather than trusting the builder.
 */
async function openDocx(title: string, html: string) {
  const blob = await buildDocx(title, html);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")!.async("string");
  return { blob, zip, documentXml };
}

/** Word's XML splits text across runs; compare on the text content alone. */
const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");

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

  it("keeps bold, italic and underline", async () => {
    const { documentXml } = await openDocx(
      "ف",
      "<p><b>توم</b><i>يانتۇ</i><u>سىزىق</u></p>",
    );
    expect(documentXml).toContain("<w:b/>");
    expect(documentXml).toContain("<w:i/>");
    expect(documentXml).toMatch(/<w:u\b/);
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
