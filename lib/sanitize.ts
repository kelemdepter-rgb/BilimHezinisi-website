import DOMPurify from "dompurify";

/**
 * Allow-list for book/note HTML (ported from the desktop sanitize.js approach).
 * Book text is stored as plain text in Phase 2, so this is used for imported
 * article HTML before it is turned into text, and by the reader later.
 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "img", "figure", "figcaption", "span", "div",
];

const ALLOWED_ATTR = ["href", "title", "alt", "src", "dir", "lang", "colspan", "rowspan"];

/** Sanitize HTML in a DOM context (browser, or jsdom on the server). */
export function sanitizeHtml(html: string, window?: unknown): string {
  const purify = window
    ? DOMPurify(window as unknown as Window & typeof globalThis)
    : DOMPurify;
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    ALLOW_DATA_ATTR: false,
  });
}
