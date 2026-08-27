/**
 * Turning a note into proofreadable units, and putting corrections back.
 *
 * The desktop rebuilds the whole editor as one <div> per visual line, which
 * flattens every bit of formatting in the document — it warns about that with
 * a confirm() and gets away with it because its notes are plainer. This
 * notebook's notes are not: they carry headings, lists, blockquotes, colour,
 * and — from PROMPT 16 — cited passages linking back to a book and Qur'an
 * verses in the Uthmani face. Rebuilding those as plain divs would destroy
 * work the writer did deliberately, so this file does something narrower.
 *
 * A UNIT is one leaf block, or one stretch of text typed straight into the
 * editor with no block around it. Both exist in a real contentEditable: typing
 * into an empty note leaves a bare text node, and pressing Enter after it adds
 * a <div> beside it — so collecting only elements would silently skip the
 * writer's first line.
 *
 * A unit is split into LINES, because a <br> inside a block is a line the
 * writer put there. Sending the block as one string and writing the reply back
 * with textContent would merge those lines into one — a change to the shape of
 * their document that has nothing to do with spelling, and exactly the kind of
 * silent damage the ⟦N⟧ protocol exists to prevent.
 *
 * The remaining rules:
 *   - Units holding a citation or a verse are NEVER SENT and never touched.
 *     Correcting the orthography of an aya, or of a passage quoted verbatim
 *     from a book, would be an error rather than a fix.
 *   - Only lines that actually CHANGED are written back. Everything else keeps
 *     its markup exactly, because it is never written to.
 *   - A changed unit that holds inline formatting loses that formatting, and
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

export type NoteUnit = {
  /** The element or bare text node this unit's lines came from. */
  node: HTMLElement | Text;
  /** Visual lines, blank ones included so their positions survive. */
  lines: string[];
  /** Quoted material: counted, never sent, never changed. */
  quoted: boolean;
  /** Inline markup that writing a correction back would flatten. */
  formatted: boolean;
};

/** One line of one unit — the thing that becomes a numbered segment. */
export type UnitLine = { unit: number; line: number; text: string };

function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

function linesOf(element: HTMLElement): string[] {
  // innerText reflects <br> and block breaks as newlines, which is exactly
  // "what the writer sees" — the desktop relies on the same property.
  return (element.innerText ?? element.textContent ?? "").replace(/\r/g, "").split("\n");
}

/**
 * Every unit in the editor, in document order.
 *
 * Bare text nodes are collected only at the top level: anywhere deeper they
 * belong to a block that is already being collected.
 */
export function collectUnits(editor: HTMLElement): NoteUnit[] {
  const units: NoteUnit[] = [];

  const blocks = new Set(
    Array.from(editor.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
      (element) =>
        Boolean(element.textContent?.trim()) && element.querySelector(BLOCK_SELECTOR) === null,
    ),
  );

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (isTextNode(child)) {
        if (child.data.trim()) {
          units.push({ node: child, lines: [child.data], quoted: false, formatted: false });
        }
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      if (blocks.has(child)) {
        units.push({
          node: child,
          lines: linesOf(child),
          quoted: child.matches(QUOTED_SELECTOR) || child.querySelector(QUOTED_SELECTOR) !== null,
          formatted: child.children.length > 0,
        });
        continue;
      }
      walk(child);
    }
  };
  walk(editor);

  return units;
}

/** Every non-blank line of every unit that may be sent, in order. */
export function sendableLines(units: readonly NoteUnit[]): UnitLine[] {
  const out: UnitLine[] = [];
  units.forEach((unit, unitIndex) => {
    if (unit.quoted) return;
    unit.lines.forEach((text, lineIndex) => {
      if (text.trim()) out.push({ unit: unitIndex, line: lineIndex, text: text.replace(/\s+/g, " ").trim() });
    });
  });
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Write a unit's corrected lines back, keeping the unit itself in place.
 *
 * A single-line unit gets its text replaced, which is the common case and the
 * gentlest. A multi-line unit is rebuilt with <br> between the lines, so the
 * breaks the writer typed survive. Either way the element, its tag and its own
 * attributes are untouched — a heading stays a heading, a list item stays a
 * list item — and inline markup INSIDE the unit is flattened, which is what
 * the preview flags before any of this runs.
 */
export function applyUnitLines(unit: NoteUnit, lines: readonly string[]): void {
  if (isTextNode(unit.node)) {
    unit.node.data = lines.join("\n");
    return;
  }
  if (lines.length <= 1) {
    unit.node.textContent = lines[0] ?? "";
    return;
  }
  unit.node.innerHTML = lines
    .map((line) => (line.trim() ? escapeHtml(line) : "<br>"))
    .join("<br>");
}

/** How many units were left out, so the panel can say so honestly. */
export function countQuoted(units: readonly NoteUnit[]): number {
  return units.filter((unit) => unit.quoted).length;
}
