/**
 * Find and replace inside the notebook.
 *
 * Three decisions carry the whole file.
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
 * A REPLACEMENT TOUCHES ONLY ITS HIT. Each one is written over that hit's own
 * Range, last hit first, and nothing else in the note is rewritten. Writing
 * the whole document back instead (`selectAll` + `insertHTML`) merged the
 * note's first block into everything after it — a heading swallowed the note,
 * a citation's quote took it in, a list took the next paragraph (N7,
 * PROMPT-45). tests/unit/note-whole-document.test.ts keeps that out.
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

/** One hit where the document holds it: a stretch of one text node. */
type Spot = { node: Text; start: number; end: number; text: string };

/** The same hits as `findInEditor`, in the same order, as places in the DOM. */
function spotsIn(root: HTMLElement, term: string): Spot[] {
  const spots: Spot[] = [];
  for (const node of readTextMap(root).nodes) {
    for (const found of findOccurrences(node.data, term)) {
      spots.push({ node, start: found.start, end: found.end, text: node.data.slice(found.start, found.end) });
    }
  }
  return spots;
}

/** Is this hit still where it was found, still holding what it held? */
function holds(root: HTMLElement, spot: Spot | undefined, text: string): spot is Spot {
  return (
    spot !== undefined &&
    spot.node.isConnected &&
    root.contains(spot.node) &&
    spot.node.data.slice(spot.start, spot.end) === text
  );
}

/**
 * Replace hits where they stand: hit `which` (numbered as the find bar shows
 * them), or all of them.
 *
 * `write` puts the replacement over one hit's Range — in the notebook a single
 * `insertText` command, so the browser keeps its undo stack and the markup
 * around the hit is never touched. Hits are handed over from the last to the
 * first, so a replacement can never move a hit still waiting its turn.
 *
 * The three engines were measured editing the text node in place. Should one
 * ever rebuild the node instead, the hits are found again: every hit not yet
 * replaced comes before every hit that was, so it keeps its number.
 *
 * Returns how many were written.
 */
export function replaceHits(
  root: HTMLElement,
  query: string,
  which: number | "all",
  write: (range: Range, ordinal: number) => void,
): number {
  const term = query.trim();
  if (!term) return 0;
  let spots = spotsIn(root, term);
  const texts = spots.map((spot) => spot.text);
  const chosen =
    which === "all" ? spots.map((_, ordinal) => ordinal) : which >= 0 && which < spots.length ? [which] : [];

  let written = 0;
  for (let k = chosen.length - 1; k >= 0; k -= 1) {
    const ordinal = chosen[k];
    let spot: Spot | undefined = spots[ordinal];
    if (!holds(root, spot, texts[ordinal])) {
      spots = spotsIn(root, term);
      spot = spots[ordinal];
      // Not where it should be even after looking again: stop rather than
      // write over anything else.
      if (!holds(root, spot, texts[ordinal])) break;
    }
    const range = root.ownerDocument.createRange();
    range.setStart(spot.node, spot.start);
    range.setEnd(spot.node, spot.end);
    write(range, ordinal);
    written += 1;
  }
  return written;
}
