import { describe, expect, it } from "vitest";
import {
  IGNORE_PREFIX,
  MAX_IGNORED_PER_NOTE,
  clearAccountIgnores,
  ignoreKey,
  readIgnored,
  withIgnored,
  writeIgnored,
  type IgnoreStorage,
} from "@/lib/spellcheck/ignore";

/**
 * «بۇ خاتىرىدە سەل قارا» — words accepted in one note only (PROMPT-48).
 * Every word is invented test text.
 */

class MemoryStorage implements IgnoreStorage {
  private map = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()].sort();
  }
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("words ignored in one note", () => {
  it("are kept per account and per note, and nowhere else", () => {
    const storage = new MemoryStorage();
    writeIgnored(storage, USER, 7, ["ئۇيغور"]);

    expect(readIgnored(storage, USER, 7)).toEqual(["ئۇيغور"]);
    // Another note of the same writer, and the same note id of someone else.
    expect(readIgnored(storage, USER, 8)).toEqual([]);
    expect(readIgnored(storage, OTHER, 7)).toEqual([]);
    expect(storage.keys()).toEqual([`${IGNORE_PREFIX}${USER}:7`]);
    expect(ignoreKey(USER, 7)).toBe(`bh-spell-ignore:${USER}:7`);
  });

  it("adds a word once, and refuses anything that is not one word", () => {
    expect(withIgnored([], "ئۇيغور")).toEqual(["ئۇيغور"]);
    expect(withIgnored(["ئۇيغور"], "ئۇيغور")).toEqual(["ئۇيغور"]);
    for (const word of ["", "ئۇيغور سۆز", "<b>سۆز</b>", "abc", "ئۇيغور\nكىشىلەر"]) {
      expect(withIgnored([], word), JSON.stringify(word)).toBeNull();
    }
  });

  it("holds at most 500 words a note", () => {
    const full = Array.from({ length: MAX_IGNORED_PER_NOTE }, (_, index) => `سۆز${"ا".repeat(index % 50)}${"ب".repeat(Math.floor(index / 50))}`);
    expect(new Set(full).size).toBe(MAX_IGNORED_PER_NOTE);
    expect(withIgnored(full, "يېڭىسۆز")).toBeNull();
    // A word already there is still "there", not refused.
    expect(withIgnored(full, full[3])).toEqual(full);
  });

  it("reads back only words, whatever was stored", () => {
    const storage = new MemoryStorage();
    storage.setItem(ignoreKey(USER, 7), JSON.stringify(["ئۇيغور", 5, "<img src=x>", "ئۇيغور", null, "خەزىنا"]));
    expect(readIgnored(storage, USER, 7)).toEqual(["ئۇيغور", "خەزىنا"]);
    storage.setItem(ignoreKey(USER, 7), '{"ئۇيغور": true}');
    expect(readIgnored(storage, USER, 7)).toEqual([]);
    storage.setItem(ignoreKey(USER, 7), "not json");
    expect(readIgnored(storage, USER, 7)).toEqual([]);
  });

  it("fails soft where the browser refuses storage", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(writeIgnored(storage, USER, 7, ["ئۇيغور"])).toBe(false);
    expect(writeIgnored(null, USER, 7, ["ئۇيغور"])).toBe(false);
    expect(readIgnored(null, USER, 7)).toEqual([]);
  });

  it("go with the account, and only that account's", () => {
    const storage = new MemoryStorage();
    writeIgnored(storage, USER, 7, ["ئۇيغور"]);
    writeIgnored(storage, USER, 9, ["خەزىنا"]);
    writeIgnored(storage, OTHER, 7, ["كىتاۋ"]);
    storage.setItem("bh-personal-dictionary", "[]");

    expect(clearAccountIgnores(storage, USER)).toBe(2);
    expect(storage.keys()).toEqual(["bh-personal-dictionary", ignoreKey(OTHER, 7)].sort());
  });
});
