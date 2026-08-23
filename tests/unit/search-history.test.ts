// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  clearSearchHistory,
  forgetSearch,
  readSearchHistory,
  rememberSearch,
} from "@/lib/search/history";

/**
 * Search history never leaves the browser, so localStorage IS the feature —
 * what it holds, and what is left behind when a reader asks for it to go.
 */
beforeEach(() => {
  window.localStorage.clear();
});

describe("remembering a search", () => {
  it("keeps what was searched for, newest first", () => {
    rememberSearch("ھەدىس");
    rememberSearch("تارىخ");
    expect(readSearchHistory().map((entry) => entry.query)).toEqual(["تارىخ", "ھەدىس"]);
  });

  it("moves a repeated search back to the top rather than duplicating it", () => {
    rememberSearch("ھەدىس");
    rememberSearch("تارىخ");
    rememberSearch("ھەدىس");
    expect(readSearchHistory().map((entry) => entry.query)).toEqual(["ھەدىس", "تارىخ"]);
  });

  it("trims the query and ignores one that is only whitespace", () => {
    rememberSearch("  ھەدىس  ");
    rememberSearch("   ");
    rememberSearch("");
    expect(readSearchHistory().map((entry) => entry.query)).toEqual(["ھەدىس"]);
  });

  it("keeps only the most recent few", () => {
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) rememberSearch(`ئىزدەش ${index}`);
    const entries = readSearchHistory();
    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0].query).toBe(`ئىزدەش ${HISTORY_LIMIT + 4}`);
  });

  it("records nothing at all for a reader who has never searched", () => {
    expect(readSearchHistory()).toEqual([]);
    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });
});

describe("forgetting", () => {
  it("removes one entry and leaves the rest", () => {
    rememberSearch("ھەدىس");
    rememberSearch("تارىخ");
    expect(forgetSearch("ھەدىس").map((entry) => entry.query)).toEqual(["تارىخ"]);
    expect(readSearchHistory().map((entry) => entry.query)).toEqual(["تارىخ"]);
  });

  it("takes the key away entirely once the last entry goes", () => {
    rememberSearch("ھەدىس");
    forgetSearch("ھەدىس");
    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("clearing leaves nothing behind, not even an empty list", () => {
    rememberSearch("ھەدىس");
    rememberSearch("تارىخ");
    clearSearchHistory();
    expect(readSearchHistory()).toEqual([]);
    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });
});

describe("bad data in storage", () => {
  it("survives a value that is not JSON", () => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, "not json at all");
    expect(readSearchHistory()).toEqual([]);
  });

  it("ignores entries that are not searches", () => {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([{ query: "ھەدىس", at: 2 }, { nope: true }, "string", 7, { query: "", at: 1 }]),
    );
    expect(readSearchHistory().map((entry) => entry.query)).toEqual(["ھەدىس"]);
  });
});
