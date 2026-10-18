import { createTurndown } from "@/lib/books/markdown";
import { QURAN_ATTRIBUTION } from "@/lib/notes/attribution";
import {
  FOOTNOTE_TAG,
  exportFileName,
  exportUrl,
  holdsVerse,
  parseNote,
  saveFile,
  takeCitations,
} from "@/lib/notes/export-shared";
import { normalizeTitle } from "@/lib/notes/save-protocol";

/**
 * A note as Markdown, in the browser (PROMPT-50).
 *
 * The upload pipeline's own converter (`createTurndown`, lib/books/
 * markdown.ts) does the work, unchanged: its rules are the library's, and a
 * note is the same kinds of block. What a note needs on top happens around
 * it, on this export's copy of the note:
 *
 *  - every link is absolute, or only its words when it is not one the link
 *    card would open (lib/notes/export-shared.ts `exportUrl`);
 *  - with footnotes on — the same switch as Word, so the two files agree —
 *    a citation becomes `[^n]` at the end of the quoted passage, with its
 *    label and address under the note; with it off, it stays an inline link;
 *  - `# title` first, and the Qur'an's credit last when a verse is quoted.
 *
 * Saved as UTF-8 without a byte-order mark: Markdown tools read UTF-8 by
 * default, and some take a BOM for part of the first heading.
 */

export type MarkdownOptions = {
  /** Citations as `[^n]` footnotes rather than inline links. */
  footnotes?: boolean;
};

/**
 * Where a footnote's mark goes, while turndown runs: a private-use character
 * pair round its number, which no note holds and turndown never escapes. An
 * empty marker element would be dropped as blank before any rule saw it.
 */
const MARK_OPEN = "";
const MARK_CLOSE = "";
const MARK = new RegExp(`${MARK_OPEN}(\\d+)${MARK_CLOSE}`, "g");

export function noteMarkdown(title: string, html: string, options: MarkdownOptions = {}): string {
  const base = window.location.href;
  const root = parseNote(html);
  const verse = holdsVerse(root);
  const sources = options.footnotes ? takeCitations(root, base) : [];

  for (const marker of Array.from(root.getElementsByTagName(FOOTNOTE_TAG))) {
    marker.replaceWith(`${MARK_OPEN}${marker.getAttribute("data-n")}${MARK_CLOSE}`);
  }
  for (const link of Array.from(root.querySelectorAll("a"))) {
    const url = exportUrl(link, base);
    if (url) link.setAttribute("href", url);
    else link.replaceWith(...Array.from(link.childNodes));
  }

  const turndown = createTurndown();
  const body = turndown
    .turndown(root)
    .replace(MARK, "[^$1]")
    // An empty line in the note (`<div><br></div>`) comes back as a hard
    // break on a line of its own — two spaces and nothing else.
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const parts = [`# ${turndown.escape(normalizeTitle(title))}`];
  if (body) parts.push(body);
  if (sources.length > 0) {
    parts.push(
      sources
        .map((source, index) => {
          const label = turndown.escape(source.label);
          return `[^${index + 1}]: ${source.url ? `${label} — <${source.url}>` : label}`;
        })
        .join("\n"),
    );
  }
  if (verse) parts.push(QURAN_ATTRIBUTION);
  return `${parts.join("\n\n")}\n`;
}

export function downloadMarkdown(title: string, html: string, options: MarkdownOptions = {}): void {
  const text = noteMarkdown(title, html, options);
  saveFile(new Blob([text], { type: "text/markdown;charset=utf-8" }), exportFileName(title, "md"));
}
