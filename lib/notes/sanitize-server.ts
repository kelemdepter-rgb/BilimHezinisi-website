/**
 * Server-side notebook sanitizer — the same allow-list as the browser's, with
 * no DOM behind it.
 *
 * WHY THIS EXISTS. The Server Actions in app/notes/actions.ts used DOMPurify on
 * a jsdom window. jsdom cannot be loaded in Vercel's function runtime: any
 * module that imports it throws while it is still being evaluated, so every
 * action in the file returned 500 before a single line of its own code ran.
 * That is what made «يېڭى خاتىرە» fail in production while passing locally —
 * `next dev` and a local `next start` both load jsdom perfectly well. The same
 * import took /api/import/url down with it, which is how it was found: that
 * route answered 500 to an unauthenticated request that should have been a 403.
 *
 * So the server path no longer needs a DOM at all. parse5 does the dangerous
 * part — turning a hostile string into a tree, with the HTML spec's own quirks
 * — and this file walks that tree against an allow-list and serialises it back.
 * parse5 is pure JavaScript with no Node APIs and no dynamic requires, so it
 * cannot fail the way jsdom did, and a note save no longer drags a thousand-file
 * dependency through a cold start.
 *
 * The browser keeps DOMPurify (lib/notes/sanitize.ts) for what the editor
 * pastes, where a real DOM exists. This is the authoritative pass: a Server
 * Action is a public endpoint, so whatever reaches it is treated as if a
 * stranger wrote it, whatever the editor already did.
 */
import { parseFragment, serialize } from "parse5";

/** Same list as the browser sanitizer, kept in step deliberately. */
const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td", "a", "font",
]);

/**
 * Elements whose CONTENTS go too, rather than being unwrapped. Everything here
 * either executes, loads, or carries text that is not text — a `<style>` body
 * unwrapped into a paragraph would spill CSS into the note, and a `<script>`
 * body would spill code.
 */
const DROP_SUBTREE = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "button",
  "select", "option", "textarea", "img", "picture", "source", "video", "audio",
  "canvas", "svg", "math", "link", "meta", "base", "title", "head", "noscript",
  "template", "frame", "frameset", "applet", "xmp", "noembed", "noframes",
  "plaintext", "marquee",
]);

const ALLOWED_ATTR = new Set([
  "href", "title", "dir", "lang", "colspan", "rowspan", "style", "color", "align",
]);

const SAFE_ALIGN = /^(right|left|center|justify|start|end)$/i;
/** #rgb / #rrggbb, rgb()/rgba(), or a plain keyword. Nothing with url() or a function name in it. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;

/** Blocked outright; anything else without a scheme is a relative link. */
const UNSAFE_SCHEME = /^(javascript|data|vbscript|file|blob|about):/i;

// parse5's tree is plain data, so these are the only shapes to describe.
type Attr = { name: string; value: string };
type Node = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Attr[];
  childNodes?: Node[];
};

/**
 * A link is safe when it goes somewhere a browser will merely navigate to.
 * parse5 has already decoded entities, so the value seen here is the value the
 * browser would act on — `&#106;avascript:` arrives as `javascript:`. Control
 * characters and whitespace are stripped first because a browser ignores them
 * inside a scheme.
 */
function safeHref(value: string): string | null {
  const bare = value.replace(/[\u0000-\u0020\u007f-\u00a0]/g, "");
  if (!bare) return null;
  if (UNSAFE_SCHEME.test(bare)) return null;
  return value.trim();
}

/** Keep a checked text-align and colour; drop every other declaration. */
function safeStyle(value: string): string | null {
  const kept: string[] = [];
  for (const declaration of value.split(";")) {
    const split = declaration.indexOf(":");
    if (split < 0) continue;
    const property = declaration.slice(0, split).trim().toLowerCase();
    const raw = declaration.slice(split + 1).trim();
    if (property === "text-align" && SAFE_ALIGN.test(raw)) kept.push(`text-align: ${raw}`);
    if (property === "color" && SAFE_COLOR.test(raw)) kept.push(`color: ${raw}`);
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

/**
 * Fold the legacy presentational markup execCommand still emits (`<font
 * color>`, `align=`) into inline styles, so stored notes have one shape rather
 * than three — the reader and the DOCX export both read the style.
 */
function foldPresentation(element: Node): void {
  const attrs = element.attrs ?? [];
  const read = (name: string) => attrs.find((attr) => attr.name === name)?.value ?? "";

  const declarations: string[] = [];
  const existing = safeStyle(read("style"));
  if (existing) declarations.push(existing);

  const align = read("align");
  if (SAFE_ALIGN.test(align)) declarations.push(`text-align: ${align}`);

  const color = read("color");
  if (element.tagName === "font" && SAFE_COLOR.test(color)) declarations.push(`color: ${color}`);

  const kept: Attr[] = [];
  for (const attr of attrs) {
    if (!ALLOWED_ATTR.has(attr.name)) continue;
    // Handled above, and never emitted as attributes of their own again.
    if (attr.name === "style" || attr.name === "align" || attr.name === "color") continue;
    if (attr.name === "href") {
      const href = safeHref(attr.value);
      if (href !== null) kept.push({ name: "href", value: href });
      continue;
    }
    kept.push(attr);
  }
  if (declarations.length > 0) kept.push({ name: "style", value: declarations.join("; ") });

  element.attrs = kept;
  // <font> is not in the allow-list of things the reader renders; it becomes a
  // span carrying the colour it was there to express.
  if (element.tagName === "font") {
    element.tagName = "span";
    element.nodeName = "span";
  }
}

function isElement(node: Node): boolean {
  return typeof node.tagName === "string";
}

/** Depth-first filter, returning the nodes that survive in the parent's place. */
function clean(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.nodeName === "#text") {
      out.push(node);
      continue;
    }
    if (!isElement(node)) continue; // comments, doctypes and the like

    const tag = node.tagName as string;
    if (DROP_SUBTREE.has(tag)) continue;

    const children = clean(node.childNodes ?? []);
    if (!ALLOWED_TAGS.has(tag)) {
      // Not dangerous, just not ours — unwrap it and keep what it said, which
      // is how DOMPurify behaves with KEEP_CONTENT on.
      out.push(...children);
      continue;
    }

    node.childNodes = children;
    foldPresentation(node);
    out.push(node);
  }
  return out;
}

/**
 * Sanitize note HTML on the server. Never throws on malformed input: parse5
 * accepts any string, because a browser does.
 */
export function sanitizeNoteHtmlServer(html: string): string {
  if (!html) return "";
  const fragment = parseFragment(html) as unknown as Node;
  fragment.childNodes = clean(fragment.childNodes ?? []);
  // parse5 escapes text and attribute values on the way out, and every element
  // that holds raw text has been dropped, so the result cannot re-parse into
  // anything but what it says.
  return serialize(fragment as never);
}

/** Blocks that have to become line breaks, or the plain copy runs together. */
const BLOCK = new Set([
  "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "tr", "pre", "hr",
]);

/**
 * The plain-text copy of a note — what the length counter reads and what a
 * future search would index.
 */
export function noteHtmlToText(html: string): string {
  if (!html) return "";
  const fragment = parseFragment(html) as unknown as Node;

  let text = "";
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.nodeName === "#text") {
        text += node.value ?? "";
        continue;
      }
      if (!isElement(node)) continue;
      const tag = node.tagName as string;
      if (DROP_SUBTREE.has(tag) && tag !== "br") continue;
      walk(node.childNodes ?? []);
      if (BLOCK.has(tag)) text += "\n";
    }
  };
  walk(fragment.childNodes ?? []);

  return text.replace(/\n{3,}/g, "\n\n").trim();
}
