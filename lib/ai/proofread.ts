/**
 * The ⟦N⟧ proofreading protocol.
 *
 * Handing a model a whole document and asking it to fix the spelling invites
 * it to quietly reword a sentence, merge two paragraphs, or drop the last one
 * — and the writer would never find out. Numbering every segment and demanding
 * the same markers back, in the same order, turns that from an invisible loss
 * into something a program can check.
 *
 * This module is deliberately DOM-free and pure so every rule in it can be
 * tested directly: what is sent, what is accepted, and what is rejected. The
 * DOM side (which blocks to collect, how to put corrections back) lives in
 * lib/ai/note-blocks.ts.
 *
 * Two rules matter more than the rest:
 *
 *   1. A reply is applied WHOLE or not at all. A missing segment, an extra
 *      one, or the same segments in a different order is a rejected reply, not
 *      a partial edit. The desktop keyed its segments into a map, where order
 *      could not be checked; this is stricter on purpose.
 *   2. Nothing is applied without the writer seeing the difference first.
 *      buildDiff exists so the preview shows exactly what would change.
 */

/** One numbered piece of the document. */
export type Segment = { num: number; text: string };

/**
 * Characters of segment text per request, matching the desktop.
 *
 * A proofread reply is as long as its input, so the limit that bites is the
 * model's OUTPUT budget, not its context window. One giant request used to
 * come back truncated — losing the tail and breaking the marker format with
 * it — so long notes go out in batches and each reply is checked on its own.
 */
export const BATCH_CHARS = 6000;

/** Marker overhead per segment: `⟦123⟧ ` and a newline. */
const MARKER_COST = 8;

/**
 * Split segments into batches no bigger than the output budget.
 *
 * A single segment longer than the budget still goes out alone — refusing it
 * would leave the writer with a paragraph that can never be checked, and the
 * model handles one oversized paragraph far better than a truncated document.
 */
export function buildBatches(segments: readonly Segment[], budget = BATCH_CHARS): Segment[][] {
  const batches: Segment[][] = [];
  let current: Segment[] = [];
  let length = 0;
  for (const segment of segments) {
    const cost = segment.text.length + MARKER_COST;
    if (current.length && length + cost > budget) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(segment);
    length += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** `⟦1⟧ text` per line — exactly the shape the prompt describes. */
export function formatBatch(batch: readonly Segment[]): string {
  return batch.map((segment) => `⟦${segment.num}⟧ ${segment.text}`).join("\n");
}

/**
 * Read a reply back into segments, in the order the markers appeared.
 *
 * Order is preserved rather than discarded because verifying it is the whole
 * point — a map keyed by number cannot tell "the same segments" from "the same
 * segments shuffled".
 */
export function parseSegments(reply: string): Segment[] {
  const pattern = /⟦(\d+)⟧/g;
  const marks: { num: number; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(reply)) !== null) {
    marks.push({ num: Number.parseInt(match[1], 10), start: match.index, end: pattern.lastIndex });
  }
  return marks.map((mark, index) => ({
    num: mark.num,
    text: reply.slice(mark.end, marks[index + 1]?.start ?? reply.length).trim(),
  }));
}

export type BatchResult =
  | { ok: true; segments: Segment[] }
  | { ok: false; reason: "missing" | "extra" | "reordered" | "empty" };

/**
 * Is this reply safe to apply to the batch that was sent?
 *
 * Anything short of "the same numbers, in the same order" is refused. The
 * writer is told the reply was malformed and offered a retry — which is a
 * small annoyance, where applying half a reply would be a silent corruption
 * of their document.
 */
export function checkBatch(sent: readonly Segment[], reply: string): BatchResult {
  const got = parseSegments(reply);
  if (!got.length) return { ok: false, reason: "empty" };
  if (got.length < sent.length) return { ok: false, reason: "missing" };
  if (got.length > sent.length) return { ok: false, reason: "extra" };
  for (const [index, segment] of sent.entries()) {
    if (got[index].num !== segment.num) return { ok: false, reason: "reordered" };
  }
  return { ok: true, segments: got };
}

/** Uyghur for each way a reply can be unusable. */
export function malformedMessage(reason: Exclude<BatchResult, { ok: true }>["reason"]): string {
  const detail = {
    missing: "بىر قىسىم بۆلەكلەر قايتىپ كەلمىدى",
    extra: "ئارتۇق بۆلەك قايتىپ كەلدى",
    reordered: "بۆلەكلەرنىڭ تەرتىپى ئۆزگىرىپ كەتتى",
    empty: "جاۋاب بوش كەلدى",
  }[reason];
  return `جاۋاب فورماتى خاتا (${detail}). خاتىرىڭىزگە ھېچقانداق ئۆزگەرتىش قىلىنمىدى — قايتا سىناڭ.`;
}

/** One place where the corrected text differs from what the writer wrote. */
export type Change = {
  /** Index into the original block list. */
  index: number;
  before: string;
  after: string;
  /**
   * True when this block carries inline formatting that applying would
   * flatten, so the preview can say so before the writer accepts.
   */
  flattensFormatting?: boolean;
};

/**
 * Only what actually changed.
 *
 * A proofread usually leaves most of a document alone, and a diff of "these
 * four lines" is something a writer can actually read — where a diff of two
 * hundred unchanged lines is something they will scroll past and accept blind.
 */
export function buildDiff(
  originals: readonly string[],
  corrected: ReadonlyMap<number, string>,
  hasFormatting: (index: number) => boolean = () => false,
): Change[] {
  const changes: Change[] = [];
  originals.forEach((before, index) => {
    const after = corrected.get(index);
    if (after === undefined || after === before) return;
    changes.push({
      index,
      before,
      after,
      ...(hasFormatting(index) ? { flattensFormatting: true } : {}),
    });
  });
  return changes;
}

/** «12,480 ھەرپ» — what an operation is about to send. */
export function describeChars(chars: number): string {
  return `${chars.toLocaleString("en-US")} ھەرپ`;
}
