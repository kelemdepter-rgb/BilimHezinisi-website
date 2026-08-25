export type BookStatus = "draft" | "published";

/**
 * Formats the web edition accepts. PDF is deliberately absent: scanned PDFs
 * need OCR the web cannot do, and the parser bloats the phone bundle. The
 * desktop app handles PDFs and exports DOCX (CLAUDE.md, Upload Pipeline).
 */
export type BookFormat = "TXT" | "DOCX" | "DOC" | "MD" | "HTML" | "URL";

/** How a book's pages are stored, so the reader knows how to render them. */
export type ContentFormat = "markdown" | "text";

/** Result of extracting one source file in the browser. */
export type ExtractedBook = {
  fileName: string;
  format: BookFormat;
  /** Markdown or plain text, already normalized — see `contentFormat`. */
  text: string;
  contentFormat: ContentFormat;
  /** SHA-256 over `text` — duplicate detection, desktop parity. */
  fileHash: string;
  /** Guessed metadata, editable in the wizard. */
  title: string;
  author: string;
  /**
   * What the FILE itself states, before anything was guessed from it — a
   * DOCX's `docProps/core.xml`. Empty when the file says nothing, which is
   * what lets the batch import leave an author field blank rather than
   * inventing one.
   */
  embeddedTitle?: string;
  embeddedAuthor?: string;
  date: string;
  /** Original bytes, kept only when the admin opts to store the source file. */
  file?: File;
};

export type BookMetadataInput = {
  title: string;
  author: string;
  categoryId: number | null;
  date: string;
  description: string;
  language: string;
  status: BookStatus;
};
