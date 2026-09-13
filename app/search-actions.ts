"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findOccurrences } from "@/lib/search/occurrences";
import {
  MATCH_PAGE_LIMIT,
  batches,
  listFallsShort,
  matchPagesCapped,
  planMatchList,
  type MatchPage,
} from "@/lib/search/book-matches";

/**
 * One occurrence of the query inside a book, with enough context to read and
 * enough address to jump to. Split into parts rather than marked-up HTML — the
 * client renders it as text, so a book can never inject markup.
 */
export type BookMatch = {
  pageNo: number;
  /** Which occurrence this is WITHIN its page — what the reader steps to. */
  matchIndex: number;
  before: string;
  match: string;
  after: string;
};

export type BookMatchList = {
  matches: BookMatch[];
  /** Every occurrence in the book — the reader's n/total counter for the same phrase. */
  total: number;
  /** True when the book has more matching pages than were counted; `total` is then a floor. */
  capped: boolean;
  /** True when the book holds more than the list: the list is the first slice. */
  truncated: boolean;
  failed: boolean;
};

/** The desktop's own ceiling for this list, and its context width. */
const MAX_MATCHES = 200;
const CONTEXT_CHARS = 70;
/** Page numbers per content request, so the `in` filter stays a short URL. */
const PAGES_PER_REQUEST = 100;

function contextAround(content: string, start: number, end: number) {
  let from = Math.max(0, start - CONTEXT_CHARS);
  let to = Math.min(content.length, end + CONTEXT_CHARS);
  // Cut on whitespace so a snippet never starts mid-word.
  while (from > 0 && !/\s/.test(content[from - 1]) && start - from < CONTEXT_CHARS + 20) from--;
  while (to < content.length && !/\s/.test(content[to]) && to - end < CONTEXT_CHARS + 20) to++;

  const tidy = (value: string) => value.replace(/\s+/g, " ");
  return {
    before: (from > 0 ? "…" : "") + tidy(content.slice(from, start)),
    match: tidy(content.slice(start, end)),
    after: tidy(content.slice(end, to)) + (to < content.length ? "…" : ""),
  };
}

/**
 * Every place the query appears inside ONE book — the web equivalent of the
 * desktop's "+" expander (getAllSnippetsForBook in database.js).
 *
 * Starts from `book_match_pages`, the same answer the reader's ↑ ↓ navigator
 * starts from: the pages that carry the phrase, matched through the full-text
 * index, diacritic- and tatweel-insensitively. Only the pages the list needs
 * are read, and `findOccurrences` — the one matcher — places each occurrence
 * in them. Scoped to a single book, so it stays cheap no matter how large the
 * library grows; the function refuses an unpublished book to a reader.
 */
export async function listBookMatchesAction(input: {
  bookId: number;
  query: string;
}): Promise<BookMatchList> {
  const empty: BookMatchList = {
    matches: [],
    total: 0,
    capped: false,
    truncated: false,
    failed: false,
  };
  const term = input.query.trim().slice(0, 200);
  const bookId = Math.floor(Number(input.bookId));
  if (!term || !Number.isInteger(bookId) || bookId <= 0) return empty;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return empty;

  const { data: found, error } = await supabase.rpc("book_match_pages", {
    book_id: bookId,
    q: term,
    lim: MATCH_PAGE_LIMIT,
  });
  if (error) return { ...empty, failed: true };

  const pages = ((found as MatchPage[] | null) ?? []).filter((page) => page.hits > 0);
  const capped = matchPagesCapped(pages);
  const { pageNos, total } = planMatchList(pages, MAX_MATCHES);

  const contents = new Map<number, string>();
  const fetched = await Promise.all(
    batches(pageNos, PAGES_PER_REQUEST).map((batch) =>
      supabase
        .from("book_pages")
        .select("page_no, content")
        .eq("book_id", bookId)
        .in("page_no", batch),
    ),
  );
  for (const { data, error: pageError } of fetched) {
    if (pageError) return { ...empty, failed: true };
    for (const page of (data as { page_no: number; content: string }[] | null) ?? []) {
      contents.set(page.page_no, page.content);
    }
  }

  const matches: BookMatch[] = [];
  for (const pageNo of pageNos) {
    const content = contents.get(pageNo);
    if (content === undefined) continue;
    // findOccurrences normalizes per character, so the offsets it returns point
    // at the real text even where it carries Arabic diacritics or tatweel.
    for (const [matchIndex, hit] of findOccurrences(content, term).entries()) {
      if (matches.length >= MAX_MATCHES) break;
      matches.push({ pageNo, matchIndex, ...contextAround(content, hit.start, hit.end) });
    }
    if (matches.length >= MAX_MATCHES) break;
  }

  return {
    matches,
    total,
    capped,
    truncated: listFallsShort(total, matches.length, capped),
    failed: false,
  };
}
