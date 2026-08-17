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
 */

/** A flattened view of every text node under a root, with the way back. */
export type TextMap = {
  /** All the text, as the reader sees it. */
  text: string;
  nodes: Text[];
  /** Where each node's text begins inside `text`. */
  starts: number[];
};

/** One misspelled word, addressed in flattened coordinates. */
export type MarkedWord = { word: string; start: number; end: number };

/**
 * Flatten a subtree's text. Nodes are visited in document order, so the string
 * reads the way the page does.
 */
export function readTextMap(root: Node, doc: Document = document): TextMap {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";

  let node = walker.nextNode() as Text | null;
  while (node) {
    starts.push(text.length);
    nodes.push(node);
    text += node.data;
    node = walker.nextNode() as Text | null;
  }
  return { text, nodes, starts };
}

/**
 * Which text node holds a flattened offset, and where inside it.
 *
 * An offset sitting exactly on a boundary belongs to the node that STARTS
 * there, so a range built from [start, end) never begins at the tail of the
 * previous node — which would place the underline one node too early.
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
  // A trailing offset can land one past the end of an empty or exhausted node.
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
    // on a phone the finger lands wherever it lands.
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
