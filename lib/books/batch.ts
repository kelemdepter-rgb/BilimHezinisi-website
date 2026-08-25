/**
 * Importing a folder of books, one review screen for all of them.
 *
 * The desktop's «توپلاپ كىتاب قوشۇش» takes a folder, gives every book the same
 * category and takes the title from the filename. That is not enough here: the
 * books that share a folder do not share a title, and some of them are ready to
 * publish while others are not. So the shape of this module is one editable
 * row per file, pre-filled from what the file itself says and nothing more.
 *
 * THE RULE FOR SUGGESTIONS. Every pre-filled value is marked as a suggestion,
 * and a suggestion is only ever made from something the file actually
 * contains — its own first heading, its own `dc:creator`, its own opening
 * paragraph. An author who is not named in the file leaves the field empty.
 * Inventing a plausible-looking author for a library of religious and
 * historical texts would be worse than leaving the work to be done by hand.
 */
import { stripMarkdown } from "@/lib/books/strip-markdown";
import { isUsableEmbeddedTitle, titleFromFileName } from "@/lib/books/metadata";
import type { BookFormat, BookStatus, ContentFormat } from "@/lib/books/types";
import type { DuplicateHit } from "@/lib/books/save";

/** How long a suggested description may be before it stops being one. */
export const MAX_SUGGESTED_DESCRIPTION = 220;
/** A heading longer than this is a paragraph that happens to start a file. */
const MAX_SUGGESTED_TITLE = 120;

/**
 * A filename turned into something a person would have typed.
 *
 * `03_قۇتادغۇ-بىلىك.docx` → `قۇتادغۇ بىلىك`. The leading numbering goes
 * because it orders files in a folder and says nothing about the book;
 * underscores and dashes were only ever standing in for spaces.
 */
export function titleFromCleanFileName(fileName: string): string {
  return titleFromFileName(fileName)
    .replace(/^\s*\d{1,3}\s*[.)\-_]\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The document's own first heading — a Markdown `#`, which is also what
 * mammoth turns a DOCX `Heading 1` into by the time extraction is done.
 */
export function firstHeading(text: string): string {
  for (const line of text.split("\n", 60)) {
    const found = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (!found) continue;
    const heading = stripMarkdown(found[1]).trim();
    if (heading.length >= 2 && heading.length <= MAX_SUGGESTED_TITLE) return heading;
  }
  return "";
}

/**
 * The opening paragraph, for a description. Headings are skipped — a heading
 * describes nothing that the title does not already say.
 */
export function openingParagraph(text: string): string {
  for (const block of text.split(/\n{2,}/, 20)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^[ \t]{0,3}#{1,6}[ \t]+/.test(trimmed)) continue;
    const plain = stripMarkdown(trimmed).replace(/\s+/g, " ").trim();
    if (plain.length < 40) continue;
    if (plain.length <= MAX_SUGGESTED_DESCRIPTION) return plain;
    // Cut on a word boundary, so a description never ends mid-word.
    const cut = plain.slice(0, MAX_SUGGESTED_DESCRIPTION);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }
  return "";
}

/** The metadata the admin edits, one set per file. */
export type BatchMeta = {
  title: string;
  author: string;
  description: string;
  categoryId: string;
  status: BookStatus;
};

/** Which of those values came from the file rather than from the admin. */
export type SuggestedFlags = { title: boolean; author: boolean; description: boolean };

export type Suggestion = { meta: Pick<BatchMeta, "title" | "author" | "description">; suggested: SuggestedFlags };

/**
 * Pre-fill one row from the file itself.
 *
 * The title always has a value — the cleaned filename is the last resort and
 * is still a suggestion, because a filename is a guess about a title. The
 * author and the description are only filled when the file states them.
 */
export function suggestMetadata(input: {
  fileName: string;
  text: string;
  embeddedTitle?: string;
  embeddedAuthor?: string;
}): Suggestion {
  const embeddedTitle = (input.embeddedTitle ?? "").trim();
  const heading = firstHeading(input.text);
  // Word leaves "Microsoft Word - report.doc" behind on a save-as; that is the
  // producer talking, not the document. Same judgement as the single-book
  // wizard's, from the same function.
  const usableEmbedded = isUsableEmbeddedTitle(embeddedTitle);

  const title = heading || (usableEmbedded ? embeddedTitle : "") || titleFromCleanFileName(input.fileName);
  const author = (input.embeddedAuthor ?? "").trim();
  const description = openingParagraph(input.text);

  return {
    meta: { title, author, description },
    suggested: {
      title: Boolean(title),
      author: Boolean(author),
      description: Boolean(description),
    },
  };
}

/** Where a row is in its life, from picked to written. */
export type BatchRowStatus =
  | "queued"
  | "reading"
  | "ready"
  | "rejected"
  | "failed"
  | "importing"
  | "imported"
  | "skipped";

export type BatchRow = {
  /** Filename plus size — stable across a reload, which is what D2 needs. */
  id: string;
  fileName: string;
  size: number;
  format: BookFormat | null;
  contentFormat: ContentFormat;
  status: BatchRowStatus;
  error: string;
  pages: string[];
  /** UTF-8 bytes of the extracted text, for the free-tier estimate. */
  textBytes: number;
  fileHash: string;
  duplicate: DuplicateHit | null;
  /** The admin's answer to a duplicate: skip it, or import it anyway. */
  skipDuplicate: boolean;
  selected: boolean;
  meta: BatchMeta;
  suggested: SuggestedFlags;
  /** Set once the row has been written, so the summary can link to it. */
  bookId: number | null;
};

/** Filename plus size. File handles cannot be persisted; this identity can. */
export function rowKey(file: { name: string; size: number }): string {
  return `${file.name}::${file.size}`;
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Rows the import will actually write. */
export function importableRows(rows: BatchRow[]): BatchRow[] {
  return rows.filter((row) => row.status === "ready" && !(row.duplicate && row.skipDuplicate));
}

/**
 * Every importable row needs a title and a category before anything is
 * written — the alternative is a library of untitled books in no category,
 * which is how a collection stops being usable.
 */
export function readyToImport(rows: BatchRow[]): boolean {
  const importable = importableRows(rows);
  if (importable.length === 0) return false;
  return importable.every((row) => row.meta.title.trim() !== "" && row.meta.categoryId !== "");
}

/** Total pages and bytes the batch would add, for the headroom warning. */
export function batchSize(rows: BatchRow[]): { pages: number; bytes: number } {
  let pages = 0;
  let bytes = 0;
  for (const row of importableRows(rows)) {
    pages += row.pages.length;
    bytes += row.textBytes;
  }
  return { pages, bytes };
}

/**
 * When the database has never stored a page there is nothing to measure, so
 * the estimate falls back to a multiple of the extracted text. Uyghur is
 * multi-byte, and every stored page carries a search vector and its indexes on
 * top of its own bytes, so the stored cost is well above the text's own size.
 */
export const FALLBACK_BYTES_PER_TEXT_BYTE = 2.6;

export type BudgetInput = {
  /** What the database uses now, and where it stops being comfortable. */
  dbBytes: number;
  safeBytes: number;
  /** Measured cost of one stored page; 0 when there is nothing to measure. */
  bytesPerPage: number;
  available: boolean;
  pages: number;
  textBytes: number;
};

export type Budget = {
  estimatedBytes: number;
  projectedBytes: number;
  /** True when writing this batch would cross the comfortable line. */
  overBudget: boolean;
};

/**
 * What a batch would cost, and whether that is too much.
 *
 * Separated from the screen so the boundary can be tested at, just under and
 * just over the line — the 500 MB wall has to be visible before it is hit, and
 * "we showed a warning" is not something to find out about afterwards.
 */
export function projectBudget(input: BudgetInput): Budget {
  const estimatedBytes =
    input.bytesPerPage > 0
      ? Math.round(input.pages * input.bytesPerPage)
      : Math.round(input.textBytes * FALLBACK_BYTES_PER_TEXT_BYTE);
  const projectedBytes = input.dbBytes + estimatedBytes;
  return {
    estimatedBytes,
    projectedBytes,
    // Nothing measured means nothing to warn about — an invented warning would
    // be worse than none, because it would teach the admin to ignore them.
    overBudget: input.available && projectedBytes > input.safeBytes,
  };
}

/** Sort orders the review table offers, so like books can be handled together. */
export type BatchSort = "picked" | "name" | "size" | "pages" | "title";

export function sortRows(rows: BatchRow[], by: BatchSort): BatchRow[] {
  if (by === "picked") return rows;
  const sorted = [...rows];
  const collator = new Intl.Collator("ug");
  sorted.sort((a, b) => {
    switch (by) {
      case "name":
        return collator.compare(a.fileName, b.fileName);
      case "title":
        return collator.compare(a.meta.title, b.meta.title);
      case "size":
        return b.size - a.size;
      case "pages":
        return b.pages.length - a.pages.length;
      default:
        return 0;
    }
  });
  return sorted;
}
