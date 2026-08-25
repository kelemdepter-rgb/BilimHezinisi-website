import MarkdownIt from "markdown-it";

/**
 * Markdown → HTML for the reader.
 *
 * Safety comes from the renderer itself rather than a post-hoc cleaner:
 *
 *   - `html: false` makes markdown-it ESCAPE any raw HTML in a book instead
 *     of passing it through, so the only tags in the output are ones
 *     markdown-it generated. There is no raw-HTML path to sanitize.
 *   - markdown-it's default link validation rejects javascript:, vbscript:
 *     and data: URLs, so a crafted link cannot execute.
 *
 * DOMPurify is deliberately NOT used here: it needs a DOM, which does not
 * exist during server rendering, and pulling jsdom in would drag it into the
 * client bundle too. lib/sanitize.ts still guards the import paths, where a
 * real DOM is available (the browser for .html files, jsdom for URL import) —
 * that is where untrusted HTML actually enters the system.
 */
const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
  typographer: false,
});

export function renderMarkdown(source: string): string {
  return md.render(source ?? "");
}

/** Re-exported so the older import path keeps working. */
export { stripMarkdown } from "@/lib/books/strip-markdown";
