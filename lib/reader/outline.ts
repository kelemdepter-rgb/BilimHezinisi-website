/**
 * A book's outline: its headings, its `#…` links and its code fences, in
 * document order — what `public.book_outline` (migration 0032) answers, and
 * what lib/reader/internal-links.ts resolves a table-of-contents or note link
 * against.
 *
 * `outlineFromPages` is that function's twin for the browser. It runs where
 * the database cannot be asked: offline, over the pages already on screen; in
 * the e2e stub; and in the import test, over pages that never reached a
 * database. tests/unit/book-outline-sql.test.ts holds the two to the same
 * answer, entry for entry, so they cannot drift apart unnoticed.
 */

/** An ATX heading: level 1–6 and its text as written. */
export type HeadingEntry = [page: number, kind: "h", level: number, text: string];
/** An inline link to `#fragment`: the label as written and the fragment without `#`. */
export type LinkEntry = [page: number, kind: "l", label: string, fragment: string];
/** A line opening or closing a fenced code block: its marker run and info string. */
export type FenceEntry = [page: number, kind: "f", marker: string, info: string];
export type OutlineEntry = HeadingEntry | LinkEntry | FenceEntry;

export type BookOutline = { v: 1; capped: boolean; entries: OutlineEntry[] };

/** Past this the outline stops, and says so. Matches the SQL. */
export const OUTLINE_MAX_ENTRIES = 5000;
const TEXT_CAP = 300;
const FRAGMENT_CAP = 200;
const INFO_CAP = 100;

/**
 * The migration's expression, written for JavaScript.
 *
 * Postgres runs it with the 'w' flag: ^ and $ match at line breaks and
 * nothing else changes. JavaScript's `m` flag would also let them match at
 * \r, U+2028 and U+2029, so a line start is spelled out as "the start, or a
 * newline" — consumed rather than looked behind for, because Safari before
 * 16.4 has no lookbehind and the whole chunk would fail to load there. A
 * heading or fence never consumes the newline that ends it, so the next line
 * still finds its own. `\\.` in Postgres matches a newline under 'w';
 * `\\[\s\S]` is the same here.
 */
const OUTLINE_PATTERN = new RegExp(
  [
    String.raw`(?:^|\n) {0,3}(#{1,6})[ \t]+([^\n]*)(?=\n|$)`,
    String.raw`(?:^|\n) {0,3}(\`{3,}|~{3,})([^\n]*)(?=\n|$)`,
    String.raw`\[((?:[^\][\\]|\\[\s\S])*)\]\(#((?:[^() \t\n\r\f\v\\]|\\[\s\S])*)(?:[ \t]+"[^"\n]*")?\)`,
  ].join("|"),
  "g",
);

/** `left(text, n)`: the first n characters — code points, as Postgres counts. */
function left(text: string, count: number): string {
  const characters = Array.from(text);
  return characters.length <= count ? text : characters.slice(0, count).join("");
}

/** Every entry of the book, in order, from its pages' stored text. */
export function outlineFromPages(pages: { page_no: number; content: string }[]): BookOutline {
  const entries: OutlineEntry[] = [];
  let total = 0;
  const ordered = [...pages].sort((a, b) => a.page_no - b.page_no);
  for (const { page_no: page, content } of ordered) {
    for (const match of (content ?? "").matchAll(OUTLINE_PATTERN)) {
      total += 1;
      if (total > OUTLINE_MAX_ENTRIES) continue;
      const [, hashes, heading, marker, info, label, fragment] = match;
      if (hashes !== undefined) {
        entries.push([page, "h", hashes.length, left(heading, TEXT_CAP)]);
      } else if (marker !== undefined) {
        entries.push([page, "f", marker, left(info.replace(/^[ \t]+|[ \t]+$/g, ""), INFO_CAP)]);
      } else {
        entries.push([page, "l", left(label, TEXT_CAP), left(fragment, FRAGMENT_CAP)]);
      }
    }
  }
  return { v: 1, capped: total > OUTLINE_MAX_ENTRIES, entries };
}

function isEntry(value: unknown): value is OutlineEntry {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [page, kind, third, fourth] = value as unknown[];
  if (typeof page !== "number" || typeof fourth !== "string") return false;
  if (kind === "h") return typeof third === "number";
  return (kind === "l" || kind === "f") && typeof third === "string";
}

/** The function's answer, checked for shape — anything else is no outline. */
export function parseOutline(value: unknown): BookOutline | null {
  if (!value || typeof value !== "object") return null;
  const { v, capped, entries } = value as Record<string, unknown>;
  if (v !== 1 || typeof capped !== "boolean" || !Array.isArray(entries)) return null;
  if (!entries.every(isEntry)) return null;
  return { v: 1, capped, entries };
}
