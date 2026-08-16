import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from "docx";

/**
 * Turn the editor's HTML into a Word file, in the browser.
 *
 * Deliberately not a server route: the document is already in the tab, and
 * sending it to a Vercel function and back would spend the free tier's
 * invocations on work the browser can do — and put private writing through a
 * server that has no reason to see it.
 */

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
};

const ALIGNMENT: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  center: AlignmentType.CENTER,
  left: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

type InlineStyle = { bold: boolean; italics: boolean; underline: boolean; color?: string };

const PLAIN: InlineStyle = { bold: false, italics: false, underline: false };

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

/** Walk inline nodes, carrying bold/italic/underline/colour down the tree. */
function runsFrom(node: Node, inherited: InlineStyle = PLAIN): TextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) return [];
    return [
      new TextRun({
        text,
        rightToLeft: true,
        bold: inherited.bold,
        italics: inherited.italics,
        // docx wants an options object here, not a boolean; the empty object
        // means "single line, automatic colour".
        ...(inherited.underline ? { underline: {} } : {}),
        ...(inherited.color ? { color: inherited.color } : {}),
      }),
    ];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const element = node as HTMLElement;
  const tag = element.tagName;
  const style: InlineStyle = {
    bold: inherited.bold || tag === "B" || tag === "STRONG",
    italics: inherited.italics || tag === "I" || tag === "EM",
    underline: inherited.underline || tag === "U",
    color: (element.style.color && toDocxColor(element.style.color)) || inherited.color,
  };

  const runs: TextRun[] = [];
  for (const child of Array.from(element.childNodes)) runs.push(...runsFrom(child, style));
  return runs;
}

function paragraphsFrom(root: HTMLElement): Paragraph[] {
  const out: Paragraph[] = [];

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) out.push(new Paragraph({ bidirectional: true, children: [new TextRun({ text, rightToLeft: true })] }));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const element = node as HTMLElement;
    const tag = element.tagName;

    if (tag === "UL" || tag === "OL") {
      for (const item of Array.from(element.querySelectorAll("li"))) {
        out.push(
          new Paragraph({
            bidirectional: true,
            children: runsFrom(item),
            ...(tag === "UL" ? { bullet: { level: 0 } } : { numbering: { reference: "ug-numbering", level: 0 } }),
          }),
        );
      }
      continue;
    }

    const alignment = ALIGNMENT[element.style.textAlign];
    out.push(
      new Paragraph({
        bidirectional: true,
        children: runsFrom(element),
        ...(HEADINGS[tag] ? { heading: HEADINGS[tag] } : {}),
        ...(tag === "BLOCKQUOTE" ? { indent: { start: 720 } } : {}),
        ...(alignment ? { alignment } : {}),
      }),
    );
  }

  // An empty document still has to produce a file Word will open.
  if (out.length === 0) out.push(new Paragraph({ bidirectional: true, children: [] }));
  return out;
}

/** Build the .docx bytes. Exported separately so a test can open the result. */
export async function buildDocx(title: string, html: string): Promise<Blob> {
  const container = document.createElement("div");
  container.innerHTML = html;

  const section: ISectionOptions = {
    properties: {},
    children: [
      new Paragraph({
        bidirectional: true,
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: title, rightToLeft: true })],
      }),
      ...paragraphsFrom(container),
    ],
  };

  const document_ = new Document({
    numbering: {
      config: [
        {
          reference: "ug-numbering",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [section],
  });

  return Packer.toBlob(document_);
}

/** Build and hand it to the browser as a download. */
export async function downloadDocx(title: string, html: string): Promise<void> {
  const blob = await buildDocx(title, html);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "خاتىرە"}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — Safari needs the URL alive when the click lands.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
