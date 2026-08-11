"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findMatches } from "@/lib/reader/highlight";

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
  /** True when the book holds more than the cap; the list is the first slice. */
  truncated: boolean;
  failed: boolean;
};

/** The desktop's own ceiling for this list, and its context width. */
const MAX_MATCHES = 200;
const CONTEXT_CHARS = 70;
/** Pages scanned for offsets. One book, so this stays small. */
const MAX_PAGES = 120;

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
 * Scoped to a single book, so it stays cheap no matter how large the library
 * grows; RLS means an unpublished book yields nothing to a reader.
 */
export async function listBookMatchesAction(input: {
  bookId: number;
  query: string;
}): Promise<BookMatchList> {
  const empty: BookMatchList = { matches: [], truncated: false, failed: false };
  const term = input.query.trim().slice(0, 200);
  const bookId = Math.floor(Number(input.bookId));
  if (!term || !Number.isInteger(bookId) || bookId <= 0) return empty;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return empty;

  // Narrow to the pages that carry the term before pulling any text. The
  // escape keeps a literal % or _ in a query from turning into a wildcard.
  const escaped = term.replace(/[%_\\]/g, (char) => `\\${char}`);
  const { data, error } = await supabase
    .from("book_pages")
    .select("page_no, content")
    .eq("book_id", bookId)
    .ilike("content", `%${escaped}%`)
    .order("page_no", { ascending: true })
    .limit(MAX_PAGES);

  if (error) return { ...empty, failed: true };

  const matches: BookMatch[] = [];
  let truncated = false;

  for (const page of (data as { page_no: number; content: string }[] | null) ?? []) {
    // findMatches normalizes per character, so the offsets it returns point at
    // the real text even where it carries Arabic diacritics.
    const found = findMatches(page.content, term);
    for (const [matchIndex, hit] of found.entries()) {
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      matches.push({
        pageNo: page.page_no,
        matchIndex,
        ...contextAround(page.content, hit.start, hit.end),
      });
    }
    if (truncated) break;
  }

  return { matches, truncated, failed: false };
}
