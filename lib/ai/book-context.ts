/**
 * Getting the text an AI request is about.
 *
 * On the desktop the whole book is already in memory, so "ask about the whole
 * book" costs nothing. On the web it is a real download, and this library runs
 * on a 5 GB/month egress allowance — so this module exists to make that
 * download cheap, visible, interruptible, and reusable.
 *
 * Two things make it cheap:
 *
 *   - Pages the reader has already scrolled through are taken from memory.
 *   - Everything else is fetched in FIXED, ALIGNED page ranges, which means the
 *     URLs are the same every time. The service worker keeps public book-page
 *     reads (lib/pwa, public/sw.js), so asking about the same book a second
 *     time — in this session or next week — costs no egress at all. Unaligned
 *     ranges would produce a new URL each time and defeat that entirely.
 */

import { fetchPages, type BookPage } from "@/lib/reader/pages";
import { MAX_CONTEXT_CHARS } from "@/lib/ai/prompts";

/**
 * Pages per request. Small enough that a reader on a slow connection sees
 * progress move, large enough that a 600-page book is ~25 requests. Changing
 * it invalidates every cached range, so it is not a knob to fiddle with.
 */
export const PAGE_BATCH = 25;

export type AiScope = "selection" | "page" | "all";

export type BookContext = {
  text: string;
  /** Characters before any truncation, so the reader is told the real size. */
  chars: number;
  /** True when the book is larger than one request may carry. */
  truncated: boolean;
};

/** The aligned range that contains a page: 1–25, 26–50, … */
export function batchRangeFor(pageNo: number): { from: number; to: number } {
  const index = Math.floor((pageNo - 1) / PAGE_BATCH);
  return { from: index * PAGE_BATCH + 1, to: (index + 1) * PAGE_BATCH };
}

/** Every aligned range needed to cover 1…pageCount. */
export function batchesFor(pageCount: number): { from: number; to: number }[] {
  const batches: { from: number; to: number }[] = [];
  for (let start = 1; start <= pageCount; start += PAGE_BATCH) {
    batches.push({ from: start, to: Math.min(start + PAGE_BATCH - 1, pageCount) });
  }
  return batches;
}

/**
 * Join pages into one blob the way the reader sees them: a page number, then
 * the page. The numbers are not decoration — an answer about a 600-page book
 * is worth much more when the model can say which page a passage came from.
 */
export function joinPages(pages: readonly BookPage[]): string {
  return pages
    .slice()
    .sort((a, b) => a.page_no - b.page_no)
    .map((page) => `[${page.page_no}-بەت]\n${page.content}`)
    .join("\n\n");
}

/** Apply the one-request ceiling, reporting honestly when it bites. */
export function capContext(text: string): BookContext {
  const chars = text.length;
  return chars > MAX_CONTEXT_CHARS
    ? { text: text.slice(0, MAX_CONTEXT_CHARS), chars, truncated: true }
    : { text, chars, truncated: false };
}

/**
 * The whole book, assembled from what is already in memory plus whatever has
 * to be fetched.
 *
 * Batches run one at a time on purpose: four in flight would finish sooner but
 * would also make the progress line jump around, and — on the connections this
 * library is actually read on — would compete with the reader's own page loads.
 * Aborting stops before the next batch and throws, so a reader who changes
 * their mind is not left waiting for a download they cancelled.
 */
export async function fetchWholeBook(options: {
  bookId: number;
  pageCount: number;
  published: boolean;
  /** Pages the reader has already loaded; taken from memory, never refetched. */
  known: readonly BookPage[];
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
}): Promise<BookContext> {
  const { bookId, pageCount, published, known, signal, onProgress } = options;
  const byPage = new Map<number, BookPage>();
  for (const page of known) byPage.set(page.page_no, page);

  const batches = batchesFor(pageCount);
  // A batch every one of whose pages is already in memory is skipped whole.
  const missing = batches.filter((batch) => {
    for (let page = batch.from; page <= batch.to; page += 1) {
      if (!byPage.has(page)) return true;
    }
    return false;
  });

  onProgress(batches.length - missing.length, batches.length);

  for (const [index, batch] of missing.entries()) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const fetched = await fetchPages(bookId, batch.from, batch.to, published);
    for (const page of fetched) byPage.set(page.page_no, page);
    onProgress(batches.length - missing.length + index + 1, batches.length);
  }

  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  return capContext(joinPages([...byPage.values()]));
}

/**
 * What the reader has selected inside the book text, or "" for nothing usable.
 *
 * Three characters is the desktop's floor and a good one: a stray tap that
 * selects a single letter should not arm an AI request. The 12,000-character
 * cap is the desktop's too — a "selection" longer than that is really a page.
 */
export function readSelection(container: HTMLElement | null): string {
  try {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return "";
    if (!container || !container.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      return "";
    }
    const text = selection.toString().trim();
    return text.length >= 3 ? text.slice(0, 12000) : "";
  } catch {
    return "";
  }
}

/** «12,480 ھەرپ · ~24 KB» — what a request costs, before it is sent. */
export function describeSize(chars: number): string {
  const kilobytes = Math.max(1, Math.round((chars * 2) / 1024));
  return `${chars.toLocaleString("en-US")} ھەرپ · ~${kilobytes} KB`;
}
