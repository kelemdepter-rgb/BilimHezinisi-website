/**
 * Browser-side extraction. Vercel functions cap request bodies at 4.5 MB and
 * time out quickly, so book files are NEVER uploaded for parsing (CLAUDE.md) —
 * everything here runs in the admin's own browser.
 */
import { sha256Hex } from "@/lib/books/hash";
import { normalizeText } from "@/lib/books/chunk";
import { formatFromFileName, guessTitle, todayIso } from "@/lib/books/metadata";
import type { BookFormat, ExtractedBook } from "@/lib/books/types";

/** Below this many characters per page a PDF is treated as scanned (desktop parity). */
const SCANNED_CHARS_PER_PAGE = 50;
/** Server route limit for legacy .doc — Vercel's body cap with headroom. */
export const DOC_MAX_BYTES = 4 * 1024 * 1024;

export class ExtractionError extends Error {}

type PdfModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfModule> | null = null;

async function loadPdfjs(): Promise<PdfModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

type PdfExtraction = {
  text: string;
  pageCount: number;
  scanned: boolean;
  embeddedTitle: string | null;
  embeddedAuthor: string | null;
};

async function extractPdf(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<PdfExtraction> {
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  // cMaps + standard fonts let pdf.js resolve CID-keyed Arabic/Uyghur fonts to
  // Unicode, so getTextContent returns correctly shaped text rather than junk.
  const pdf = await pdfjs.getDocument({
    data: bytes,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;

  let text = "";
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    text += `${pageText}\n\n`;
    onProgress?.(pageNo / pdf.numPages);
  }

  let embeddedTitle: string | null = null;
  let embeddedAuthor: string | null = null;
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as { Title?: string; Author?: string } | undefined;
    embeddedTitle = info?.Title?.trim() || null;
    embeddedAuthor = info?.Author?.trim() || null;
  } catch {
    // Metadata is optional.
  }

  const denseChars = text.replace(/\s/g, "").length;
  const scanned = pdf.numPages > 0 && denseChars / pdf.numPages < SCANNED_CHARS_PER_PAGE;

  return { text, pageCount: pdf.numPages, scanned, embeddedTitle, embeddedAuthor };
}

/** Render page 1 to a JPEG cover, capped at `maxWidth` CSS pixels. */
export async function renderPdfCover(file: File, maxWidth = 800): Promise<Blob | null> {
  try {
    const pdfjs = await loadPdfjs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(maxWidth / base.width, 2) });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82),
    );
  } catch {
    return null;
  }
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value ?? "";
}

async function extractHtml(file: File): Promise<string> {
  const { default: TurndownService } = await import("turndown");
  const { sanitizeHtml } = await import("@/lib/sanitize");
  const raw = await file.text();
  // Sanitize before parsing so no script/style text can reach the stored book.
  const clean = sanitizeHtml(raw);
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  return turndown.turndown(clean);
}

/** Legacy .doc needs word-extractor, which is Node-only — small files only. */
async function extractDoc(file: File): Promise<string> {
  if (file.size > DOC_MAX_BYTES) {
    throw new ExtractionError(
      "بۇ .doc ھۆججەت 4 MB دىن چوڭ. كومپيۇتېر نۇسخىسىدا ئېچىپ .docx ياكى PDF قىلىپ ساقلاڭ، ئاندىن قايتا يوللاڭ.",
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
  const format: BookFormat = formatFromFileName(file.name);
  let text = "";
  let scanned = false;
  let sourcePageCount: number | undefined;
  let embeddedTitle: string | null = null;
  let embeddedAuthor: string | null = null;

  switch (format) {
    case "PDF": {
      const result = await extractPdf(file, onProgress);
      text = result.text;
      scanned = result.scanned;
      sourcePageCount = result.pageCount;
      embeddedTitle = result.embeddedTitle;
      embeddedAuthor = result.embeddedAuthor;
      break;
    }
    case "DOCX":
      text = await extractDocx(file);
      break;
    case "DOC":
      text = await extractDoc(file);
      break;
    case "HTML":
      text = await extractHtml(file);
      break;
    default:
      text = await file.text();
      break;
  }

  onProgress?.(1);
  const normalized = normalizeText(text);

  if (!scanned && !normalized) {
    throw new ExtractionError("بۇ ھۆججەتتىن تېكىست چىقمىدى. ھۆججەتنى تەكشۈرۈپ قايتا سىناڭ.");
  }

  return {
    fileName: file.name,
    format,
    text: normalized,
    // Desktop parity: the hash covers the extracted text, not the raw bytes.
    fileHash: await sha256Hex(normalized),
    title: guessTitle({ fileName: file.name, embeddedTitle, text: normalized }),
    author: embeddedAuthor ?? "",
    date: todayIso(),
    sourcePageCount,
    scanned,
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
    fileHash: await sha256Hex(normalized),
    title: payload.title || url,
    author: payload.author ?? "",
    date: todayIso(),
    scanned: false,
  };
}
