import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Migration 0029 (PROMPT-41): a phrase whose words share more pages than
 * search_books opens answers `partial`, and when nothing turned up in the
 * part searched it sends one row with no book that carries the flags. That
 * row is never a result — not on /search, not in the notebook's library panel
 * — and the flags reach both.
 */

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.18.7.7" }),
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "reader-1" } }, error: null }) },
    rpc: async () => ({ data: state.rows, error: null }),
  }),
}));

import { runBookSearch } from "@/lib/search/books";
import { searchLibraryForNoteAction } from "@/app/notes/source-actions";
import { resetRateLimits } from "@/lib/rate-limit";

const page = (bookId: number, pageNo: number, flags: { capped: boolean; partial?: boolean }) => ({
  book_id: bookId,
  title: "سىناق كىتابى",
  author: "سىناق",
  cover_path: null,
  page_no: pageNo,
  snippet: "پەيغەمبەر ئاللاھ",
  rank: 0.1,
  ...flags,
});

/** 0029's row for "only part searched, nothing there". */
const FLAGS_ONLY = {
  book_id: null,
  title: null,
  author: null,
  cover_path: null,
  page_no: null,
  snippet: null,
  rank: null,
  capped: false,
  partial: true,
};

beforeEach(() => {
  resetRateLimits();
  state.rows = [];
});

describe("runBookSearch", () => {
  it("never shows the flags-only row as a result, and reports partial", async () => {
    state.rows = [FLAGS_ONLY];
    const outcome = await runBookSearch({ query: "پەيغەمبەر ئاللاھ", categoryId: null, limit: 20, offset: 0 });
    expect(outcome.hits).toEqual([]);
    expect(outcome.partial).toBe(true);
    expect(outcome.tooCommon).toBe(false);
    expect(outcome.moreAvailable).toBe(false);
    expect(outcome.failed).toBe(false);
  });

  it("passes partial through with whatever the part searched found", async () => {
    state.rows = [page(7, 12, { capped: false, partial: true })];
    const outcome = await runBookSearch({ query: "پەيغەمبەر ئاللاھ", categoryId: null, limit: 20, offset: 0 });
    expect(outcome.hits).toHaveLength(1);
    expect(outcome.partial).toBe(true);
  });

  it("reads an answer from before 0029, which has no partial column, as not partial", async () => {
    state.rows = Array.from({ length: 21 }, (_, index) => page(1, index + 1, { capped: true }));
    const outcome = await runBookSearch({ query: "ئاللاھ", categoryId: null, limit: 20, offset: 0 });
    expect(outcome.hits).toHaveLength(20);
    expect(outcome.moreAvailable).toBe(true);
    expect(outcome.tooCommon).toBe(true);
    expect(outcome.partial).toBe(false);
  });
});

describe("the notebook's library panel", () => {
  it("gets the flags, and no result made of the flags-only row", async () => {
    state.rows = [FLAGS_ONLY];
    const result = await searchLibraryForNoteAction({ query: "پەيغەمبەر ئاللاھ" });
    expect(result).toEqual({ ok: true, hits: [], tooCommon: false, partial: true });
  });
});
