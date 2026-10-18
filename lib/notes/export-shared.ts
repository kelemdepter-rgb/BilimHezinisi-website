import { isCitationParagraph } from "@/lib/notes/insert";
import { describeLink } from "@/lib/notes/links";
import { AYA_SELECTOR } from "@/lib/notes/quoted";
import { BLOCK_TAGS } from "@/lib/spellcheck/marks";

/**
 * What the note exports share (PROMPT-50). Word, Markdown and text are all
 * made in the writer's browser from the editor's HTML, and none of them is
 * ever sent anywhere: the note is already in the tab, and a server that
 * converted it would spend the free tier's invocations to see private
 * writing it has no reason to see.
 *
 * Imported only by the exporters, which the editor loads when a note is
 * actually exported — never on a visit to the editor.
 */

/** The note's title as a file name, sanitized exactly as the Word export always did. */
export function exportFileName(title: string, extension: string): string {
  return `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "خاتىرە"}.${extension}`;
}

/** Hand a finished file to the browser as a download. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — Safari needs the URL alive when the click lands.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The note's HTML as a tree to read, in a document of its own. Nothing in an
 * inert document loads or runs, whatever the markup says — the editor's live
 * HTML is read here, not the sanitized copy the server keeps.
 */
export function parseNote(html: string): HTMLElement {
  const root = document.implementation.createHTMLDocument("").createElement("div");
  root.innerHTML = html;
  return root;
}

/**
 * The absolute address a link is exported with, or null when it has none: a
 * file on somebody's desktop cannot follow `/books/12/read`, so a path on
 * this site is resolved against it, and only what the link card would open
 * (an http(s) address or this site's own path — lib/notes/links.ts) is ever
 * written into a file as a link.
 */
export function exportUrl(link: Element, base: string = window.location.href): string | null {
  return describeLink(link.getAttribute("href") ?? "", link.textContent ?? "", base).url;
}

/** Does the note quote the Qur'an, and so owe its sources their credit? */
export function holdsVerse(root: ParentNode): boolean {
  return root.querySelector(AYA_SELECTOR) !== null;
}

/** One citation turned into a footnote: its line's words and where its link goes. */
export type FootnoteSource = { label: string; url: string | null };

/**
 * The element that marks where footnote N's reference goes, with
 * `data-n="N"`. A name no note can contain — the sanitizer admits none like
 * it — so it can only have come from `takeCitations`.
 */
export const FOOTNOTE_TAG = "bh-footnote";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** The last child that is more than whitespace — or a comment, which is nothing. */
function lastMeaningful(parent: Node): ChildNode | null {
  for (let child = parent.lastChild; child; child = child.previousSibling) {
    if (child.nodeType === ELEMENT_NODE) return child;
    if (child.nodeType === TEXT_NODE && (child.textContent ?? "").trim()) return child;
  }
  return null;
}

function previousMeaningful(node: Node): ChildNode | null {
  for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
    if (sibling.nodeType === ELEMENT_NODE) return sibling;
    if (sibling.nodeType === TEXT_NODE && (sibling.textContent ?? "").trim()) return sibling;
  }
  return null;
}

/** The innermost block that ends `block` — the last line of a quote, the last item of a list. */
function lastLine(block: Element): Element {
  let current = block;
  for (;;) {
    const last = lastMeaningful(current);
    if (!last || last.nodeType !== ELEMENT_NODE || !BLOCK_TAGS.has((last as Element).localName)) return current;
    current = last as Element;
  }
}

/**
 * Take every citation line (`isCitationParagraph`) out of `root`, leaving a
 * FOOTNOTE_TAG marker at the end of the passage or verse quoted just before
 * it, and return the citations in order: marker N is citation N - 1 here.
 *
 * The marker goes at the end of that passage's last line — before a trailing
 * `<br>`, which only holds a line open and must not push the mark onto a line
 * of its own. A citation with nothing quoted before it (the writer deleted
 * the passage) keeps its place as a paragraph holding only the mark.
 */
export function takeCitations(root: HTMLElement, base: string = window.location.href): FootnoteSource[] {
  const found: FootnoteSource[] = [];
  const doc = root.ownerDocument;

  for (const line of Array.from(root.querySelectorAll("p"))) {
    if (!isCitationParagraph(line)) continue;
    const link = line.querySelector("a")!;
    found.push({ label: (link.textContent ?? "").replace(/\s+/g, " ").trim(), url: exportUrl(link, base) });

    const marker = doc.createElement(FOOTNOTE_TAG);
    marker.setAttribute("data-n", String(found.length));

    const before = previousMeaningful(line);
    if (before && (before.nodeType === TEXT_NODE || !BLOCK_TAGS.has((before as Element).localName))) {
      // Inline words right before the line: they end where the line starts.
      line.before(marker);
    } else {
      const host = before ? lastLine(before as Element) : null;
      if (host && host.localName !== "hr" && (host.textContent ?? "").trim()) {
        const tail = lastMeaningful(host);
        if (tail && tail.nodeType === ELEMENT_NODE && (tail as Element).localName === "br") tail.before(marker);
        else host.append(marker);
      } else {
        const own = doc.createElement("p");
        own.append(marker);
        line.before(own);
      }
    }
    line.remove();
  }
  return found;
}
