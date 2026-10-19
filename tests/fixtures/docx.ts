import { crc32 } from "node:zlib";

/**
 * Build a minimal but genuinely valid .docx in memory, so the upload test
 * exercises the real mammoth → turndown path rather than a stand-in.
 *
 * A .docx is a ZIP of OOXML parts. Entries are STORED (uncompressed), which
 * keeps the writer short and is perfectly legal ZIP.
 */

type Entry = { name: string; data: Buffer };

function localHeader(entry: Entry, crc: number): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0, 12); // mod date
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(entry.data.length, 18); // compressed size
  header.writeUInt32LE(entry.data.length, 22); // uncompressed size
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([header, name]);
}

function centralEntry(entry: Entry, crc: number, offset: number): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); // central directory signature
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10); // stored
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk
  header.writeUInt16LE(0, 36); // internal attrs
  header.writeUInt32LE(0, 38); // external attrs
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function zip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const crc = crc32(entry.data) >>> 0;
    const local = localHeader(entry, crc);
    parts.push(local, entry.data);
    central.push(centralEntry(entry, crc, offset));
    offset += local.length + entry.data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuffer, end]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function paragraph(text: string, style?: string): string {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function boldParagraph(plain: string, bold: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${plain} </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>${bold}</w:t></w:r></w:p>`;
}

function tableXml(): string {
  const cell = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
  const row = (a: string, b: string) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;
  return `<w:tbl>${row("ئىسىم", "سان")}${row("بىرىنچى", "1")}${row("ئىككىنچى", "2")}</w:tbl>`;
}

/** Headings, bold text, a list and a table — the formatting that must survive. */
export const DOCX_HEADING = "بىرىنچى باب";
export const DOCX_BOLD = "ناھايىتى مۇھىم";
export const DOCX_TABLE_CELL = "بىرىنچى";
export const DOCX_NEEDLE = "ئالتۇنكۆۋرۈك";

/**
 * A table of contents the way Word writes one: each entry a hyperlink to a
 * bookmark (`w:hyperlink w:anchor`, or a HYPERLINK \l field), the bookmark a
 * `w:bookmarkStart` on the chapter's heading, the printed page number inside
 * the link after a tab or outside it, and a footnote. Invented text; enough
 * of it that the chapters land on different pages once chunked.
 */
export const TOC_DOCX_CHAPTERS = [
  { anchor: "_Toc101", heading: "كىرىش سۆز", entry: "1. كىرىش سۆز", page: "3", placement: "inside" },
  { anchor: "_Toc102", heading: "تاغ ۋە دەريا", entry: "2. تاغ ۋە دەريا", page: "5", placement: "outside" },
  { anchor: "_Toc103", heading: "ئاخىرقى سۆز", entry: "3. ئاخىرقى سۆز", page: "9", placement: "field" },
] as const;

export function buildTocDocx(): Buffer {
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const tab = "<w:r><w:tab/></w:r>";
  const entries = TOC_DOCX_CHAPTERS.map((chapter) => {
    if (chapter.placement === "inside") {
      return `<w:p><w:hyperlink w:anchor="${chapter.anchor}">${run(chapter.entry)}${tab}${run(chapter.page)}</w:hyperlink></w:p>`;
    }
    if (chapter.placement === "outside") {
      return `<w:p><w:hyperlink w:anchor="${chapter.anchor}">${run(chapter.entry)}</w:hyperlink>${run(` ${chapter.page}`)}</w:p>`;
    }
    return (
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> HYPERLINK \\l "${chapter.anchor}" </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(chapter.entry)}${tab}${run(chapter.page)}` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
  });

  const filler = paragraph("بۇ پاراگراف پەقەت سىناق ئۈچۈن يېزىلغان ئويدۇرما تېكىست، ھېچقانداق كىتابتىن ئېلىنمىغان. ".repeat(6));
  const chapters = TOC_DOCX_CHAPTERS.map((chapter, index) => {
    const heading =
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
      `<w:bookmarkStart w:id="${index}" w:name="${chapter.anchor}"/>${run(chapter.heading)}<w:bookmarkEnd w:id="${index}"/></w:p>`;
    const note =
      index === 1
        ? `<w:p>${run("دەريا بويىدا بىر كونا تېرەك بار ئىدى")}<w:r><w:footnoteReference w:id="1"/></w:r>${run(".")}</w:p>`
        : "";
    return heading + note + filler.repeat(8);
  });

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraph("مۇندەرىجە")}${entries.join("")}${chapters.join("")}</w:body>
</w:document>`;

  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  <w:footnote w:id="1">${paragraph("بۇ تېرەكنىڭ يېشى توغرىسىدىكى ئويدۇرما ئىزاھات.")}</w:footnote>
</w:footnotes>`;

  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(RELS, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
    { name: "word/footnotes.xml", data: Buffer.from(footnotes, "utf8") },
  ]);
}

export function buildTestDocx(): Buffer {
  const body = [
    paragraph(DOCX_HEADING, "Heading1"),
    paragraph(`بۇ بەتتە ${DOCX_NEEDLE} دېگەن سۆز بار.`),
    boldParagraph("بۇ جۈملىدە", DOCX_BOLD),
    paragraph("ئىككىنچى بۆلۈم", "Heading2"),
    paragraph("بىرىنچى تۈر", "ListParagraph"),
    paragraph("ئىككىنچى تۈر", "ListParagraph"),
    tableXml(),
    paragraph("ئاخىرقى پاراگراف. ".repeat(20)),
  ].join("");

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;

  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(RELS, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
  ]);
}
