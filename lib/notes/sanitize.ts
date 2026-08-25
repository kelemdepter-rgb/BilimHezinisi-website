import DOMPurify from "dompurify";
import { SAFE_ALIGN, SAFE_COLOR, keepAllowedDeclarations } from "@/lib/notes/style-allow";

/**
 * Sanitizer for notebook HTML.
 *
 * Separate from the book sanitizer for one reason: the toolbar's alignment and
 * colour buttons produce inline styles (`justifyRight` and `foreColor` are
 * execCommand's only interface), and the book allow-list has no `style` in it —
 * running notes through it would strip both silently, so a writer would align a
 * paragraph, watch it save, and find it flat again on reload.
 *
 * Allowing `style` wholesale is not the answer either: it is an attribute with
 * a CSS parser behind it. Instead the attribute survives sanitizing and is then
 * cut down to the few declarations lib/notes/style-allow.ts admits, each with
 * its value checked against a closed set.
 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td", "a", "font",
];

// No `src`: notes never carry images (a pasted screenshot is a multi-megabyte
// data URI in a text column). No `srcset`, no event handlers, no data-*.
const ALLOWED_ATTR = [
  "href", "title", "dir", "lang", "colspan", "rowspan", "style", "color", "align", "face",
];

type DomWindow = Window & typeof globalThis;

/** Strip every declaration the shared allow-list does not admit. */
function keepSafeStyle(element: Element) {
  const kept = keepAllowedDeclarations(element.getAttribute("style") ?? "");
  if (kept.length > 0) element.setAttribute("style", kept.join("; "));
  else element.removeAttribute("style");
}

/**
 * Fold the legacy presentational markup execCommand still emits (`<font
 * color>`, `align=`) into the inline styles the reader and the DOCX export
 * both understand, so stored notes have one shape rather than three.
 */
function normalizePresentation(root: Element, documentRef: Document) {
  for (const node of Array.from(root.querySelectorAll("[align]"))) {
    const value = node.getAttribute("align") ?? "";
    node.removeAttribute("align");
    if (SAFE_ALIGN.test(value)) {
      const existing = node.getAttribute("style") ?? "";
      node.setAttribute("style", `${existing};text-align: ${value}`);
    }
  }

  for (const font of Array.from(root.querySelectorAll("font"))) {
    const span = documentRef.createElement("span");
    const color = font.getAttribute("color") ?? "";
    // execCommand("fontName") emits `<font face>`, which says the same thing as
    // a font-family and has to fold into one, or the face is lost on save.
    const face = font.getAttribute("face") ?? "";
    const declarations = [font.getAttribute("style") ?? ""];
    if (SAFE_COLOR.test(color)) declarations.push(`color: ${color}`);
    if (face) declarations.push(`font-family: ${face}`);
    span.setAttribute("style", declarations.filter(Boolean).join(";"));
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
  }

  // `face` only means anything on a <font>, which is gone by now; anywhere
  // else it is a leftover that has already been folded or was never ours.
  for (const node of Array.from(root.querySelectorAll("[face]"))) node.removeAttribute("face");

  for (const node of Array.from(root.querySelectorAll("[style]"))) keepSafeStyle(node);
}

/**
 * Sanitize note HTML. Pass a jsdom window on the server; in the browser the
 * ambient document is used.
 */
export function sanitizeNoteHtml(html: string, window?: unknown): string {
  const view = (window ?? (globalThis as unknown as DomWindow)) as DomWindow;
  const purify = window ? DOMPurify(view) : DOMPurify;

  const safe = purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "img"],
    ALLOW_DATA_ATTR: false,
  });

  const container = view.document.createElement("div");
  container.innerHTML = safe;
  normalizePresentation(container, view.document);
  return container.innerHTML;
}
