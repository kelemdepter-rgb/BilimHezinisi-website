import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from "docx";
import { QURAN_ATTRIBUTION, UTHMANIC_MARKER } from "@/lib/notes/attribution";

/**
 * Turn the editor's HTML into a Word file, in the browser.
 *
 * Deliberately not a server route: the document is already in the tab, and
 * sending it to a Vercel function and back would spend the free tier's
 * invocations on work the browser can do — and put private writing through a
 * server that has no reason to see it.
 *
 * Three things a cited note needs that plain formatting does not:
 *   - the link back to the book stays a link, resolved to an absolute URL so
 *     it still opens from a file sitting on somebody's desktop;
 *   - a run's font-family travels, so an inserted verse is in the Uthmani face
 *     in Word as well as on screen;
 *   - a note that quotes the Qur'an carries the credit its sources require.
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

type InlineStyle = {
  bold: boolean;
  italics: boolean;
  underline: boolean;
  color?: string;
  font?: string;
  size?: number;
};

const PLAIN: InlineStyle = { bold: false, italics: false, underline: false };

/** The first family of a CSS stack, unquoted — Word wants one name, not a list. */
function firstFamily(stack: string): string | undefined {
  const [first] = stack.split(",");
  const name = (first ?? "").trim().replace(/^['"]|['"]$/g, "").trim();
  return name || undefined;
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

/**
 * A relative href turned into one a Word file can follow.
 *
 * An exported note lives outside the browser, so `/books/12/read?page=3` means
 * nothing to it. Resolving against the current origin keeps the citation
 * clickable wherever the file ends up.
 */
function absoluteHref(href: string): string | null {
  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return null;
  }
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

/** One TextRun carrying everything inherited down to this point. */
function runWith(text: string, style: InlineStyle): TextRun {
  return new TextRun({
    text,
    rightToLeft: true,
    bold: style.bold,
    italics: style.italics,
    // docx wants an options object here, not a boolean; the empty object
    // means "single line, automatic colour".
    ...(style.underline ? { underline: {} } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.font ? { font: style.font } : {}),
    ...(style.size ? { size: style.size } : {}),
  });
}

/** What a run may be: plain text, or text inside a link. */
type Inline = TextRun | ExternalHyperlink;

/** Walk inline nodes, carrying bold/italic/underline/colour/face down the tree. */
function runsFrom(node: Node, inherited: InlineStyle = PLAIN): Inline[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) return [];
    return [runWith(text, inherited)];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const element = node as HTMLElement;
  const tag = element.tagName;
  const style: InlineStyle = {
    bold: inherited.bold || tag === "B" || tag === "STRONG",
    italics: inherited.italics || tag === "I" || tag === "EM",
    underline: inherited.underline || tag === "U",
    color: (element.style.color && toDocxColor(element.style.color)) || inherited.color,
    font: (element.style.fontFamily && firstFamily(element.style.fontFamily)) || inherited.font,
    size: (element.style.fontSize && toHalfPoints(element.style.fontSize)) || inherited.size,
  };

  if (tag === "A") {
    const href = absoluteHref(element.getAttribute("href") ?? "");
    const children: TextRun[] = [];
    for (const child of Array.from(element.childNodes)) {
      for (const run of runsFrom(child, { ...style, underline: true, color: style.color ?? "1155CC" })) {
        // A link cannot nest another link, so anything that came back as one
        // is flattened to its text — which cannot happen from our own markup.
        if (run instanceof ExternalHyperlink) continue;
        children.push(run);
      }
    }
    if (!href || children.length === 0) return children;
    return [new ExternalHyperlink({ children, link: href })];
  }

  const runs: Inline[] = [];
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

/**
 * The credit an exported note owes when it quotes the Qur'an — appended once,
 * at the end, and only when a verse is actually in the document. See
 * lib/notes/attribution.ts.
 */
function quranCredit(container: HTMLElement): Paragraph[] {
  if (!container.querySelector(`[style*="${UTHMANIC_MARKER}"]`)) return [];
  return [
    new Paragraph({ bidirectional: true, children: [] }),
    new Paragraph({
      bidirectional: true,
      children: [new TextRun({ text: QURAN_ATTRIBUTION, rightToLeft: true, size: 18 })],
    }),
  ];
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
      ...quranCredit(container),
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
