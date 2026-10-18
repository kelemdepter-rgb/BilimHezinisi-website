import { describeLink } from "@/lib/notes/links";
import { AYA_SELECTOR } from "@/lib/notes/quoted";

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
