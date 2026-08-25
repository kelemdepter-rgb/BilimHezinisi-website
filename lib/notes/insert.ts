/**
 * What a citation looks like once it is inside a note.
 *
 * The desktop app inserts a blockquote with a small grey line under it
 * (`notesInsertRef` in src/notes.js) and a bracketed verse in the Uthmani face
 * (`notesInsertAya`). This is that markup, with two things the web edition
 * needs and the desktop did not:
 *
 *  - a link back to the exact page, because on the web there is somewhere to
 *    go and a note is worth nothing if the passage cannot be found again;
 *  - a shape that survives lib/notes/sanitize-server.ts. Everything emitted
 *    here uses only tags and declarations the note allow-list admits, so what
 *    the writer sees on insert is what comes back after a save and a reload.
 *    A unit test holds this to it — tests/unit/note-insert.test.ts.
 */
import { ayaHtml, escapeHtml, type AyaRenderMode } from "@/lib/quran/copy";
import type { Aya } from "@/lib/quran/types";

/** Small and grey, and legible on the paper, sepia and dark themes alike. */
const CITE_STYLE = "font-size:13px;color:#8a8a8a";

/** A passage cited from a book in the library. */
export type SourceCitation = {
  bookId: number;
  title: string;
  author: string;
  /** 0 for a title match, which has no page to point at. */
  pageNo: number;
  passage: string;
  /** What was searched for, so the reader opens with it highlighted. */
  query: string;
};

/** `/books/12/read?page=3&q=…` — the reader, at the occurrence. */
export function readerHref(citation: Pick<SourceCitation, "bookId" | "pageNo" | "query">): string {
  const params = new URLSearchParams();
  if (citation.pageNo > 0) params.set("page", String(citation.pageNo));
  if (citation.query.trim()) params.set("q", citation.query.trim());
  const query = params.toString();
  return `/books/${citation.bookId}/read${query ? `?${query}` : ""}`;
}

/** «ماۋزۇ» — ئاپتور — 3-بەت, with the parts that exist and no empty separators. */
export function citationLabel(citation: SourceCitation): string {
  const parts = [`«${citation.title}»`];
  if (citation.author.trim()) parts.push(citation.author.trim());
  if (citation.pageNo > 0) parts.push(`${citation.pageNo}-بەت`);
  return parts.join(" — ");
}

/**
 * A blockquote holding the passage, then the citation line as a link.
 *
 * The trailing empty paragraph is deliberate: without it the caret is left
 * inside the quotation and the next thing typed joins the citation, which is
 * exactly the annoyance the desktop's `<p><br></p>` tail exists to prevent.
 */
export function sourceInsertHtml(citation: SourceCitation): string {
  const passage = escapeHtml(citation.passage.replace(/\s+/g, " ").trim());
  const href = escapeHtml(readerHref(citation));
  const label = escapeHtml(citationLabel(citation));

  return (
    `<blockquote dir="rtl">${passage}</blockquote>` +
    `<p dir="rtl" style="${CITE_STYLE}"><a href="${href}">${label}</a></p>` +
    `<p><br></p>`
  );
}

/** Where the mushaf opens the verse. */
export function ayaHref(sura: number, aya: number): string {
  return `/quran/${sura}?aya=${aya}`;
}

/**
 * A verse, exactly as the mushaf's copy action formats it, followed by its
 * reference. The reference is not decoration: a verse in a note that does not
 * say which verse it is cannot be checked by the person reading the note.
 */
export function ayaInsertHtml(aya: Aya, mode: AyaRenderMode, suraName: string): string {
  const reference = `${aya.sura}:${aya.aya}`;
  const label = escapeHtml(
    suraName ? `قۇرئان كەرىم — ${suraName} — ${reference}` : `قۇرئان كەرىم — ${reference}`,
  );
  const href = escapeHtml(ayaHref(aya.sura, aya.aya));

  return (
    ayaHtml(aya, mode) +
    `<p dir="rtl" style="${CITE_STYLE}"><a href="${href}">${label}</a></p>` +
    `<p><br></p>`
  );
}
