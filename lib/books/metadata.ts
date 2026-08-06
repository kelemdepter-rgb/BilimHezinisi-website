import type { BookFormat } from "@/lib/books/types";

/** Extension → stored `format`, mirroring the desktop app's ext.toUpperCase(). */
export function formatFromFileName(fileName: string): BookFormat {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "doc":
      return "DOC";
    case "md":
    case "markdown":
      return "MD";
    case "html":
    case "htm":
      return "HTML";
    default:
      return "TXT";
  }
}

/** Desktop parity: title defaults to the file name without its extension. */
export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

/** Today as YYYY-MM-DD, the desktop app's default for `date`. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * First plausible heading from extracted text: the first non-empty line that
 * is short enough to be a title and is not obviously a sentence. Used only
 * when the file itself carries no better metadata.
 */
export function headingFromText(text: string): string {
  for (const raw of text.split("\n", 40)) {
    const line = raw.replace(/^#+\s*/, "").trim();
    if (line.length < 3 || line.length > 120) continue;
    if (/[.!?۔؟]$/.test(line)) continue;
    return line;
  }
  return "";
}

/**
 * Pick the best available title: embedded document metadata first, then a
 * leading heading, then the file name (always non-empty).
 */
export function guessTitle(options: {
  fileName: string;
  embeddedTitle?: string | null;
  text?: string;
}): string {
  const embedded = (options.embeddedTitle ?? "").trim();
  // Producers often leave junk like "Microsoft Word - file.doc" behind.
  if (embedded && embedded.length <= 120 && !/^(untitled|microsoft word -|document\d*)$/i.test(embedded)) {
    return embedded;
  }
  const heading = options.text ? headingFromText(options.text) : "";
  if (heading) return heading;
  return titleFromFileName(options.fileName);
}
