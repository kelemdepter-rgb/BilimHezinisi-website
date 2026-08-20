import { SW_VERSION } from "@/lib/pwa/constants";
import { createSupabasePublicClient } from "@/lib/supabase/public-client";
import type { ContentFormat } from "@/lib/books/types";

/**
 * Collecting a whole book in the browser, cheaply.
 *
 * Reading every page of a book is the most expensive thing an anonymous
 * visitor can ask this library to do, and the free plan allows 5 GB of egress
 * a month. Three things keep that in check, in order:
 *
 *   1. /api/books/[id]/download says yes or no first — published only, and
 *      rate limited per address.
 *   2. Pages already stored for offline reading are taken from the cache and
 *      never asked for again.
 *   3. What is left is fetched in large batches through the public client, so
 *      a long book costs a handful of requests rather than one per page.
 *
 * The reader can stop it at any point, which matters on a phone: a five
 * hundred page book on a slow connection is a real wait, and cancelling has
 * to actually cancel rather than run to completion in the background.
 */

/** Pages per request. Big enough to be few requests, small enough to stream. */
const BATCH = 100;

const TEXT_CACHE = `bh-sw-text-${SW_VERSION}`;

export type DownloadManifest = {
  title: string;
  author: string;
  pageCount: number;
  contentFormat: ContentFormat;
};

export class DownloadError extends Error {}

/**
 * Ask permission and collect the book's own metadata in the same round trip.
 * Throws with the server's Uyghur message when it says no.
 */
export async function requestDownload(bookId: number, signal?: AbortSignal): Promise<DownloadManifest> {
  const response = await fetch(`/api/books/${bookId}/download`, { signal, cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  const detail = (body ?? {}) as { ok?: boolean; message?: string; pageCount?: number };

  if (!response.ok || detail.ok !== true) {
    throw new DownloadError(detail.message ?? "كىتابنى چۈشۈرگىلى بولمىدى. سەل تۇرۇپ قايتا سىناڭ.");
  }
  return {
    title: String((body as { title?: unknown }).title ?? ""),
    author: String((body as { author?: unknown }).author ?? ""),
    pageCount: Number(detail.pageCount) || 0,
    contentFormat:
      (body as { contentFormat?: unknown }).contentFormat === "markdown" ? "markdown" : "text",
  };
}

type PageRow = { page_no: number; content: string };

/**
 * Pages of this book the service worker has already stored.
 *
 * The cache holds whole PostgREST responses keyed by their URL, and the URL
 * carries the book and the page range — so the entries belonging to one book
 * can be picked out without a network request. This is what makes downloading
 * a book you have just read nearly free.
 */
async function cachedPages(bookId: number): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  if (typeof caches === "undefined") return found;
  try {
    const cache = await caches.open(TEXT_CACHE);
    const keys = await cache.keys();
    for (const key of keys) {
      const url = new URL(key.url);
      if (!url.pathname.endsWith("/book_pages")) continue;
      if (url.searchParams.get("book_id") !== `eq.${bookId}`) continue;
      const hit = await cache.match(key);
      if (!hit) continue;
      const rows: unknown = await hit.json().catch(() => null);
      if (!Array.isArray(rows)) continue;
      for (const row of rows as PageRow[]) {
        if (typeof row?.page_no === "number" && typeof row?.content === "string") {
          found.set(row.page_no, row.content);
        }
      }
    }
  } catch {
    // No Cache Storage, or an entry that is no longer JSON. Everything is
    // simply fetched instead — slower, never wrong.
  }
  return found;
}

/** Contiguous [from, to] runs of the page numbers still missing. */
function gapsIn(have: Map<number, string>, pageCount: number): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  let start: number | null = null;
  for (let page = 1; page <= pageCount; page += 1) {
    const missing = !have.has(page);
    if (missing && start === null) start = page;
    if ((!missing || page === pageCount) && start !== null) {
      gaps.push([start, missing ? page : page - 1]);
      start = null;
    }
  }
  return gaps;
}

export type DownloadProgress = { done: number; total: number };

/**
 * Every page of the book, in order, as strings.
 *
 * `onProgress` is called often enough to move a bar; `signal` aborts between
 * and during batches.
 */
export async function collectBookPages(
  bookId: number,
  pageCount: number,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void } = {},
): Promise<string[]> {
  const pages = await cachedPages(bookId);
  onProgress?.({ done: Math.min(pages.size, pageCount), total: pageCount });

  const supabase = createSupabasePublicClient();
  for (const [gapFrom, gapTo] of gapsIn(pages, pageCount)) {
    for (let from = gapFrom; from <= gapTo; from += BATCH) {
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
      const to = Math.min(from + BATCH - 1, gapTo);
      let query = supabase
        .from("book_pages")
        .select("page_no, content")
        .eq("book_id", bookId)
        .gte("page_no", from)
        .lte("page_no", to)
        .order("page_no", { ascending: true });
      if (signal) query = query.abortSignal(signal);

      const { data, error } = await query;
      if (error) throw new DownloadError("بەتلەرنى ئوقۇغىلى بولمىدى. ئۇلىنىشىڭىزنى تەكشۈرۈڭ.");
      for (const row of (data as PageRow[] | null) ?? []) pages.set(row.page_no, row.content);
      onProgress?.({ done: Math.min(pages.size, pageCount), total: pageCount });
    }
  }

  const ordered: string[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const content = pages.get(page);
    // A gap would be a hole in the book rather than an error: the row is
    // genuinely absent, and skipping it beats writing "undefined" into a file
    // somebody is keeping as their copy.
    if (typeof content === "string") ordered.push(content);
  }
  return ordered;
}
