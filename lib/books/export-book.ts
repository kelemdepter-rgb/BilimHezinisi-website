import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from "docx";
import { renderMarkdown } from "@/lib/books/render-markdown";
import type { ContentFormat } from "@/lib/books/types";

/**
 * Turn a whole book into a file the reader keeps.
 *
 * The point of this is not convenience. This library is one person's project
 * on a free plan; if it ever goes dark, whatever readers have already
 * downloaded is what survives. So the export has to be a plain, ordinary
 * document that opens in Word or any text editor a decade from now — not a
 * format only this site understands.
 *
 * Everything here runs in the browser. Building a book server-side would mean
 * a Vercel function holding an entire book in memory and streaming it back,
 * which is both the slow path and the expensive one; the pages are already in
 * the tab, and often already in the offline cache.
 */

export type BookExportMeta = {
  title: string;
  author: string;
  contentFormat: ContentFormat;
  /** Absolute address of the book on this site, written into the file. */
  sourceUrl: string;
};

/**
 * Named on every run and as the document default.
 *
 * This is the desktop app's choice (main.js, export-as-docx) and the site's
 * own reading face, so anyone who uses either already has it. A reader who
 * has neither gets Word's own substitute — which still lays the text out
 * right-to-left, because that comes from the bidi properties below and not
 * from the font.
 */
export const EXPORT_FONT = "UKIJ Ekran";

const SITE_NAME = "بىلىم خەزىنىسى";

/** Half-points, the unit Word measures type in: 28 = 14pt, as on the desktop. */
const BODY_SIZE = 28;
const TITLE_SIZE = 36;
const META_SIZE = 22;

const HEADING_LEVELS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

/** «مەنبە: بىلىم خەزىنىسى — https://…» — the line that says where this came from. */
export function sourceLine(meta: BookExportMeta): string {
  return `مەنبە: ${SITE_NAME} — ${meta.sourceUrl}`;
}

/* ── plain text / Markdown ───────────────────────────────────────────────── */

/**
 * A Markdown book keeps its Markdown: that IS its formatting, and stripping
 * it to make the file "plain" would throw away the headings and lists the
 * reader can see on screen. A text book has no formatting to keep.
 */
export function buildBookText(meta: BookExportMeta, pages: readonly string[]): string {
  const body = pages.join("\n\n");
  if (meta.contentFormat === "markdown") {
    const head = [`# ${meta.title}`];
    if (meta.author) head.push(`**${meta.author}**`);
    head.push(`> ${sourceLine(meta)}`, "---");
    return `${head.join("\n\n")}\n\n${body}\n`;
  }
  const head = [meta.title];
  if (meta.author) head.push(meta.author);
  head.push(sourceLine(meta), "─".repeat(40));
  return `${head.join("\n")}\n\n${body}\n`;
}

export function textFileExtension(contentFormat: ContentFormat): "md" | "txt" {
  return contentFormat === "markdown" ? "md" : "txt";
}

/* ── DOCX ────────────────────────────────────────────────────────────────── */

type Block = Paragraph | Table;

function run(text: string, extra: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({
    text,
    // Sets w:rtl on the run. Without it Word reorders Uyghur punctuation and
    // any Latin or digits inside the line, which is the classic "the DOCX
    // opens backwards" failure.
    rightToLeft: true,
    font: { ascii: EXPORT_FONT, hAnsi: EXPORT_FONT, cs: EXPORT_FONT },
    size: extra.size ?? BODY_SIZE,
    ...(extra.bold ? { bold: true } : {}),
    ...(extra.italics ? { italics: true } : {}),
    ...(extra.color ? { color: extra.color } : {}),
  });
}

/** A body paragraph: right-aligned and bidirectional, as the desktop exports. */
function paragraph(children: TextRun[], extra: Record<string, unknown> = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children,
    ...extra,
  });
}

type InlineStyle = { bold: boolean; italics: boolean };

/** Walk an element's inline children, carrying emphasis down the tree. */
function inlineRuns(node: Node, inherited: InlineStyle = { bold: false, italics: false }): TextRun[] {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const text = node.textContent ?? "";
    return text ? [run(text, inherited)] : [];
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return [];

  const element = node as HTMLElement;
  if (element.tagName === "BR") return [new TextRun({ break: 1 })];

  const style: InlineStyle = {
    bold: inherited.bold || element.tagName === "STRONG" || element.tagName === "B",
    italics: inherited.italics || element.tagName === "EM" || element.tagName === "I",
  };

  const runs: TextRun[] = [];
  for (const child of Array.from(element.childNodes)) runs.push(...inlineRuns(child, style));

  // A link keeps its address, because a printed page cannot be clicked and
  // the reader would otherwise lose where it pointed.
  const href = element.tagName === "A" ? element.getAttribute("href") : null;
  if (href && !element.textContent?.includes(href)) {
    runs.push(run(` (${href})`, { size: META_SIZE, color: "6B5840" }));
  }
  return runs;
}

function cellsOf(row: HTMLTableRowElement, header: boolean): TableCell[] {
  return Array.from(row.cells).map(
    (cell) =>
      new TableCell({
        children: [paragraph(inlineRuns(cell, { bold: header, italics: false }))],
      }),
  );
}

function tableFrom(element: HTMLTableElement): Table {
  const rows: TableRow[] = [];
  for (const section of Array.from(element.tHead ? [element.tHead] : [])) {
    for (const row of Array.from(section.rows)) {
      rows.push(new TableRow({ tableHeader: true, children: cellsOf(row, true) }));
    }
  }
  for (const body of Array.from(element.tBodies)) {
    for (const row of Array.from(body.rows)) {
      rows.push(new TableRow({ children: cellsOf(row, false) }));
    }
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    // Mirrors the column order, so the first column sits on the right where an
    // Uyghur reader expects it.
    visuallyRightToLeft: true,
  });
}

function listItems(element: HTMLElement, ordered: boolean, depth = 0): Block[] {
  const out: Block[] = [];
  for (const item of Array.from(element.children)) {
    if (item.tagName !== "LI") continue;
    const nested = Array.from(item.children).filter(
      (child) => child.tagName === "UL" || child.tagName === "OL",
    );
    // The item's own text, without the text of any list nested inside it.
    const own = Array.from(item.childNodes).filter(
      (child) => !nested.includes(child as Element),
    );
    const runs = own.flatMap((child) => inlineRuns(child));
    if (runs.length > 0) {
      out.push(
        paragraph(runs, {
          ...(ordered
            ? { numbering: { reference: "book-numbering", level: Math.min(depth, 2) } }
            : { bullet: { level: Math.min(depth, 2) } }),
        }),
      );
    }
    for (const child of nested) {
      out.push(...listItems(child as HTMLElement, child.tagName === "OL", depth + 1));
    }
  }
  return out;
}

/** One rendered Markdown element → the Word blocks that stand for it. */
function blocksFrom(element: HTMLElement): Block[] {
  const tag = element.tagName;

  if (HEADING_LEVELS[tag]) {
    return [paragraph(inlineRuns(element, { bold: true, italics: false }), { heading: HEADING_LEVELS[tag] })];
  }
  if (tag === "UL" || tag === "OL") return listItems(element, tag === "OL");
  if (tag === "BLOCKQUOTE") {
    return Array.from(element.children).flatMap((child) =>
      blocksFrom(child as HTMLElement).map((block) =>
        block instanceof Paragraph
          ? paragraph(inlineRuns(child), { indent: { start: 720 }, italics: true })
          : block,
      ),
    );
  }
  if (tag === "PRE") {
    return (element.textContent ?? "").split("\n").map((line) =>
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: line, font: "Consolas", size: BODY_SIZE - 4 })],
      }),
    );
  }
  if (tag === "TABLE") return [tableFrom(element as HTMLTableElement)];
  if (tag === "HR") {
    return [
      new Paragraph({
        bidirectional: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9A8A70" } },
        children: [],
      }),
    ];
  }
  const runs = inlineRuns(element);
  return runs.length > 0 ? [paragraph(runs)] : [];
}

/** Markdown (already rendered to HTML) → Word blocks. */
function markdownBlocks(markdown: string, container: HTMLElement): Block[] {
  container.innerHTML = renderMarkdown(markdown);
  const out: Block[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").trim();
      if (text) out.push(paragraph([run(text)]));
      continue;
    }
    if (node.nodeType !== 1) continue;
    out.push(...blocksFrom(node as HTMLElement));
  }
  return out;
}

/** Plain text → one paragraph per line, exactly as the desktop app exports. */
function textBlocks(text: string): Block[] {
  return text.split("\n").map((line) => paragraph(line ? [run(line)] : []));
}

/**
 * Build the .docx bytes. Exported separately from the download so a test can
 * open the archive and read the bidi properties back out.
 */
export async function buildBookDocx(
  meta: BookExportMeta,
  pages: readonly string[],
): Promise<Blob> {
  // markdown-it output is parsed through a detached element rather than
  // innerHTML on the live page: nothing here is ever inserted into the
  // document, and markdown-it is configured with html:false so there is no
  // raw-HTML path into it in the first place (lib/books/render-markdown.ts).
  const container = document.createElement("div");

  const body: Block[] = [];
  for (const page of pages) {
    body.push(
      ...(meta.contentFormat === "markdown"
        ? markdownBlocks(page, container)
        : textBlocks(page)),
    );
  }

  const front: Block[] = [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [run(meta.title, { bold: true, size: TITLE_SIZE })],
    }),
  ];
  if (meta.author) {
    front.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [run(meta.author, { size: 24, color: "6B5840" })],
      }),
    );
  }
  front.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [run(sourceLine(meta), { size: META_SIZE, color: "9A8A70" })],
    }),
  );

  const section: ISectionOptions = {
    // The desktop app's page size, so a book exported from either edition
    // comes out the same shape.
    properties: { page: { size: { width: 12240, height: 15840 } } },
    children: [...front, ...body],
  };

  const document_ = new Document({
    styles: {
      default: {
        document: {
          // rtl on the default run means anything this file does not build by
          // hand — a style Word applies itself — is still right-to-left.
          // Paragraph direction cannot be defaulted here (Word keeps w:bidi
          // out of the document defaults), so every paragraph sets it itself.
          run: { font: EXPORT_FONT, size: BODY_SIZE, rightToLeft: true },
          paragraph: { alignment: AlignmentType.RIGHT },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "book-numbering",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: "decimal" as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [section],
  });

  return Packer.toBlob(document_);
}

/* ── handing the file to the browser ─────────────────────────────────────── */

/** A filename Windows, macOS and Android will all accept. */
export function exportFileName(title: string, extension: string): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe || "كىتاب"}.${extension}`;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — Safari needs the URL alive when the click lands.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
