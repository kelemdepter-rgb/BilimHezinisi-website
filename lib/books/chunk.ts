/**
 * Split an extracted book into `book_pages` rows.
 *
 * The desktop app stores one big text per book; the web must chunk it
 * (CLAUDE.md) so pages load lazily and search can return snippets.
 *
 * Rules:
 *   - target 2,000–3,000 characters per page
 *   - split on paragraph boundaries; never mid-word or mid-sentence
 *   - never split a Markdown block: a table, a fenced code block, or a heading
 *     and the paragraph it introduces must stay on the same page
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

const FENCE = /^[ \t]{0,3}(```|~~~)/;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+\S/;
/** A table needs a delimiter row, so a block is a table if any line looks like one. */
const TABLE_DELIMITER = /^[ \t]{0,3}\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/m;

/** A block that must never be broken across pages. */
function isAtomic(block: string): boolean {
  return FENCE.test(block) || TABLE_DELIMITER.test(block);
}

/** A heading must stay with whatever follows it. */
function isHeading(block: string): boolean {
  return HEADING.test(block);
}

/**
 * Split the source into blocks, keeping fenced code together even when it
 * contains blank lines (a naive paragraph split would tear it apart).
 */
function toBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const joined = current.join("\n").trim();
    if (joined) blocks.push(joined);
    current = [];
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      current.push(line);
      if (fenceMatch && line.trim().startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
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

  const blocks = toBlocks(text);
  const pages: string[] = [];
  let current = "";
  // Set while the previous block was a heading, so it is never left stranded
  // at the foot of a page away from the text it introduces.
  let holdForHeading = false;

  const flush = () => {
    if (current.trim()) pages.push(current.trim());
    current = "";
  };

  for (const block of blocks) {
    const atomic = isAtomic(block);

    // Oversized ordinary paragraph: break it down on its own.
    if (!atomic && block.length > max) {
      if (!holdForHeading) flush();
      const parts = splitLongParagraph(block, max);
      const [first, ...rest] = parts;
      current = current ? `${current}\n\n${first}` : first;
      flush();
      for (const part of rest.slice(0, -1)) pages.push(part);
      current = rest.length > 0 ? rest[rest.length - 1] : "";
      holdForHeading = false;
      continue;
    }

    const candidateLength = current ? current.length + 2 + block.length : block.length;
    // An atomic block that cannot fit anywhere still gets its own page rather
    // than being torn in half.
    if (current && candidateLength > max && !holdForHeading) {
      flush();
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }

    holdForHeading = isHeading(block);
    // Once past the minimum there is no reason to keep growing the page —
    // unless the page would end on a heading.
    if (current.length >= min && !holdForHeading) flush();
  }

  flush();
  return pages;
}
