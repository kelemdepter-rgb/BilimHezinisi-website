import DOMPurify from "dompurify";

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
 * cut down to exactly two declarations with checked values.
 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td", "a", "font",
];

// No `src`: notes never carry images (a pasted screenshot is a multi-megabyte
// data URI in a text column). No `srcset`, no event handlers, no data-*.
const ALLOWED_ATTR = ["href", "title", "dir", "lang", "colspan", "rowspan", "style", "color", "align"];

const SAFE_ALIGN = /^(right|left|center|justify|start|end)$/i;
/** #rgb / #rrggbb, rgb()/rgba(), or a plain keyword. Nothing with url() or a function name in it. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;

type DomWindow = Window & typeof globalThis;

/** Strip every declaration except a checked text-align and colour. */
function keepSafeStyle(element: Element) {
  const declarations = (element.getAttribute("style") ?? "").split(";");
  const kept: string[] = [];

  for (const declaration of declarations) {
    const split = declaration.indexOf(":");
    if (split < 0) continue;
    const property = declaration.slice(0, split).trim().toLowerCase();
    const value = declaration.slice(split + 1).trim();
    if (property === "text-align" && SAFE_ALIGN.test(value)) kept.push(`text-align: ${value}`);
    if (property === "color" && SAFE_COLOR.test(value)) kept.push(`color: ${value}`);
  }

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
    const style = font.getAttribute("style") ?? "";
    span.setAttribute("style", SAFE_COLOR.test(color) ? `${style};color: ${color}` : style);
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
  }

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
