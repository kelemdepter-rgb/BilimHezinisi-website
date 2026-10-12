/**
 * Which block the caret is in, and the one command that makes it normal text.
 *
 * The notebook offers three block styles — normal text, a heading (`h2`) and a
 * quote (`blockquote`) — and the toolbar shows which one the caret sits in.
 * Headings and quotes are made with `formatBlock`, which every engine does
 * the same way. Undoing them is where the engines part, and what follows was
 * measured in Chromium 151, Firefox 153 and WebKit 26.5 (PROMPT-45):
 *
 *  - A heading becomes normal text with `formatBlock div` in all three, as one
 *    undo step, wherever it stands in the note. `removeFormat` does nothing to
 *    a heading, and `outdent` does nothing either.
 *  - A quote holding only text and line breaks — `<blockquote>a<br>b</blockquote>`
 *    is what the toolbar makes of several lines in Chromium and WebKit — becomes
 *    one normal block with `formatBlock div` over its whole content, in all
 *    three. `outdent` would leave the text bare in the note.
 *  - A quote holding blocks (`<blockquote><div>…</div><div>…</div></blockquote>`,
 *    which arrives by pasting) is untouched by `formatBlock div` in every
 *    engine; `outdent` over its whole content takes the quote away instead.
 *
 * Normal text is a `div` because that is what Enter makes in all three
 * engines — a line written after a heading is a `div` too.
 */
import { BLOCK_TAGS } from "@/lib/spellcheck/marks";

export type BlockStyle = "normal" | "heading" | "quote";
export type ListStyle = "bulleted" | "numbered" | null;

const HEADING = /^H[1-6]$/;

/**
 * The style of the innermost heading or quote around `node`, and that
 * element; "normal" (and no element) when there is neither before `root`.
 */
export function blockStyleAt(
  root: HTMLElement,
  node: Node | null,
): { style: BlockStyle; element: HTMLElement | null } {
  for (let current = node; current && current !== root; current = current.parentNode) {
    if (current.nodeType !== Node.ELEMENT_NODE) continue;
    const element = current as HTMLElement;
    if (HEADING.test(element.tagName)) return { style: "heading", element };
    if (element.tagName === "BLOCKQUOTE") return { style: "quote", element };
  }
  return { style: "normal", element: null };
}

/** The innermost list around `node`, if any. */
export function listStyleAt(root: HTMLElement, node: Node | null): ListStyle {
  for (let current = node; current && current !== root; current = current.parentNode) {
    if (current.nodeName === "UL") return "bulleted";
    if (current.nodeName === "OL") return "numbered";
  }
  return null;
}

/**
 * The command that turns a quote into normal text: `formatBlock div` for one
 * holding text, `outdent` for one holding blocks. Either runs over the
 * quote's whole content, so a quote of several lines goes as one.
 */
export function quoteToNormalCommand(quote: HTMLElement): { command: string; value?: string } {
  const holdsBlocks = Array.from(quote.children).some((child) =>
    BLOCK_TAGS.has(child.tagName.toLowerCase()),
  );
  return holdsBlocks ? { command: "outdent" } : { command: "formatBlock", value: "<div>" };
}
