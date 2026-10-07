/**
 * Where the misspelled words are, in a live contentEditable.
 *
 * WHY NOT WRAP THEM IN SPANS. The obvious way to underline a word is to put an
 * element around it, and it is the wrong way here for three separate reasons:
 *
 *  1. The note is saved as `innerHTML`. Any element the checker inserts is
 *     stored inside the writer's note and comes back on the next open — the
 *     spellchecker would be editing the document it is checking.
 *  2. Mutating a contentEditable moves the caret. The previous implementation
 *     refused to mark words at all for exactly this reason, and settled for a
 *     panel of chips at the bottom of the page instead.
 *  3. Splitting text nodes mid-word breaks Arabic shaping: «قالدۇر» rendered as
 *     two nodes loses the join between them.
 *
 * The CSS Custom Highlight API paints Ranges without touching the DOM at all —
 * no elements, no node splitting, no caret disruption, nothing to save. The
 * cost is that there is no element to click either, so hit-testing is done from
 * the pointer's position back into the text (`hitTest` below), which is what
 * `caretPositionFromPoint` is for.
 *
 * Everything here works on an offset map — the same trick the search
 * highlighter uses: flatten the text nodes into one string, remember where each
 * one started, and convert freely in both directions afterwards.
 *
 * WHERE A LINE ENDS, THE MAP SAYS SO. The flattened string is what the
 * tokenizer reads, so it must break wherever the reader sees a break. It used
 * to be the bare concatenation of every text node, and that glued the last
 * word of one line to the first word of the next: «سىلىشتۇرسۇ», Enter,
 * «كىشىلەر» read as one word, was underlined as one wrong word, and taking a
 * suggestion replaced a Range running from the first block into the second —
 * deleting the next line's word and the line break with it (N1, 2026-10-07).
 *
 * So the map puts one virtual LINE_SEPARATOR between two text nodes whenever,
 * walking from the first to the second in document order, it
 *
 *  - enters or leaves a block element (BLOCK_TAGS) — which covers every pair
 *    of nodes whose nearest block differs, and also an empty block sitting
 *    between two runs of text inside one block, which the browser draws as a
 *    line break too; or
 *  - passes a <br> (or an <hr>, which is a block).
 *
 * At most one separator stands between two nodes, and none before the first.
 * Inline elements — b, span, a, font and the rest — never break anything: a
 * word half in bold is still one word.
 *
 * A separator belongs to no text node. `starts[i]` is still where `nodes[i]`
 * begins; the gaps between one node's end and the next one's start are the
 * separators; and an offset that falls on a separator resolves to the END of
 * the node before it, so a word that ends a line gets a Range that ends inside
 * its own block. Empty text nodes are left out of the map: they hold no
 * character an offset could address, and one sitting just before a separator
 * would otherwise claim that offset ahead of the node holding the word.
 */

/** A flattened view of every text node under a root, with the way back. */
export type TextMap = {
  /** All the text, as the reader sees it, with LINE_SEPARATOR at line ends. */
  text: string;
  /** Every non-empty text node, in document order. */
  nodes: Text[];
  /** Where each node's text begins inside `text`. */
  starts: number[];
};

/** One misspelled word, addressed in flattened coordinates. */
export type MarkedWord = { word: string; start: number; end: number };

/** What the map puts where a line ends. No word pattern ever matches it. */
export const LINE_SEPARATOR = "\n";

/**
 * The block-level tags a note can contain (lib/notes/sanitize.ts holds the
 * closed list). Entering or leaving one ends a line. The same notion as
 * BLOCK_SELECTOR in lib/ai/note-blocks.ts, which picks the LEAF blocks out of
 * this set for its own purpose and so keeps its own list.
 */
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
]);

/**
 * Flatten a subtree's text. Nodes are visited in document order, so the string
 * reads the way the page does, and a line end between two of them becomes a
 * LINE_SEPARATOR — see the comment at the top of this file.
 */
export function readTextMap(root: Node): TextMap {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  // A line end has been passed since the last text node. A flag, not a count,
  // which is what keeps it to one separator however many boundaries there are.
  let lineEnded = false;

  const visit = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const node = child as Text;
        if (node.data.length === 0) continue;
        if (lineEnded && nodes.length > 0) text += LINE_SEPARATOR;
        lineEnded = false;
        starts.push(text.length);
        nodes.push(node);
        text += node.data;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).localName;
        if (tag === "br") {
          lineEnded = true;
          continue;
        }
        const block = BLOCK_TAGS.has(tag);
        if (block) lineEnded = true;
        visit(child);
        if (block) lineEnded = true;
      }
    }
  };
  visit(root);

  return { text, nodes, starts };
}

/**
 * Which text node holds a flattened offset, and where inside it.
 *
 * An offset sitting exactly on a boundary between two adjacent nodes belongs
 * to the node that STARTS there, so a range built from [start, end) never
 * begins at the tail of the previous node — which would place the underline
 * one node too early. An offset on a separator belongs to no node and resolves
 * to the end of the one before it: the search below lands on that node, and
 * the offset inside it is its length.
 */
function locate(map: TextMap, offset: number): { node: Text; offset: number } | null {
  if (map.nodes.length === 0) return null;

  let low = 0;
  let high = map.starts.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (map.starts[mid] <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const node = map.nodes[found];
  const within = offset - map.starts[found];
  // A trailing offset can land one past the end of an exhausted node, and a
  // node can have shortened since the map was read.
  return { node, offset: Math.min(Math.max(within, 0), node.data.length) };
}

/** A live Range covering [start, end) of the flattened text. */
export function rangeFor(map: TextMap, start: number, end: number, doc: Document = document): Range | null {
  const from = locate(map, start);
  const to = locate(map, end);
  if (!from || !to) return null;
  const range = doc.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** The flattened offset of a DOM position, or null when it is outside the map. */
export function offsetOf(map: TextMap, node: Node, offset: number): number | null {
  const index = map.nodes.indexOf(node as Text);
  if (index >= 0) return map.starts[index] + offset;

  // The point landed on an element rather than a text node — normal when a
  // click hits padding between nodes. Fall back to the nearest text node that
  // the element contains.
  for (let i = 0; i < map.nodes.length; i++) {
    if (node.contains?.(map.nodes[i])) return map.starts[i];
  }
  return null;
}

/** The marked word covering an offset, if any. Marks never overlap. */
export function wordAtOffset(marks: readonly MarkedWord[], offset: number): MarkedWord | null {
  for (const mark of marks) {
    // Inclusive of `end` so a tap at the very end of a word still opens it —
    // on a phone the finger lands wherever it lands. A word that ends a line
    // ends on a separator, so the first offset of the next line is never
    // mistaken for the end of this one.
    if (offset >= mark.start && offset <= mark.end) return mark;
  }
  return null;
}

/**
 * The marked word under a screen position.
 *
 * Two APIs do the same job under different names: `caretPositionFromPoint` is
 * the standard one, `caretRangeFromPoint` is WebKit's older spelling. Neither
 * exists everywhere, hence the guard rather than a cast.
 */
export function hitTest(
  map: TextMap,
  marks: readonly MarkedWord[],
  x: number,
  y: number,
  doc: Document = document,
): MarkedWord | null {
  type WithCaret = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const withCaret = doc as WithCaret;

  let node: Node | null = null;
  let offset = 0;
  if (typeof withCaret.caretPositionFromPoint === "function") {
    const position = withCaret.caretPositionFromPoint(x, y);
    if (position) {
      node = position.offsetNode;
      offset = position.offset;
    }
  } else if (typeof withCaret.caretRangeFromPoint === "function") {
    const range = withCaret.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node) return null;

  const flat = offsetOf(map, node, offset);
  return flat === null ? null : wordAtOffset(marks, flat);
}

/**
 * Re-point marks after an edit, without re-checking anything.
 *
 * Typing shifts every offset after the caret. Re-running the whole checker on
 * each keystroke would be both slow and visually noisy — the underlines would
 * flicker off and back on. Instead the marks that sit entirely before the edit
 * keep their offsets, the ones after are shifted by the length delta, and the
 * one being typed inside is dropped: the writer is fixing it, and telling them
 * it is still wrong mid-word is exactly the wrong moment.
 */
export function shiftMarks(
  marks: readonly MarkedWord[],
  editAt: number,
  delta: number,
): MarkedWord[] {
  const out: MarkedWord[] = [];
  for (const mark of marks) {
    if (mark.end < editAt) {
      out.push(mark);
    } else if (mark.start > editAt) {
      out.push({ word: mark.word, start: mark.start + delta, end: mark.end + delta });
    }
    // Straddling the edit: dropped on purpose, see above.
  }
  return out;
}

/** Is the Custom Highlight API usable in this browser? */
export function canHighlight(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof (CSS as unknown as { highlights?: unknown }).highlights === "object" &&
    (CSS as unknown as { highlights?: unknown }).highlights !== null &&
    typeof Highlight === "function"
  );
}

/** The name the stylesheet paints; see the ::highlight() rule in globals.css. */
export const HIGHLIGHT_NAME = "bh-spell-error";
