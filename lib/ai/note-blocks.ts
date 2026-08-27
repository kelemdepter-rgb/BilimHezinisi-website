/**
 * Turning a note into proofreadable blocks, and putting corrections back.
 *
 * The desktop rebuilds the whole editor as one <div> per visual line, which
 * flattens every bit of formatting in the document — it warns about that with
 * a confirm() and gets away with it because its notes are plainer. This
 * notebook's notes are not: they carry headings, lists, blockquotes, colour,
 * and — from PROMPT 16 — cited passages linking back to a book and Qur'an
 * verses in the Uthmani face. Rebuilding those as plain divs would destroy
 * work the writer did deliberately, so this file does something narrower:
 *
 *   - Only LEAF blocks are collected, and each is one segment.
 *   - Blocks holding a citation or a verse are NEVER SENT and never touched.
 *     Correcting the orthography of a Qur'an verse or of a passage quoted
 *     verbatim from a book would be a serious error, not a fix — and the
 *     desktop's own prompt says to leave Arabic quotations alone.
 *   - Only blocks whose text actually CHANGED are rewritten. Everything else
 *     keeps its markup exactly, because it is never written to.
 *   - A changed block that holds inline formatting loses that formatting, and
 *     is flagged in the preview so the writer decides with their eyes open.
 */

/** Leaf text blocks — the same set the desktop collects, plus table cells. */
const BLOCK_SELECTOR = "p, div, h1, h2, h3, h4, h5, h6, li, blockquote, td, th";

/**
 * What must never be sent for correction.
 *
 * A link is how a citation is anchored (lib/notes/insert.ts), and the Uthmani
 * face is only ever applied to an inserted verse — so both are exact tests for
 * "this is quoted material", never a guess.
 */
const QUOTED_SELECTOR = 'a[href], [style*="Uthmanic Hafs"]';

export type NoteBlock = {
  element: HTMLElement;
  text: string;
  /** Quoted material: shown in the count, never sent, never changed. */
  quoted: boolean;
  /** Inline markup that applying a correction would flatten. */
  formatted: boolean;
};

/** Every leaf block in the editor, in document order. */
export function collectBlocks(editor: HTMLElement): NoteBlock[] {
  const found = Array.from(editor.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
    (element) => {
      if (!element.textContent?.trim()) return false;
      // Leaves only: a <div> wrapping three <p>s would otherwise be counted
      // once as itself and again as each child.
      return !element.querySelector(BLOCK_SELECTOR);
    },
  );

  // A note typed straight into the editor with no block wrapper at all is one
  // block: the editor itself.
  const elements = found.length ? found : editor.textContent?.trim() ? [editor] : [];

  return elements.map((element) => ({
    element,
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    quoted: element.matches(QUOTED_SELECTOR) || element.querySelector(QUOTED_SELECTOR) !== null,
    formatted: element.children.length > 0,
  }));
}

/**
 * Replace a block's text while leaving the block itself in place.
 *
 * `textContent =` is what flattens inline markup, and it is applied only to
 * blocks the writer has already been shown and accepted. The block element,
 * its tag and its own attributes survive — so a heading stays a heading and a
 * list item stays a list item.
 */
export function applyBlockText(block: NoteBlock, text: string): void {
  block.element.textContent = text;
}

/** How many blocks were left out, so the panel can say so honestly. */
export function countQuoted(blocks: readonly NoteBlock[]): number {
  return blocks.filter((block) => block.quoted).length;
}

/** The blocks that will actually be sent. */
export function sendableBlocks(blocks: readonly NoteBlock[]): NoteBlock[] {
  return blocks.filter((block) => !block.quoted);
}
