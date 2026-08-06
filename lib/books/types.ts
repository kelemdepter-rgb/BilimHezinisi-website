export type BookStatus = "draft" | "published";

export type BookFormat = "PDF" | "TXT" | "DOCX" | "DOC" | "MD" | "HTML" | "URL";

/** Result of extracting one source file in the browser. */
export type ExtractedBook = {
  fileName: string;
  format: BookFormat;
  /** Plain text, already normalized. */
  text: string;
  /** SHA-256 over `text` — duplicate detection, desktop parity. */
  fileHash: string;
  /** Guessed metadata, editable in the wizard. */
  title: string;
  author: string;
  date: string;
  /** PDF page count when known (informational only). */
  sourcePageCount?: number;
  /** True when a PDF has no usable text layer — must be OCR'd in the desktop app. */
  scanned: boolean;
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
