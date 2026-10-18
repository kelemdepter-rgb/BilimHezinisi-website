import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import { QURAN_ATTRIBUTION } from "@/lib/notes/attribution";
import {
  FOOTNOTE_TAG,
  exportFileName,
  exportUrl,
  holdsVerse,
  parseNote,
  saveFile,
  takeCitations,
  type FootnoteSource,
} from "@/lib/notes/export-shared";
import { normalizeTitle } from "@/lib/notes/save-protocol";
import { DEFAULT_TYPOGRAPHY, NOTE_FONT_STACKS, type NoteTypography } from "@/lib/notes/typography";
import { BLOCK_TAGS } from "@/lib/spellcheck/marks";

/**
 * Turn the editor's HTML into a Word file, in the browser (lib/notes/
 * export-shared.ts says why never on a server).
 *
 * THE SHAPE OF THE NOTE (N12). The walk below is recursive over the same
 * block set the spellchecker's line map uses (BLOCK_TAGS in
 * lib/spellcheck/marks.ts): every block is its own paragraph however deep it
 * sits, words between two blocks are a paragraph of their own, a `<br>` is a
 * line break inside its paragraph, and an empty line (`<div><br></div>`)
 * stays an empty paragraph. Before PROMPT-50 only the editor's top-level
 * children were paragraphs, so a quote of several lines, or a list item
 * holding paragraphs, arrived in Word as one run-on line.
 *
 * Lists: one paragraph per item at its nesting depth (`w:ilvl`), bullets
 * for `<ul>` and numbers for `<ol>`, and every `<ol>` counting from 1 on its
 * own definition. Tables are real Word tables, right-to-left, spans kept.
 *
 * THE NOTEBOOK'S TYPE. The document's defaults are the face, size and line
 * height the writer chose for the notebook (lib/notes/typography.ts). Fonts
 * are named, never embedded — the licences and the file size both say no —
 * so Word uses the face when it is installed, as UKIJ is on most Uyghur
 * writers' machines. An inserted verse keeps its own Uthmani face.
 *
 * SOURCES. A citation stays a link back to the book, resolved to an absolute
 * address so it still opens from a file on somebody's desktop — or, when the
 * writer asks for it, becomes a footnote. A note that quotes the Qur'an
 * carries the credit its sources require either way.
 */

export type DocxOptions = {
  /** The notebook's face, size and line height; its defaults when absent. */
  typography?: NoteTypography;
  /** Citations as footnotes rather than inline links. */
  footnotes?: boolean;
};

/** A4 with Word's one-inch margins (the docx defaults): the width text may use, in twips. */
const TEXT_WIDTH = 11906 - 2 * 1440;
/** How far each list level and each quote steps in from the start side. */
const STEP = 720;
const HANGING = 360;
/** The ink headings are drawn in on the paper theme (`--text`). */
const INK = "2A2012";
/** A link with no colour of its own. */
const LINK_BLUE = "1155CC";

type HeadingValue = (typeof HeadingLevel)[keyof typeof HeadingLevel];
type AlignmentValue = (typeof AlignmentType)[keyof typeof AlignmentType];

const HEADINGS: Record<string, HeadingValue> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

/**
 * CSS text-align → w:jc in a right-to-left (w:bidi) paragraph. In the values
 * every Word reads (ECMA-376 1st edition), `left` and `right` are not
 * physical there: `left` is the paragraph's START, its right side, and
 * `right` its end. LibreOffice reads and writes DOCX the same way (checked
 * 2026-10-18 in its DomainMapper `handleParaJustification` and
 * docxattributeoutput `ParaAdjust`); tests/unit/docx-export.test.ts pins it.
 */
const ALIGNMENT: Record<string, AlignmentValue> = {
  right: AlignmentType.LEFT,
  start: AlignmentType.LEFT,
  left: AlignmentType.RIGHT,
  end: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
  justify: AlignmentType.JUSTIFIED,
};

type InlineStyle = {
  bold: boolean;
  italics: boolean;
  underline: boolean;
  strike: boolean;
  subScript: boolean;
  superScript: boolean;
  color?: string;
  font?: string;
  /** Half-points. */
  size?: number;
};

const PLAIN: InlineStyle = {
  bold: false,
  italics: false,
  underline: false,
  strike: false,
  subScript: false,
  superScript: false,
};

/** What a paragraph is made of before it becomes Word's runs. */
type Segment =
  | { kind: "text"; text: string; style: InlineStyle; url: string | null }
  | { kind: "break" }
  | { kind: "footnote"; id: number };

/** The list item a paragraph is in: its numbering, its depth, and whether it is numbered yet. */
type ListItem = { reference: string; level: number; numbered: boolean };

/** Everything a block hands down to the blocks inside it. */
type Context = {
  style: InlineStyle;
  alignment?: AlignmentValue;
  heading?: HeadingValue;
  /** How many quotes deep. */
  quote: number;
  /** Inside a list item. */
  item: ListItem | null;
  /** Whitespace is kept and a newline breaks the line. */
  pre: boolean;
  /** A `<p>`: on screen it is set off from its neighbours (`.md-body p`). */
  spaced: boolean;
};

/**
 * Names this site gives its own font files in @font-face (app/globals.css)
 * that no font file carries. Word finds a font by the name inside the file,
 * and the Uthmani files call themselves «KFGQPC … Uthmanic Script …» — so
 * for Word a verse's stack is read from the next name on, which for an
 * inserted verse is «KFGQPC Uthmanic Script HAFS», the name of the Uthmani
 * font readers install on Windows (checked in the font files' name tables).
 */
const WEB_ONLY_FAMILIES: ReadonlySet<string> = new Set(["uthmanic hafs", "uthmanic hafs b"]);

/** The first family of a CSS stack Word can find, unquoted — Word wants one name, not a list. */
function firstFamily(stack: string): string | undefined {
  for (const part of stack.split(",")) {
    const name = part.trim().replace(/^['"]|['"]$/g, "").trim();
    if (name && !WEB_ONLY_FAMILIES.has(name.toLowerCase())) return name;
  }
  return undefined;
}

/** CSS px/pt → docx half-points. Word measures type in half-points. */
function toHalfPoints(value: string): number | undefined {
  const found = /^(\d{1,3})(pt|px)$/i.exec(value.trim());
  if (!found) return undefined;
  const size = Number(found[1]);
  // 1px ≈ 0.75pt at the CSS reference resolution.
  const points = found[2].toLowerCase() === "px" ? size * 0.75 : size;
  return Math.round(points * 2);
}

/** Word wants RRGGBB with no hash; browsers hand back `rgb(r, g, b)` or `#rgb`. */
function toDocxColor(css: string): string | undefined {
  const value = css.trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!hex) return undefined;
  const digits = hex[1];
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  return full.toUpperCase();
}

/** The formatting an element adds to what it inherits. */
function inlineStyle(element: HTMLElement, inherited: InlineStyle): InlineStyle {
  const tag = element.localName;
  const style = element.style;
  return {
    bold: inherited.bold || tag === "b" || tag === "strong" || tag === "th",
    italics: inherited.italics || tag === "i" || tag === "em",
    underline: inherited.underline || tag === "u",
    strike: inherited.strike || tag === "s",
    subScript: inherited.subScript || tag === "sub",
    superScript: inherited.superScript || tag === "sup",
    color: (style.color && toDocxColor(style.color)) || inherited.color,
    font: (style.fontFamily && firstFamily(style.fontFamily)) || inherited.font,
    size: (style.fontSize && toHalfPoints(style.fontSize)) || inherited.size,
  };
}

/** A block's own alignment, from its style or the `align` attribute execCommand may still write. */
function alignmentOf(element: HTMLElement): AlignmentValue | undefined {
  const value = (element.style.textAlign || element.getAttribute("align") || "").trim().toLowerCase();
  return Object.hasOwn(ALIGNMENT, value) ? ALIGNMENT[value] : undefined;
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

function isBlock(node: Node): node is HTMLElement {
  return isElement(node) && BLOCK_TAGS.has(node.localName);
}

/** An inline element holding a block — `<b><p>…</p></b>` from a paste — is walked like a block. */
function holdsBlock(element: HTMLElement): boolean {
  for (const tag of BLOCK_TAGS) if (element.getElementsByTagName(tag).length > 0) return true;
  return false;
}

/**
 * Drop what only holds a line open: whitespace at either end, and one last
 * `<br>` — a browser keeps an empty line alive with one (`<div><br></div>`),
 * and draws a block's final `<br>` as nothing at all.
 */
function trimSegments(segments: Segment[], pre: boolean): Segment[] {
  const out = [...segments];
  const blank = (segment: Segment | undefined) => segment?.kind === "text" && !pre && !segment.text.trim();
  while (blank(out.at(-1))) out.pop();
  if (out.at(-1)?.kind === "break") out.pop();
  while (blank(out.at(-1))) out.pop();
  while (blank(out[0])) out.shift();
  if (!pre) {
    const first = out[0];
    if (first?.kind === "text") out[0] = { ...first, text: first.text.trimStart() };
    const last = out.at(-1);
    if (last?.kind === "text") out[out.length - 1] = { ...last, text: last.text.trimEnd() };
  }
  return out;
}

function textRun(text: string, style: InlineStyle): TextRun {
  return new TextRun({
    text,
    rightToLeft: true,
    // Only what is ON: an explicit "not bold" would undo a heading's bold.
    ...(style.bold ? { bold: true } : {}),
    ...(style.italics ? { italics: true } : {}),
    // docx wants an options object here, not a boolean; the empty object
    // means "single line, automatic colour".
    ...(style.underline ? { underline: {} } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.subScript ? { subScript: true } : {}),
    ...(style.superScript ? { superScript: true } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.font ? { font: style.font } : {}),
    ...(style.size ? { size: style.size } : {}),
  });
}

/** Segments → Word's runs, with consecutive runs of one link kept inside one hyperlink. */
function runsOf(segments: Segment[]): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let link: { url: string; children: TextRun[] } | null = null;
  const close = () => {
    if (link) out.push(new ExternalHyperlink({ link: link.url, children: link.children }));
    link = null;
  };

  for (const segment of segments) {
    if (segment.kind === "break") {
      close();
      out.push(new TextRun({ break: 1, rightToLeft: true }));
    } else if (segment.kind === "footnote") {
      close();
      out.push(new FootnoteReferenceRun(segment.id));
    } else if (segment.url) {
      const run = textRun(segment.text, segment.style);
      if (link && link.url === segment.url) link.children.push(run);
      else {
        close();
        link = { url: segment.url, children: [run] };
      }
    } else {
      close();
      out.push(textRun(segment.text, segment.style));
    }
  }
  close();
  return out;
}

/** One numbering definition's nine levels. */
function levels(format: (typeof LevelFormat)[keyof typeof LevelFormat]): ILevelsOptions[] {
  const bullets = ["●", "○", "■"];
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format,
    text: format === LevelFormat.BULLET ? bullets[level % bullets.length] : `%${level + 1}.`,
    // The number at the start side, as `left` means in a right-to-left paragraph (ALIGNMENT).
    alignment: AlignmentType.LEFT,
    start: 1,
    style: { paragraph: { indent: { left: STEP * (level + 1), hanging: HANGING } } },
  }));
}

const BULLETS = "ug-bullets";

class DocxWalk {
  /** Every numbering definition the note's lists need, made as they are met. */
  readonly numbering: { reference: string; levels: ILevelsOptions[] }[] = [];
  private lists = 0;
  private gap: number;

  constructor(
    private readonly base: string,
    bodyHalfPoints: number,
  ) {
    // `.md-body p { margin-block: 0.85em }`, in twips (half-points × 10).
    this.gap = Math.round(bodyHalfPoints * 0.85 * 10);
  }

  /** The children of `parent`: blocks in turn, the words between them gathered into paragraphs. */
  blocks(parent: Node, context: Context, out: (Paragraph | Table)[]): void {
    let inline: Node[] = [];
    const flush = () => {
      if (inline.length > 0) this.paragraph(inline, context, out);
      inline = [];
    };
    for (const child of Array.from(parent.childNodes)) {
      if (isBlock(child)) {
        flush();
        this.block(child, context, out);
      } else if (isElement(child) && holdsBlock(child)) {
        flush();
        this.blocks(child, { ...context, style: inlineStyle(child, context.style) }, out);
      } else {
        inline.push(child);
      }
    }
    flush();
  }

  private block(element: HTMLElement, context: Context, out: (Paragraph | Table)[]): void {
    const tag = element.localName;
    const own: Context = {
      ...context,
      style: inlineStyle(element, context.style),
      alignment: alignmentOf(element) ?? context.alignment,
      spaced: tag === "p",
    };

    if (tag === "ul" || tag === "ol") this.list(element, own, out);
    else if (tag === "table") out.push(this.table(element as HTMLTableElement, own));
    else if (tag === "hr") {
      out.push(
        new Paragraph({
          bidirectional: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } },
          children: [],
        }),
      );
    } else if (tag === "blockquote") this.blocks(element, { ...own, quote: context.quote + 1 }, out);
    else if (HEADINGS[tag]) this.blocks(element, { ...own, heading: HEADINGS[tag] }, out);
    else if (tag === "pre") this.blocks(element, { ...own, pre: true }, out);
    else this.blocks(element, own, out);
  }

  /**
   * One list. Its items are one level deeper than the item it sits in, and
   * a list met directly inside a list — execCommand("indent") writes
   * `<ul><li>…</li><ul>…</ul></ul>` — deeper still.
   */
  private list(element: HTMLElement, context: Context, out: (Paragraph | Table)[]): void {
    const level = context.item ? Math.min(context.item.level + 1, 8) : 0;
    let reference = BULLETS;
    if (element.localName === "ol") {
      // Its own definition, so it counts from 1 whatever came before: two
      // w:num over one definition carry on each other's count in Word.
      reference = `ug-numbers-${++this.lists}`;
      this.numbering.push({ reference, levels: levels(LevelFormat.DECIMAL) });
    } else if (!this.numbering.some((entry) => entry.reference === BULLETS)) {
      this.numbering.push({ reference: BULLETS, levels: levels(LevelFormat.BULLET) });
    }

    const item = (numbered: boolean): ListItem => ({ reference, level, numbered });
    const inner: Context = { ...context, spaced: false, heading: undefined };
    let loose: Node[] = [];
    const flush = () => {
      if (loose.length > 0) this.paragraph(loose, { ...inner, item: item(true) }, out);
      loose = [];
    };
    for (const child of Array.from(element.childNodes)) {
      if (isElement(child) && child.localName === "li") {
        flush();
        this.blocks(
          child,
          {
            ...inner,
            style: inlineStyle(child, inner.style),
            alignment: alignmentOf(child) ?? inner.alignment,
            item: item(false),
          },
          out,
        );
      } else if (isElement(child) && (child.localName === "ul" || child.localName === "ol")) {
        flush();
        this.list(child, { ...inner, item: item(true) }, out);
      } else if (isBlock(child)) {
        flush();
        this.block(child, { ...inner, item: item(true) }, out);
      } else {
        loose.push(child);
      }
    }
    flush();
  }

  /**
   * A right-to-left Word table. Cells are walked like the note itself, so a
   * cell keeps its lines and lists; `colspan` and `rowspan` survive as
   * gridSpan and vMerge, and short rows are filled out to the grid.
   */
  private table(element: HTMLTableElement, context: Context): Table {
    const htmlRows = Array.from(element.rows).filter((row) => row.cells.length > 0);

    // Lay the cells on the grid once, to know how wide it is and how much of
    // each row a span from above already covers.
    const carried: number[] = [];
    const covered: number[] = [];
    for (const [index, row] of htmlRows.entries()) {
      const below = htmlRows.length - index;
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        while ((carried[column] ?? 0) > 0) column++;
        const columns = Math.min(Math.max(cell.colSpan, 1), 63);
        const rows = cell.rowSpan === 0 ? below : Math.min(Math.max(cell.rowSpan, 1), below);
        for (let k = 0; k < columns; k++) carried[column + k] = rows;
        column += columns;
      }
      covered.push(carried.filter((left) => left > 0).length);
      for (let k = 0; k < carried.length; k++) if ((carried[k] ?? 0) > 0) carried[k] -= 1;
    }
    const width = Math.max(1, ...covered);
    const columnWidth = Math.floor(TEXT_WIDTH / width);

    const cellContext = (cell: HTMLTableCellElement): Context => ({
      style: inlineStyle(cell, context.style),
      alignment: alignmentOf(cell),
      quote: 0,
      item: null,
      pre: false,
      spaced: false,
    });

    const rows = htmlRows.map((row, index) => {
      const cells = Array.from(row.cells).map((cell) => {
        const children: (Paragraph | Table)[] = [];
        this.blocks(cell, cellContext(cell), children);
        const columns = Math.min(Math.max(cell.colSpan, 1), 63);
        const below = htmlRows.length - index;
        const rows = cell.rowSpan === 0 ? below : Math.min(Math.max(cell.rowSpan, 1), below);
        return new TableCell({
          children,
          width: { size: columnWidth * columns, type: WidthType.DXA },
          ...(columns > 1 ? { columnSpan: columns } : {}),
          ...(rows > 1 ? { rowSpan: rows } : {}),
        });
      });
      for (let k = covered[index]; k < width; k++) {
        cells.push(
          new TableCell({
            children: [new Paragraph({ bidirectional: true, children: [] })],
            width: { size: columnWidth, type: WidthType.DXA },
          }),
        );
      }
      return new TableRow({ children: cells });
    });

    return new Table({
      rows,
      visuallyRightToLeft: true,
      width: { size: columnWidth * width, type: WidthType.DXA },
      columnWidths: Array.from({ length: width }, () => columnWidth),
    });
  }

  /** Inline nodes → segments, carrying formatting and the link they sit in. */
  private segments(node: Node, style: InlineStyle, url: string | null, pre: boolean): Segment[] {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? "";
      if (!pre) {
        const text = raw.replace(/[ \t\n\r\f]+/g, " ");
        return text ? [{ kind: "text", text, style, url }] : [];
      }
      const out: Segment[] = [];
      raw.split("\n").forEach((line, index) => {
        if (index > 0) out.push({ kind: "break" });
        if (line) out.push({ kind: "text", text: line, style, url });
      });
      return out;
    }
    if (!isElement(node)) return [];

    const tag = node.localName;
    if (tag === "br") return [{ kind: "break" }];
    if (tag === FOOTNOTE_TAG) return [{ kind: "footnote", id: Number(node.getAttribute("data-n")) }];

    let own = inlineStyle(node, style);
    let link = url;
    if (tag === "a") {
      link = exportUrl(node, this.base);
      if (link) own = { ...own, underline: true, color: own.color ?? LINK_BLUE };
    }
    return Array.from(node.childNodes).flatMap((child) => this.segments(child, own, link, pre));
  }

  /** Gathered inline nodes → one paragraph, or none when they hold nothing at all. */
  private paragraph(nodes: Node[], context: Context, out: (Paragraph | Table)[]): void {
    const raw: Segment[] = [];
    for (const node of nodes) {
      for (const segment of this.segments(node, context.style, null, context.pre)) {
        // Collapse a space that ends one run and starts the next, as the browser does.
        const previous = raw.at(-1);
        if (
          segment.kind === "text" &&
          !context.pre &&
          previous?.kind === "text" &&
          previous.text.endsWith(" ") &&
          segment.text.startsWith(" ")
        ) {
          const text = segment.text.slice(1);
          if (text) raw.push({ ...segment, text });
        } else raw.push(segment);
      }
    }
    const segments = trimSegments(raw, context.pre);
    // Words, or a line held open by a <br>: anything else draws nothing on screen.
    if (segments.length === 0 && !raw.some((segment) => segment.kind === "break")) return;

    const item = context.item;
    const numbered = item !== null && !item.numbered;
    if (item) item.numbered = true;

    let start = context.quote * STEP;
    if (item) start += STEP * (item.level + 1);

    const options: IParagraphOptions = {
      bidirectional: true,
      children: runsOf(segments),
      ...(context.heading ? { heading: context.heading } : {}),
      ...(context.alignment ? { alignment: context.alignment } : {}),
      ...(item && numbered ? { numbering: { reference: item.reference, level: item.level } } : {}),
      // A numbered item takes its indent from its level unless a quote moves it;
      // a later paragraph of the item lines up under the first one's text.
      ...(start > 0 && (!numbered || context.quote > 0)
        ? { indent: numbered ? { left: start, hanging: HANGING } : { left: start } }
        : {}),
      ...(context.spaced ? { spacing: { after: this.gap } } : {}),
    };
    out.push(new Paragraph(options));
  }
}

/** The footnote a citation becomes: its line's words, then the address. */
function footnote(source: FootnoteSource): { children: Paragraph[] } {
  const children: ParagraphChild[] = [new TextRun({ text: source.label, rightToLeft: true })];
  if (source.url) {
    children.push(
      new TextRun({ text: " — ", rightToLeft: true }),
      new ExternalHyperlink({
        link: source.url,
        children: [new TextRun({ text: source.url, style: "Hyperlink" })],
      }),
    );
  }
  return { children: [new Paragraph({ style: "FootnoteText", bidirectional: true, children })] };
}

/** Build the .docx bytes. Exported separately so a test can open the result. */
export async function buildDocx(title: string, html: string, options: DocxOptions = {}): Promise<Blob> {
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY;
  const base = window.location.href;
  const root = parseNote(html);
  const verse = holdsVerse(root);
  const sources = options.footnotes ? takeCitations(root, base) : [];

  const face = firstFamily(NOTE_FONT_STACKS[typography.font]) ?? "UKIJ Ekran";
  const faces = { ascii: face, hAnsi: face, cs: face, eastAsia: face };
  // 1 px = 0.75 pt; Word counts half-points.
  const body = Math.round(typography.fontSize * 0.75 * 2);
  const scaled = (em: number) => Math.round(body * em);
  /** em → twips, for spacing. */
  const twips = (em: number) => Math.round(body * em * 10);

  const walk = new DocxWalk(base, body);
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      bidirectional: true,
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: normalizeTitle(title), rightToLeft: true })],
    }),
  ];
  walk.blocks(
    root,
    { style: PLAIN, quote: 0, item: null, pre: false, spaced: false },
    children,
  );
  // An empty note still has to produce a file Word will open with a body.
  if (children.length === 1) children.push(new Paragraph({ bidirectional: true, children: [] }));

  // The credit the Qur'an's sources require (lib/notes/attribution.ts):
  // once, at the end, and only when a verse is actually in the note.
  if (verse) {
    children.push(
      new Paragraph({ bidirectional: true, children: [] }),
      new Paragraph({
        bidirectional: true,
        children: [new TextRun({ text: QURAN_ATTRIBUTION, rightToLeft: true, size: scaled(0.72) })],
      }),
    );
  }

  const heading = (em: number) => ({
    run: { size: scaled(em), bold: true, color: INK },
    paragraph: { spacing: { before: twips(1.2), after: twips(0.5) } },
  });

  const document_ = new Document({
    styles: {
      default: {
        document: {
          run: { font: faces, size: body, sizeComplexScript: body },
          // CSS line-height is a line box of exactly size × height; "at
          // least" that reproduces it and never clips a larger run, where
          // Word's "multiple" would multiply the font's own, taller line gap.
          paragraph: { spacing: { line: twips(typography.lineHeight), lineRule: LineRuleType.AT_LEAST } },
        },
        title: {
          run: { font: faces, size: scaled(1.75), bold: true, color: INK },
          paragraph: { spacing: { after: twips(0.85) } },
        },
        // The note's own heading sizes (.md-body h1…h6), so none is smaller than the text.
        heading1: heading(1.5),
        heading2: heading(1.3),
        heading3: heading(1.15),
        heading4: heading(1),
        heading5: heading(1),
        heading6: heading(1),
        footnoteText: {
          run: { size: scaled(0.8) },
          paragraph: { spacing: { line: 240, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    numbering: { config: walk.numbering },
    footnotes: Object.fromEntries(sources.map((source, index) => [index + 1, footnote(source)])),
    sections: [{ properties: {}, children }],
  });

  return Packer.toBlob(document_);
}

/** Build and hand it to the browser as a download. */
export async function downloadDocx(title: string, html: string, options: DocxOptions = {}): Promise<void> {
  saveFile(await buildDocx(title, html, options), exportFileName(title, "docx"));
}
