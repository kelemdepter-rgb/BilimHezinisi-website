/**
 * A passage from a book, drawn to a PNG the reader can send to a friend.
 *
 * This library has no advertising budget, so word of mouth is the whole
 * distribution plan — and a picture of a paragraph travels through messaging
 * apps in a way a link does not. The card therefore has to carry its own
 * source: the book, the author and the site, so wherever the image ends up it
 * still says where the words came from.
 *
 * Drawn on a plain <canvas>, in the browser, with no library and no server.
 * Canvas shapes Arabic script through the platform's own text engine, so with
 * direction = "rtl" and the site's own font loaded, Uyghur comes out correctly
 * joined — which is the only reason this is worth doing at all. A card that
 * renders Uyghur badly would be worse than no card.
 */

/** The manuscript palette, light theme, from app/globals.css `:root`. */
const PAPER = "#FBF6EC";
const INK = "#2A2012";
const INK2 = "#6B5840";
const INK3 = "#9A8A70";
const GOLD = "#C9A24B";
const AMBER = "#B0832F";

/**
 * Square, and big enough to stay sharp when a messaging app re-encodes it.
 * 1080 is what every phone camera and every social app is built around.
 */
export const CARD_SIZE = 1080;
const PADDING = 88;
/** The gold rule inset from the card edge. */
const FRAME = 44;

/**
 * Longer than this and the type has to shrink past the point of being
 * readable on a phone screen — at which point a link to the page is the
 * better thing to send, which is what the reader is told.
 */
export const QUOTE_MAX_CHARS = 400;

export const QUOTE_TOO_LONG = `نەقىل بەك ئۇزۇن. ${QUOTE_MAX_CHARS} ھەرپتىن ئازراقىنى تاللاڭ، ياكى بەتنىڭ ئۇلانمىسىنى ئەۋەتىڭ.`;
export const QUOTE_EMPTY = "ئالدى بىلەن رەسىمگە چىقارماقچى بولغان جۈملىنى تاللاڭ.";

export type QuoteCardInput = {
  quote: string;
  title: string;
  author: string;
  /** Shown as «41-بەت» under the quote when the passage came from the reader. */
  pageNo?: number | null;
  siteName: string;
  /** The site's own domain, so the image can be traced back without a link. */
  siteHost: string;
};

/**
 * Greedy word wrap against a caller-supplied measuring function.
 *
 * Split out from the drawing so it can be tested without a canvas: the wrap
 * is where the bugs live, and a line that overflows the card is invisible in
 * code review but obvious in a test.
 */
export function fitLines(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
): string[] {
  const lines: string[] = [];
  // Paragraph breaks in the selection are kept: a quote spanning two
  // paragraphs reads as nonsense when they are run together.
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Trim a selection to something worth drawing, or say why it is not. */
export function checkQuote(raw: string): { ok: true; quote: string } | { ok: false; message: string } {
  const quote = raw.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!quote) return { ok: false, message: QUOTE_EMPTY };
  if (quote.length > QUOTE_MAX_CHARS) return { ok: false, message: QUOTE_TOO_LONG };
  return { ok: true, quote };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

const face = (size: number, weight = "") =>
  `${weight} ${size}px "UKIJ Ekran", "Traditional Arabic", serif`.trim();

/**
 * Make sure the shipped face is actually loaded before anything is measured.
 *
 * Without this the first card on a cold page is drawn — and measured — in the
 * fallback serif, which wraps to different line lengths and then repaints in
 * UKIJ Ekran at the wrong widths.
 */
async function ensureFont(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(face(48)),
      document.fonts.load(face(48, "bold")),
    ]);
    await document.fonts.ready;
  } catch {
    // The font failed to load; the card still draws in the fallback.
  }
}

/**
 * Draw the card and hand back the PNG.
 *
 * The card always wears the LIGHT manuscript palette, whatever theme the
 * reader is using. It is going to land in somebody else's chat window, next
 * to other people's images, and one recognisable look is worth more there
 * than matching the reader's own screen.
 */
export async function renderQuoteCard(input: QuoteCardInput): Promise<Blob> {
  await ensureFont();

  const canvas = document.createElement("canvas");
  canvas.width = CARD_SIZE;
  canvas.height = CARD_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);

  // A double gold rule, the way the desktop app frames a manuscript panel.
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  roundedRect(ctx, FRAME, FRAME, CARD_SIZE - FRAME * 2, CARD_SIZE - FRAME * 2, 26);
  ctx.stroke();
  ctx.strokeStyle = `${AMBER}55`;
  ctx.lineWidth = 1;
  roundedRect(ctx, FRAME + 12, FRAME + 12, CARD_SIZE - (FRAME + 12) * 2, CARD_SIZE - (FRAME + 12) * 2, 18);
  ctx.stroke();

  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  const right = CARD_SIZE - PADDING;
  const maxWidth = CARD_SIZE - PADDING * 2;

  // The opening quotation mark, as an ornament rather than punctuation.
  ctx.fillStyle = `${GOLD}66`;
  ctx.font = face(150, "bold");
  ctx.fillText("«", right, PADDING + 130);

  const footerHeight = 210;
  const quoteTop = PADDING + 170;
  const quoteRoom = CARD_SIZE - quoteTop - footerHeight;

  /**
   * Shrink the type until the passage fits. A fixed size would either clip a
   * long quote or leave a short one marooned in the middle of an empty card.
   */
  let size = 52;
  let lines: string[] = [];
  let lineHeight = 0;
  while (size >= 26) {
    ctx.font = face(size);
    lineHeight = Math.round(size * 1.85);
    lines = fitLines(input.quote, maxWidth, (line) => ctx.measureText(line).width);
    if (lines.length * lineHeight <= quoteRoom) break;
    size -= 2;
  }

  ctx.fillStyle = INK;
  ctx.font = face(size);
  // Centred in the space it was given, so a two-line quote does not sit at
  // the top of an empty card.
  let y = quoteTop + Math.max(0, (quoteRoom - lines.length * lineHeight) / 2) + lineHeight;
  for (const line of lines) {
    ctx.fillText(line, right, y);
    y += lineHeight;
  }

  // Where it came from.
  const footerTop = CARD_SIZE - footerHeight;
  ctx.strokeStyle = `${AMBER}66`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PADDING, footerTop);
  ctx.lineTo(CARD_SIZE - PADDING, footerTop);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = face(36, "bold");
  const title =
    input.title.length > 44 ? `${input.title.slice(0, 43)}…` : input.title;
  ctx.fillText(title, right, footerTop + 62);

  ctx.fillStyle = INK2;
  ctx.font = face(28);
  const credit = [input.author, input.pageNo ? `${input.pageNo}-بەت` : ""]
    .filter(Boolean)
    .join(" · ");
  if (credit) ctx.fillText(credit, right, footerTop + 108);

  ctx.fillStyle = AMBER;
  ctx.font = face(28, "bold");
  ctx.fillText(input.siteName, right, footerTop + 158);

  // The domain runs left to right even on a right-to-left card.
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.fillStyle = INK3;
  ctx.font = face(24);
  ctx.fillText(input.siteHost, PADDING, footerTop + 158);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode the card"))),
      "image/png",
    );
  });
}
