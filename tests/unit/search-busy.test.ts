import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Too many people are searching right now" (PROMPT-40): the database's
 * answer when every search slot is in use (migration 0028 — HTTP 429,
 * `PT429 bh:search_busy`), and how each caller turns it into a calm Uyghur
 * message instead of an error. And the rule that outranks all of it: what a
 * reader typed never reaches a log line (PROMPT-29).
 */

const state = vi.hoisted(() => ({
  rpc: null as null | ((fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }),
  rpcCalls: [] as string[],
  address: "198.18.0.1",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": state.address }),
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "reader-1" } }, error: null }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(fn);
      return state.rpc!(fn, args);
    },
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
    }),
  }),
}));

import { SEARCH_BUSY_CODE, SEARCH_BUSY_MESSAGE, SEARCH_BUSY_TEXT, isSearchBusy } from "@/lib/search/busy";
import { runBookSearch } from "@/lib/search/books";
import { runQuranSearch } from "@/lib/quran/data";
import { listBookMatchesAction } from "@/app/search-actions";
import { searchLibraryForNoteAction, searchQuranForNoteAction } from "@/app/notes/source-actions";
import { SEARCH_RULE, isRateLimited, resetRateLimits } from "@/lib/rate-limit";

/** The error supabase-js hands back for 0028's refusal. */
const BUSY = { code: "PT429", message: "bh:search_busy", details: "every slot in search pool 1 is in use", hint: null };
const QUERY = "سىرلىق ئىزدەش سۆزى";

let logged: string[] = [];

beforeEach(() => {
  resetRateLimits();
  state.rpcCalls = [];
  state.address = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  logged = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Nothing anyone typed may be in a log line — the words, or any one of them. */
function expectNoQueryInLogs() {
  for (const line of logged) {
    for (const word of QUERY.split(" ")) expect(line).not.toContain(word);
  }
}

describe("isSearchBusy", () => {
  it("recognises 0028's refusal by its SQLSTATE or its message", () => {
    expect(SEARCH_BUSY_CODE).toBe("PT429");
    expect(SEARCH_BUSY_MESSAGE).toBe("bh:search_busy");
    expect(isSearchBusy(BUSY)).toBe(true);
    expect(isSearchBusy({ code: "PT429" })).toBe(true);
    // What the browser's navigator rethrows: an Error carrying the message.
    expect(isSearchBusy(new Error("bh:search_busy"))).toBe(true);
  });

  it("is not fooled by a timeout, another error, or nothing", () => {
    expect(isSearchBusy({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isSearchBusy({ code: "", message: "AbortError: This operation was aborted" })).toBe(false);
    expect(isSearchBusy(null)).toBe(false);
    expect(isSearchBusy(undefined)).toBe(false);
  });

  it("tells the reader calmly, in Uyghur", () => {
    expect(SEARCH_BUSY_TEXT).toBe("ھازىر ئىزدەۋاتقانلار كۆپ. بىر نەچچە سېكۇنتتىن كېيىن قايتا سىناڭ.");
  });
});

describe("runBookSearch", () => {
  it("maps the refusal to `busy` — not a timeout, not an error", async () => {
    state.rpc = () => ({ data: null, error: BUSY });
    const outcome = await runBookSearch({ query: QUERY, categoryId: null, limit: 20, offset: 0 });
    expect(outcome.failed).toBe(true);
    expect(outcome.failure).toBe("busy");
    expect(outcome.hits).toEqual([]);
  });

  it("logs the scope and nothing else", async () => {
    state.rpc = () => ({ data: null, error: BUSY });
    await runBookSearch({ query: QUERY, categoryId: null, limit: 20, offset: 0 });
    await runBookSearch({ query: QUERY, categoryId: 7, limit: 20, offset: 0 });
    expect(logged).toEqual(["[bh] search_books busy (whole library)", "[bh] search_books busy (one category)"]);
    expectNoQueryInLogs();
  });

  it("still tells a timeout and an error apart, and never logs the words for them either", async () => {
    state.rpc = () => ({ data: null, error: { code: "57014", message: `canceling statement: ${QUERY}` } });
    expect((await runBookSearch({ query: QUERY, categoryId: null, limit: 20, offset: 0 })).failure).toBe("timeout");
    state.rpc = () => ({ data: null, error: { code: "XX000", message: `syntax near ${QUERY}` } });
    expect((await runBookSearch({ query: QUERY, categoryId: null, limit: 20, offset: 0 })).failure).toBe("error");
    expectNoQueryInLogs();
  });
});

describe("SEARCH_RULE", () => {
  it("is sixty a minute per address, and the sixty-first is turned away", () => {
    expect(SEARCH_RULE).toEqual({ limit: 60, windowMs: 60_000 });
    for (let i = 0; i < 60; i += 1) expect(isRateLimited("search:198.18.9.9", SEARCH_RULE)).toBe(false);
    expect(isRateLimited("search:198.18.9.9", SEARCH_RULE)).toBe(true);
    // Another address — a reader on another connection — is untouched.
    expect(isRateLimited("search:198.18.9.10", SEARCH_RULE)).toBe(false);
  });
});

describe("the expander (listBookMatchesAction)", () => {
  it("answers busy, not failed, when every navigator slot is in use", async () => {
    state.rpc = () => ({ data: null, error: BUSY });
    const list = await listBookMatchesAction({ bookId: 72, query: QUERY });
    expect(list.busy).toBe(true);
    expect(list.failed).toBe(false);
    expectNoQueryInLogs();
  });

  it("answers busy without asking the database once the address is past SEARCH_RULE", async () => {
    state.rpc = () => ({ data: [], error: null });
    for (let i = 0; i < SEARCH_RULE.limit; i += 1) isRateLimited(`search:${state.address}`, SEARCH_RULE);
    const list = await listBookMatchesAction({ bookId: 72, query: QUERY });
    expect(list.busy).toBe(true);
    expect(state.rpcCalls).toEqual([]);
  });

  it("is an ordinary answer when a slot is free", async () => {
    state.rpc = () => ({ data: [], error: null });
    const list = await listBookMatchesAction({ bookId: 72, query: QUERY });
    expect(list).toMatchObject({ busy: false, failed: false, total: 0 });
  });
});

describe("the Qur'an search", () => {
  it("says busy for the Qur'an pool's refusal", async () => {
    state.rpc = () => ({ data: null, error: BUSY });
    const outcome = await runQuranSearch({ query: QUERY, limit: 20, offset: 0 });
    expect(outcome).toMatchObject({ busy: true, failed: true });
    expect(logged).toEqual(["[bh] search_quran busy"]);
  });
});

describe("the notebook's source panel", () => {
  it("shows its own short busy message for the library and for the Qur'an", async () => {
    state.rpc = () => ({ data: null, error: BUSY });
    expect(await searchLibraryForNoteAction({ query: QUERY })).toEqual({ ok: false, error: SEARCH_BUSY_TEXT });
    expect(await searchQuranForNoteAction({ query: QUERY })).toEqual({ ok: false, error: SEARCH_BUSY_TEXT });
    expectNoQueryInLogs();
  });
});
