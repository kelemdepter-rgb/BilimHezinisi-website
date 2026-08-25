// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readDocxProperties } from "@/lib/books/docx-props";

/**
 * Reading the author out of a .docx, with a zip reader written for the job.
 *
 * The archives here are real ones, built both ways a producer might: STORED
 * (Word does this for tiny parts) and DEFLATED (everything else). A reader
 * that only handles one of them looks correct until the day it meets the
 * other, which is why both are exercised.
 */

const CORE_XML = (title: string, author: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${title}</dc:title>
  <dc:creator>${author}</dc:creator>
</cp:coreProperties>`;

async function buildDocx(options: {
  title?: string;
  author?: string;
  compression?: "STORE" | "DEFLATE";
  omitCore?: boolean;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  // A couple of other parts, so the entry being looked for is not the first
  // one in the central directory.
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<w:document/>");
  if (!options.omitCore) {
    zip.file("docProps/core.xml", CORE_XML(options.title ?? "", options.author ?? ""));
  }
  zip.file("word/styles.xml", "<w:styles/>");

  const blob = await zip.generateAsync({
    type: "arraybuffer",
    compression: options.compression ?? "DEFLATE",
  });
  return blob;
}

describe("reading a .docx's own properties", () => {
  it("reads the title and author from a deflated archive", async () => {
    const buffer = await buildDocx({ title: "قۇتادغۇ بىلىك", author: "يۈسۈپ خاس ھاجىپ" });
    expect(await readDocxProperties(buffer)).toEqual({
      title: "قۇتادغۇ بىلىك",
      author: "يۈسۈپ خاس ھاجىپ",
    });
  });

  it("reads them from a stored (uncompressed) archive too", async () => {
    const buffer = await buildDocx({
      title: "دىۋان",
      author: "مەھمۇد كاشغەرى",
      compression: "STORE",
    });
    expect(await readDocxProperties(buffer)).toEqual({
      title: "دىۋان",
      author: "مەھمۇد كاشغەرى",
    });
  });

  it("returns nothing rather than guessing when the author is blank", async () => {
    const buffer = await buildDocx({ title: "ماۋزۇ", author: "" });
    expect(await readDocxProperties(buffer)).toEqual({ title: "ماۋزۇ", author: "" });
  });

  it("returns nothing when the archive has no core.xml", async () => {
    const buffer = await buildDocx({ omitCore: true });
    expect(await readDocxProperties(buffer)).toEqual({ title: "", author: "" });
  });

  it("survives a file that is not a zip at all", async () => {
    const bytes = new TextEncoder().encode("bu bir zip emes");
    expect(await readDocxProperties(bytes.buffer as ArrayBuffer)).toEqual({
      title: "",
      author: "",
    });
  });

  it("survives a truncated archive", async () => {
    const buffer = await buildDocx({ title: "ماۋزۇ", author: "ئاپتور" });
    const cut = buffer.slice(0, Math.floor(buffer.byteLength / 2));
    expect(await readDocxProperties(cut)).toEqual({ title: "", author: "" });
  });
});
