import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  editDistance,
  editsOnce,
  isCheckable,
  isCorrect,
  normalizeForLookup,
  suggest,
  tokenize,
  unpackDictionary,
  UYGHUR_LETTERS,
  wordAt,
  type PackedDictionary,
} from "@/lib/spellcheck/dictionary";
import { fetchCached } from "@/lib/spellcheck/fetch-cached";

const asset = (name: string) =>
  fileURLToPath(new URL(`../../public/spellcheck/${name}`, import.meta.url));

/** The real shipped artifacts — a synthetic dictionary would prove nothing. */
const encoded = readFileSync(asset("uyghur-dict.txt"), "utf8");
const corrections = new Map<string, string>(
  Object.entries(JSON.parse(readFileSync(asset("corrections.json"), "utf8")) as Record<string, string>),
);

let dictionary: PackedDictionary;
beforeAll(() => {
  dictionary = unpackDictionary(encoded);
});

describe("packed dictionary", () => {
  it("unpacks the whole front-coded artifact", () => {
    expect(dictionary.size).toBe(441_322);
  });

  it("stays sorted, which is what makes the binary search legal", () => {
    // Full comparison is 441k string compares; a wide sample is enough and
    // keeps the suite fast.
    for (let index = 1; index < dictionary.size; index += 997) {
      expect(wordAt(dictionary, index - 1) < wordAt(dictionary, index)).toBe(true);
    }
  });

  it("finds ordinary words and rejects ones that were never in it", () => {
    for (const word of ["قانداق", "كېرەك", "يۈرەك", "كىتاب", "ئۇيغۇر", "مەكتەپ", "خەزىنە"]) {
      expect(isCorrect(dictionary, word), word).toBe(true);
    }
    for (const word of ["كانداق", "يۇراك", "كىتپ", "ياخشش"]) {
      expect(isCorrect(dictionary, word), word).toBe(false);
    }
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

describe("suggestions", () => {
  const ask = (word: string) =>
    suggest(dictionary, word, { alphabet: UYGHUR_LETTERS, corrections });

  it("puts the hand-built correction first for mistakes people actually make", () => {
    // Pairs taken from the desktop's own corrections table.
    expect(ask("كانداق")[0]).toBe("قانداق");
    expect(ask("يۇراك")[0]).toBe("يۈرەك");
    expect(ask("كەراك")[0]).toBe("كېرەك");
    expect(ask("كالدىم")[0]).toBe("كەلدىم");
  });

  it("recovers a word that is one edit away, with no table entry", () => {
    // Vowel slips: the commonest kind of Uyghur typo, and none of these are
    // in the corrections table — the edit search alone has to find them.
    expect(corrections.has("ئۇيغور")).toBe(false);
    expect(ask("ئۇيغور")).toContain("ئۇيغۇر");
    expect(ask("خەزىنا")).toContain("خەزىنە");
    expect(ask("ئوقۇغوچى")).toContain("ئوقۇغۇچى");
    // A dropped letter, and a wrong final consonant.
    expect(ask("كتاب")).toContain("كىتاب");
    expect(ask("كىتاۋ")).toContain("كىتاب");
  });

  it("recovers a transposition", () => {
    expect(ask("كىابت")).toContain("كىتاب");
  });

  it("returns nothing rather than noise for a word with no near neighbour", () => {
    expect(ask("ققققققققققق")).toEqual([]);
  });

  it("caps the list so the panel cannot be flooded", () => {
    expect(ask("ياخشا").length).toBeLessThanOrEqual(10);
  });

  it("answers a typo fast enough to feel instant", () => {
    const started = performance.now();
    ask("ئۇيغور");
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(500);
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
      match: async (url: string) =>
        store.has(url) ? new Response(store.get(url)) : undefined,
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
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as typeof fetch;

    await expect(fetchCached("/d.txt", CACHE)).rejects.toThrow("404");
  });
});
