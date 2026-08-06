/**
 * Split an extracted book into `book_pages` rows.
 *
 * The desktop app stores one big text per book; the web must chunk it
 * (CLAUDE.md) so pages load lazily and search can return snippets.
 *
 * Rules:
 *   - target 2,000–3,000 characters per page
 *   - split on paragraph boundaries; never mid-word or mid-sentence
 *   - no content may be lost or duplicated
 */

export const MIN_PAGE_CHARS = 2000;
export const MAX_PAGE_CHARS = 3000;

/** Normalize line endings and collapse runs of blank lines to one. */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Break an oversized paragraph on sentence boundaries, falling back to word
 * boundaries for a single sentence longer than the maximum. Keeps the
 * terminator attached to its sentence (Latin ., !, ? plus Arabic ۔ ؟ !).
 */
function splitLongParagraph(paragraph: string, max: number): string[] {
  const sentences = paragraph.match(/[^.!?۔؟]+[.!?۔؟]+[\s]*|[^.!?۔؟]+$/g) ?? [paragraph];
  const out: string[] = [];
  let current = "";

  const pushWords = (sentence: string) => {
    // A single sentence longer than `max`: fall back to word boundaries.
    for (const word of sentence.split(/(\s+)/)) {
      if (!word) continue;
      if (current.length + word.length > max && current.trim()) {
        out.push(current.trim());
        current = word.trimStart();
      } else {
        current += word;
      }
    }
  };

  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current.trim()) {
        out.push(current.trim());
        current = "";
      }
      pushWords(sentence);
      continue;
    }
    if (current.length + sentence.length > max && current.trim()) {
      out.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Chunk normalized text into page-sized strings.
 * Returns [] for text that is empty or whitespace only.
 */
export function chunkIntoPages(
  input: string,
  { min = MIN_PAGE_CHARS, max = MAX_PAGE_CHARS }: { min?: number; max?: number } = {},
): string[] {
  const text = normalizeText(input);
  if (!text) return [];

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pages: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) pages.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    // Paragraph bigger than a whole page — break it down on its own.
    if (paragraph.length > max) {
      flush();
      const parts = splitLongParagraph(paragraph, max);
      // All but the last part are full pages; the last may keep filling.
      for (const part of parts.slice(0, -1)) pages.push(part);
      current = parts[parts.length - 1] ?? "";
      continue;
    }

    const candidateLength = current ? current.length + 2 + paragraph.length : paragraph.length;
    if (current && candidateLength > max) {
      flush();
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }

    // Once past the minimum there is no reason to keep growing the page.
    if (current.length >= min) flush();
  }

  flush();
  return pages;
}
