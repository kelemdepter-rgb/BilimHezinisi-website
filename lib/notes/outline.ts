/**
 * The outline of a note: its headings, in order (PROMPT-49).
 *
 * «مۇندەرىجە» lists the `h1`–`h4` of a note so a long one can be crossed in
 * a tap. The toolbar's own «ماۋزۇ» makes an `h2`; the other levels arrive by
 * pasting, and are indented by how far below the note's highest heading they
 * sit — a note of `h2`s alone is a flat list, not one indented for nothing.
 *
 * A heading with no text is left out: there is nothing to read in the list,
 * and it is usually one being written this very moment.
 */

export type OutlineLevel = 1 | 2 | 3 | 4;
export type OutlineEntry = { level: OutlineLevel; text: string; depth: number };

const HEADINGS = "h1, h2, h3, h4";

/** A heading's text as the list shows it: on one line, spaces collapsed. */
export function headingText(heading: Element): string {
  return (heading.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The headings the outline is made of, in document order, nested ones included. */
export function outlineHeadings(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(HEADINGS)).filter((heading) => headingText(heading) !== "");
}

/** The outline of `root`: each heading's level, text and indentation. */
export function outlineOf(root: ParentNode): OutlineEntry[] {
  const headings = outlineHeadings(root);
  const levels = headings.map((heading) => Number(heading.tagName.slice(1)) as OutlineLevel);
  const top = Math.min(...levels);
  return headings.map((heading, index) => ({
    level: levels[index],
    text: headingText(heading),
    depth: levels[index] - top,
  }));
}

/** Whether two outlines read the same, so an unchanged one is not drawn again. */
export function sameOutline(a: readonly OutlineEntry[], b: readonly OutlineEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry.level === b[index].level && entry.text === b[index].text);
}
