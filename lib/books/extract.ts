/**
 * Browser-side extraction. Vercel functions cap request bodies at 4.5 MB and
 * time out quickly, so book files are NEVER uploaded for parsing (CLAUDE.md) —
 * everything here runs in the admin's own browser.
 *
 * PDF is not accepted. Scanned PDFs need OCR the web cannot do, and the parser
 * bloats the phone bundle; the desktop app opens PDFs, OCRs them when needed
 * and exports DOCX, which this pipeline does accept.
 */
import { sha256Hex } from "@/lib/books/hash";
import { normalizeText } from "@/lib/books/chunk";
import { formatFromFileName, guessTitle, todayIso } from "@/lib/books/metadata";
import type { BookFormat, ContentFormat, ExtractedBook } from "@/lib/books/types";

/** Server route limit for legacy .doc — Vercel's body cap with headroom. */
export const DOC_MAX_BYTES = 4 * 1024 * 1024;

/** Exactly what the picker, drag-drop and validation accept. */
export const ACCEPTED_EXTENSIONS = ["docx", "doc", "md", "markdown", "html", "htm", "txt"] as const;
export const ACCEPT_ATTRIBUTE = ".docx,.doc,.md,.markdown,.html,.htm,.txt";

export const PDF_REJECTION_MESSAGE =
  "PDF ھۆججەتنى بۇ يەرگە يوللىغىلى بولمايدۇ. ئۇنى كومپيۇتېردىكى «بىلىم خەزىنىسى» دېتالىدا ئېچىڭ (سىكان قىلىنغان بولسا شۇ يەردە OCR قىلىڭ)، ئاندىن DOCX قىلىپ ساقلاپ، شۇ DOCX نى يوللاڭ.";

export class ExtractionError extends Error {}

export function extensionOf(fileName: string): string {
  return (fileName.split(".").pop() ?? "").toLowerCase();
}

export function isPdf(file: { name: string; type?: string }): boolean {
  return extensionOf(file.name) === "pdf" || file.type === "application/pdf";
}

/** Throws a clear Uyghur error for anything outside the accepted list. */
export function assertAcceptedFile(file: { name: string; type?: string }): void {
  if (isPdf(file)) throw new ExtractionError(PDF_REJECTION_MESSAGE);
  const extension = extensionOf(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ExtractionError(
      `«.${extension}» فورماتى قوللانمايدۇ. قوبۇل قىلىنىدىغانلىرى: DOCX، DOC، MD، HTML، TXT.`,
    );
  }
}

/**
 * DOCX → HTML → Markdown, so headings, bold, lists and tables survive.
 * extractRawText would throw all of that away.
 */
async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const { htmlToMarkdown } = await import("@/lib/books/markdown");
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return htmlToMarkdown(result.value ?? "");
}

async function extractHtml(file: File): Promise<string> {
  const { htmlToMarkdown } = await import("@/lib/books/markdown");
  const { sanitizeHtml } = await import("@/lib/sanitize");
  // Sanitize before converting so no script/style text can reach the book.
  return htmlToMarkdown(sanitizeHtml(await file.text()));
}

/** Legacy .doc needs word-extractor, which is Node-only — small files only. */
async function extractDoc(file: File): Promise<string> {
  if (file.size > DOC_MAX_BYTES) {
    throw new ExtractionError(
      "بۇ .doc ھۆججەت 4 MB دىن چوڭ. Word دا ئېچىپ .docx قىلىپ ساقلاڭ، ئاندىن قايتا يوللاڭ.",
    );
  }
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/import/doc", { method: "POST", body });
  const payload = (await response.json()) as { ok?: boolean; text?: string; error?: string };
  if (!response.ok || !payload.ok) {
    throw new ExtractionError(payload.error ?? "DOC ھۆججەتنى ئوقۇغىلى بولمىدى.");
  }
  return payload.text ?? "";
}

/** Extract one file entirely in the browser (except legacy .doc). */
export async function extractFromFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<ExtractedBook> {
  assertAcceptedFile(file);

  const format: BookFormat = formatFromFileName(file.name);
  let text = "";
  // Only formats that carry structure become Markdown; the rest stay text so
  // nothing is rendered that the source never expressed.
  let contentFormat: ContentFormat = "text";

  onProgress?.(0.1);
  switch (format) {
    case "DOCX":
      text = await extractDocx(file);
      contentFormat = "markdown";
      break;
    case "DOC":
      text = await extractDoc(file);
      break;
    case "HTML":
      text = await extractHtml(file);
      contentFormat = "markdown";
      break;
    case "MD":
      text = await file.text();
      contentFormat = "markdown";
      break;
    default:
      text = await file.text();
      break;
  }

  onProgress?.(1);
  const normalized = normalizeText(text);
  if (!normalized) {
    throw new ExtractionError("بۇ ھۆججەتتىن تېكىست چىقمىدى. ھۆججەتنى تەكشۈرۈپ قايتا سىناڭ.");
  }

  return {
    fileName: file.name,
    format,
    text: normalized,
    contentFormat,
    // Desktop parity: the hash covers the extracted text, not the raw bytes.
    fileHash: await sha256Hex(normalized),
    title: guessTitle({ fileName: file.name, text: normalized }),
    author: "",
    date: todayIso(),
    file,
  };
}

/** Import an article by URL — the fetch and parse happen server-side. */
export async function extractFromUrl(url: string): Promise<ExtractedBook> {
  const response = await fetch("/api/import/url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    text?: string;
    title?: string;
    author?: string;
    error?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new ExtractionError(payload.error ?? "تور بەتنى ئوقۇغىلى بولمىدى.");
  }
  const normalized = normalizeText(payload.text ?? "");
  if (!normalized) throw new ExtractionError("بۇ تور بەتتىن تېكىست چىقمىدى.");

  return {
    fileName: payload.title || url,
    format: "URL",
    text: normalized,
    contentFormat: "markdown",
    fileHash: await sha256Hex(normalized),
    title: payload.title || url,
    author: payload.author ?? "",
    date: todayIso(),
  };
}
