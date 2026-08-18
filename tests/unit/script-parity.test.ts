/**
 * The build scripts and the browser must agree, exactly.
 *
 * Two pieces of logic exist twice in this project, and both copies are load
 * bearing:
 *
 *   the alphabet    scripts/lib/uyghur.mjs encodes the artifact and
 *                   lib/spellcheck/dictionary.ts decodes it. If the two tables
 *                   ever disagreed by one position, every word would decode to
 *                   a different word — and the artifact would still load, still
 *                   binary-search, and still look plausible.
 *
 *   acceptance      scripts/lib/morphology.mjs decides which corpus words the
 *                   vocabulary need not include because the checker will accept
 *                   them anyway; lib/spellcheck/morphology.ts is what actually
 *                   accepts them. A drift here silently drops real words.
 *
 * The duplication is not laziness: the scripts run under plain node, which
 * cannot resolve the TypeScript modules' extensionless imports. This file is
 * the price of that, and it is cheap — it runs both implementations over the
 * whole evaluation set and fails on the first disagreement.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DICT_ALPHABET,
  isKnownStem,
  unpackDictionary,
  type PackedDictionary,
} from "@/lib/spellcheck/dictionary";
import { accepts as acceptsTs, harmonyOf as harmonyTs } from "@/lib/spellcheck/morphology";
import { DICT_ALPHABET as SCRIPT_ALPHABET } from "../../scripts/lib/uyghur.mjs";
import { accepts as acceptsMjs, harmonyOf as harmonyMjs } from "../../scripts/lib/morphology.mjs";
import { ACCEPT_SUFFIXES, MAX_SUFFIX, MIN_STEM } from "@/lib/spellcheck/suffixes.generated";

const readText = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("the alphabet the artifact is written and read with", () => {
  it("is the same table on both sides, in the same order", () => {
    expect(SCRIPT_ALPHABET.join("")).toBe(DICT_ALPHABET);
    expect(DICT_ALPHABET.length).toBe(34);
  });

  it("is in code-point order, which is what keeps the binary search correct", () => {
    const sorted = [...DICT_ALPHABET].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
    expect(sorted.join("")).toBe(DICT_ALPHABET);
  });
});

describe("the acceptance rule", () => {
  const buffer = readFileSync(
    fileURLToPath(new URL("../../public/spellcheck/uyghur-dict.bin", import.meta.url)),
  );
  const dictionary: PackedDictionary = unpackDictionary(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );

  // The script reads its tables from spellcheck-data/, which is a build cache
  // and not committed. Rebuilding them here from the generated module keeps the
  // test runnable on a clean checkout while still comparing the real logic.
  const tables = {
    accept: new Map(ACCEPT_SUFFIXES.map(([suffix, harmony, after]) => [suffix, { harmony, after }])),
    suggest: new Set<string>(),
    minStem: MIN_STEM,
    maxSuffix: MAX_SUFFIX,
  };

  const words = [
    ...readText("../fixtures/spellcheck/positive-words.txt").split("\n"),
    ...readText("../fixtures/spellcheck/negative-words.txt").split("\n").map((line) => line.split("\t")[0]),
  ].filter((word) => word && !word.startsWith("#"));

  it("agrees on harmony for every word in the evaluation sets", () => {
    for (const word of words) {
      expect(harmonyMjs(word), word).toBe(harmonyTs(word));
    }
  });

  it("agrees on acceptance for every word in the evaluation sets", () => {
    // Both sides are handed the same notion of a known stem, so a difference
    // that shows up is a difference in the RULE rather than in the data it saw.
    for (const word of words) {
      const fromScript = acceptsMjs(word, tables, (stem: string) => isKnownStem(dictionary, stem));
      const fromBrowser = acceptsTs(dictionary, word);
      expect(fromScript, `${word}: the build script and the browser disagree`).toBe(fromBrowser);
    }
  });
});
