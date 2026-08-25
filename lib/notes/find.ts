/**
 * Find and replace inside the notebook.
 *
 * Two decisions carry the whole file.
 *
 * NOTHING IS INSERTED TO SHOW A MATCH. The desktop wraps every hit in a
 * `<mark>` and has to remember to strip them again before saving
 * (`snapshotHtml` in src/notes.js). On the web the spellchecker already proved
 * the better answer: the CSS Custom Highlight API paints Ranges without
 * touching the DOM, so there is nothing in the note to save, nothing to move
 * the caret, and no text node split through the middle of an Arabic word. The
 * offset helpers come from lib/spellcheck/marks.ts unchanged — they are plain
 * DOM utilities, and the spellchecker itself is not touched.
 *
 * A MATCH NEVER CROSSES A TEXT NODE. Occurrences are found per text node, not
 * over the flattened document, so a phrase can never straddle two paragraphs
 * and «ياخشى» at the end of one line plus «كۈن» at the start of the next is not
 * a hit. It is also what the desktop does.
 *
 * Matching itself is `findOccurrences` — the same matcher as the search page,
 * the reader and the snippets, so a phrase typed with tashkil finds the same
 * text as one typed without.
 */
import { findOccurrences } from "@/lib/search/occurrences";
import { readTextMap, type TextMap } from "@/lib/spellcheck/marks";

/** Painted by ::highlight() rules in globals.css. */
export const FIND_HIGHLIGHT = "bh-find-hit";
export const FIND_CURRENT_HIGHLIGHT = "bh-find-current";

/** One hit, in flattened-text coordinates — what `rangeFor` understands. */
export type FindHit = { start: number; end: number };

export type FindResult = { map: TextMap; hits: FindHit[] };

/**
 * Every occurrence of `query` in the editor, in document order.
 *
 * Returns the text map alongside, because the caller needs it to build the
 * Ranges and must not re-read it — a second read after any edit would produce
 * offsets that no longer line up with these hits.
 */
export function findInEditor(root: HTMLElement, query: string): FindResult {
  const map = readTextMap(root);
  const term = query.trim();
  if (!term) return { map, hits: [] };

  const hits: FindHit[] = [];
  for (const [index, node] of map.nodes.entries()) {
    const base = map.starts[index];
    for (const found of findOccurrences(node.data, term)) {
      hits.push({ start: base + found.start, end: base + found.end });
    }
  }
  return { map, hits };
}

/**
 * The editor's HTML with replacements applied — WITHOUT touching the editor.
 *
 * The caller writes the result back with one selectAll + insertHTML, which is
 * what makes a replace-all a single undo step. That matters more than it
 * sounds: a replace-all that cannot be taken back in one press will eventually
 * destroy somebody's afternoon.
 *
 * `ordinal` is the hit to replace, or -1 for all of them. The clone is walked
 * in the same order `readTextMap` walks the original, so the numbering the
 * caller sees on screen is the numbering applied here.
 */
export function replacedHtml(
  root: HTMLElement,
  query: string,
  replacement: string,
  ordinal: number,
): { html: string; count: number } {
  const term = query.trim();
  const clone = root.cloneNode(true) as HTMLElement;
  if (!term) return { html: clone.innerHTML, count: 0 };

  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let index = 0;
  let count = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const found = findOccurrences(node.data, term);
    // Applied back to front so an earlier replacement cannot shift the offsets
    // of a later one inside the same node.
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const globalIndex = index + i;
      if (ordinal >= 0 && globalIndex !== ordinal) continue;
      node.data = node.data.slice(0, found[i].start) + replacement + node.data.slice(found[i].end);
      count += 1;
    }
    index += found.length;
    node = walker.nextNode() as Text | null;
  }

  return { html: clone.innerHTML, count };
}
