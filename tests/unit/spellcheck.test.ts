import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeWord,
  editDistance,
  editsOnce,
  encodeWord,
  frequencyOf,
  hasWord,
  isCheckable,
  normalizeForLookup,
  tokenize,
  unpackDictionary,
  wordAt,
  type PackedDictionary,
} from "@/lib/spellcheck/dictionary";
import { isCorrect, suggest } from "@/lib/spellcheck/check";
import { accepts, harmonyOf, nearestSuffixes, splits } from "@/lib/spellcheck/morphology";
import { weightedDistance } from "@/lib/spellcheck/rank";
import { substitutionCost } from "@/lib/spellcheck/confusion";
import { fetchCached, fetchCachedBytes } from "@/lib/spellcheck/fetch-cached";

const asset = (name: string) =>
  fileURLToPath(new URL(`../../public/spellcheck/${name}`, import.meta.url));

/** The real shipped artifacts — a synthetic dictionary would prove nothing. */
const raw = readFileSync(asset("uyghur-dict.bin"));
const corrections = new Map<string, string>(
  Object.entries(JSON.parse(readFileSync(asset("corrections.json"), "utf8")) as Record<string, string>),
);

let dictionary: PackedDictionary;
beforeAll(() => {
  dictionary = unpackDictionary(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
  );
});

describe("packed dictionary", () => {
  it("unpacks the whole artifact", () => {
    expect(dictionary.size).toBe(443_039);
    expect(dictionary.flags).not.toBeNull();
  });

  it("stays sorted, which is what makes the binary search legal", () => {
    // Byte codes are assigned in code-point order, so the packed order and
    // JavaScript's string order are the same — that equivalence is the whole
    // reason the search survived the encoding change, so it is asserted.
    for (let index = 1; index < dictionary.size; index += 997) {
      expect(wordAt(dictionary, index - 1) < wordAt(dictionary, index)).toBe(true);
    }
  });

  it("round-trips every character of the alphabet", () => {
    for (const word of ["كىتاب", "ئوقۇغۇچى", "خەزىنە", "قالدۇر", "ژۇرنال", "ئاق-قاش"]) {
      const codes = encodeWord(word);
      expect(codes, word).not.toBeNull();
      expect(decodeWord(codes!, 0, codes!.length)).toBe(word);
    }
  });

  it("refuses to encode a character the dictionary cannot hold", () => {
    // An apostrophe passes isCheckable but is in no dictionary word; it must
    // come back as "absent", never as a silently mangled lookup.
    expect(encodeWord("ئا'لا")).toBeNull();
    expect(hasWord(dictionary, "ئا'لا")).toBe(false);
  });

  it("finds ordinary words and rejects ones that were never in it", () => {
    for (const word of ["قانداق", "كېرەك", "يۈرەك", "كىتاب", "ئۇيغۇر", "مەكتەپ", "خەزىنە"]) {
      expect(isCorrect(dictionary, word), word).toBe(true);
    }
    for (const word of ["كانداق", "يۇراك", "كىتپ", "ياخشش"]) {
      expect(isCorrect(dictionary, word), word).toBe(false);
    }
  });

  it("carries how often the library uses a word", () => {
    // Common words outrank rare ones; the bucket is log2 of the count.
    expect(frequencyOf(dictionary, "كىتاب")).toBeGreaterThan(0);
    expect(frequencyOf(dictionary, "ژۇرنال")).toBe(0);
  });

  it("accepts a personal word without touching the artifact", () => {
    expect(isCorrect(dictionary, "ياخشش")).toBe(false);
    expect(isCorrect(dictionary, "ياخشش", new Set(["ياخشش"]))).toBe(true);
  });

  it("accepts a hyphen compound when both halves are real words", () => {
    expect(isCorrect(dictionary, "كىتاب-ئۇيغۇر")).toBe(true);
    expect(isCorrect(dictionary, "كىتاب-ياخشش")).toBe(false);
  });
});

describe("what gets checked at all", () => {
  it("leaves numbers, Latin and short fragments alone", () => {
    for (const word of ["12", "hello", "ا", ""]) expect(isCheckable(word)).toBe(false);
  });

  it("strips tatweel before looking anything up", () => {
    expect(normalizeForLookup("كىــتاب")).toBe("كىتاب");
    expect(isCorrect(dictionary, "كىــتاب")).toBe(true);
  });

  it("finds the words in a sentence with their positions", () => {
    const text = "بۇ كىتاب ياخشى.";
    const tokens = tokenize(text);
    expect(tokens.map((token) => token.word)).toEqual(["بۇ", "كىتاب", "ياخشى"]);
    expect(text.slice(tokens[1].start, tokens[1].end)).toBe("كىتاب");
  });
});

describe("morphology", () => {
  it("reads harmony off the last committed vowel, treating ى as neutral", () => {
    expect(harmonyOf("قالدۇر")).toBe("back");
    expect(harmonyOf("تەۋە")).toBe("front");
    // ى is skipped rather than counted, so the ۇ before it still decides.
    expect(harmonyOf("ئوقۇغۇچى")).toBe("back");
  });

  it("accepts an unlisted word that is a real inflection of a known stem", () => {
    // The case that started this: correct Uyghur, absent from the word list,
    // and red-underlined by UyghurEdit++ to this day.
    expect(hasWord(dictionary, "تەۋەلەنگەن")).toBe(false);
    expect(isCorrect(dictionary, "تەۋەلەنگەن")).toBe(true);
  });

  it("still refuses a suffix the stem cannot take", () => {
    // «ئالغاندا» is right and «ئالغانتا» is not: Uyghur picks the suffix shape
    // from the sound the stem ends in, and the boundary table knows it.
    expect(isCorrect(dictionary, "ئالغاندا")).toBe(true);
    expect(isCorrect(dictionary, "ئالغانتا")).toBe(false);
  });

  it("takes a word apart at a suffix so the stem can be corrected", () => {
    const parts = splits(dictionary, "قالدورمىغۇدەك");
    expect(parts.some((part) => part.stem === "قالدور" && part.suffix === "مىغۇدەك")).toBe(true);
  });

  it("finds the nearest real suffix to a misspelled one", () => {
    expect(nearestSuffixes("لىنگەن")).toContain("لەنگەن");
  });

  it("does not accept a word whose stem is not one we know", () => {
    expect(accepts(dictionary, "ققققققنىڭ")).toBe(false);
  });
});

describe("ranking", () => {
  it("prices a known confusion below an arbitrary substitution", () => {
    // ا↔ە is the second most common vowel error in the corrections data;
    // ت↔ژ has never been observed once.
    expect(substitutionCost("ا", "ە")).toBeLessThan(substitutionCost("ت", "ژ"));
    expect(substitutionCost("ا", "ا")).toBe(0);
  });

  it("never lets a cheap pair make two edits look nearer than one", () => {
    // The floor on substitution cost exists exactly for this.
    const twoCheap = weightedDistance("اا", "ەە");
    const oneArbitrary = weightedDistance("ات", "اژ");
    expect(twoCheap).toBeGreaterThan(oneArbitrary);
  });

  it("orders by what people write, not alphabetically", () => {
    // Both are one edit away; the corpus decides, and the alphabet does not.
    const list = suggest(dictionary, "ياخشا", { corrections });
    expect(list[0]).toBe("ياخشى");
  });
});

describe("suggestions", () => {
  const ask = (word: string) => suggest(dictionary, word, { corrections });

  it("puts the hand-built correction first for mistakes people actually make", () => {
    expect(ask("كانداق")[0]).toBe("قانداق");
    expect(ask("يۇراك")[0]).toBe("يۈرەك");
    expect(ask("كەراك")[0]).toBe("كېرەك");
    expect(ask("كالدىم")[0]).toBe("كەلدىم");
  });

  it("recovers a word that is one edit away, with no table entry", () => {
    expect(corrections.has("ئۇيغور")).toBe(false);
    expect(ask("ئۇيغور")).toContain("ئۇيغۇر");
    expect(ask("خەزىنا")).toContain("خەزىنە");
    expect(ask("ئوقۇغوچى")).toContain("ئوقۇغۇچى");
    expect(ask("كتاب")).toContain("كىتاب");
    expect(ask("كىتاۋ")).toContain("كىتاب");
  });

  it("recovers a transposition", () => {
    expect(ask("كىابت")).toContain("كىتاب");
  });

  it("corrects a misspelled stem and puts the suffix back", () => {
    expect(ask("قالدورمىغۇدەك")[0]).toBe("قالدۇرمىغۇدەك");
  });

  it("corrects a misspelled suffix and leaves the stem alone", () => {
    expect(ask("تەۋەلىنگەن")[0]).toBe("تەۋەلەنگەن");
  });

  it("returns nothing rather than noise for a word with no near neighbour", () => {
    expect(ask("ققققققققققق")).toEqual([]);
  });

  it("caps the list so the popup cannot be flooded", () => {
    expect(ask("ياخشا").length).toBeLessThanOrEqual(10);
  });

  it("answers a typo fast enough to feel instant", () => {
    const started = performance.now();
    ask("ئۇيغور");
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("edit machinery", () => {
  it("generates deletions, transpositions, substitutions and insertions", () => {
    const once = editsOnce("ات", "اتب");
    expect(once.has("ا")).toBe(true);
    expect(once.has("تا")).toBe(true);
    expect(once.has("اب")).toBe(true);
    expect(once.has("اتب")).toBe(true);
    expect(once.has("ات")).toBe(false);
  });

  it("measures distance over code points, and gives up past the budget", () => {
    expect(editDistance("كىتاب", "كىتاب", 2)).toBe(0);
    expect(editDistance("كىتاب", "كىتپ", 2)).toBeGreaterThan(0);
    expect(editDistance("كىتاب", "ئوقۇغۇچى", 2)).toBe(-1);
  });
});

/**
 * The loader's cold path: nothing cached, so it must go to the network AND put
 * a copy away for next time. Then the warm path, which must not touch fetch.
 */
describe("dictionary loader", () => {
  const CACHE = "test-cache";

  function installCaches() {
    const store = new Map<string, string>();
    const cache = {
      match: async (url: string) => (store.has(url) ? new Response(store.get(url)) : undefined),
      put: async (url: string, response: Response) => {
        store.set(url, await response.text());
      },
    };
    (globalThis as { caches?: unknown }).caches = { open: async () => cache };
    return store;
  }

  it("fetches from the network on a cold cache and keeps a copy", async () => {
    const store = installCaches();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("ھەرپ");
    }) as typeof fetch;

    const cold = await fetchCached("/d.txt", CACHE);
    expect(cold).toEqual({ text: "ھەرپ", fromCache: false });
    expect(calls).toBe(1);
    expect(store.get("/d.txt")).toBe("ھەرپ");

    const warm = await fetchCached("/d.txt", CACHE);
    expect(warm).toEqual({ text: "ھەرپ", fromCache: true });
    expect(calls).toBe(1);
  });

  it("reads the dictionary as bytes, not as text", async () => {
    installCaches();
    // Byte 0xFF is not valid UTF-8; reading this as text would replace it and
    // destroy the word it belongs to, which is exactly the bug to prevent.
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 0xff]))) as typeof fetch;
    const { bytes } = await fetchCachedBytes("/d.bin", CACHE);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 0xff]));
  });

  it("still loads when the browser refuses Cache Storage", async () => {
    (globalThis as { caches?: unknown }).caches = {
      open: async () => {
        throw new Error("denied in private mode");
      },
    };
    globalThis.fetch = (async () => new Response("ھەرپ")) as typeof fetch;

    await expect(fetchCached("/d.txt", CACHE)).resolves.toEqual({
      text: "ھەرپ",
      fromCache: false,
    });
  });

  it("reports a missing artifact instead of pretending it loaded", async () => {
    installCaches();
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    await expect(fetchCached("/d.txt", CACHE)).rejects.toThrow("404");
  });
});
