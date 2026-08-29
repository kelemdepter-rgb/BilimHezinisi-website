/**
 * Handing a finished file to the reader.
 *
 * These two live apart from lib/books/export-book on purpose. That module
 * imports the whole `docx` package, which bundles JSZip — about 340 KB of
 * JavaScript. The quote card needs nothing from it but a safe file name and a
 * way to save a Blob, and importing those two functions from there put the
 * entire DOCX writer into the first load of the reader, on every book, for
 * every reader. Keep this file free of heavy imports.
 */

/** A file name a filesystem will accept, from a book or note title. */
export function exportFileName(title: string, extension: string): string {
  const safe = title.replace(/[\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe || "كىتاب"}.${extension}`;
}

/** Save a Blob to the reader's downloads. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — Safari needs the URL alive when the click lands.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
