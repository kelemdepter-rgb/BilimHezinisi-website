/**
 * The acceptance rule, script side.
 *
 * A deliberate mirror of `accepts` in lib/spellcheck/morphology.ts. The build
 * scripts run under plain node, which cannot resolve the TypeScript module's
 * extensionless imports, and the vocabulary build has to know exactly which
 * words the shipped checker will already accept — otherwise it would add
 * thousands of forms the morphology covers for free, or miss ones it does not.
 *
 * The copy is held honest by tests/unit/script-parity.test.ts, which runs both
 * implementations over every word in the evaluation sets and fails on the first
 * disagreement. That is the same arrangement the SQL/matcher parity test uses,
 * and it is why this file may exist at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./corpus.mjs";

const BACK = new Set(["ا", "و", "ۇ"]);
const FRONT = new Set(["ە", "ې", "ۆ", "ۈ"]);

export function harmonyOf(word) {
  for (let index = word.length - 1; index >= 0; index--) {
    const char = word[index];
    if (BACK.has(char)) return "back";
    if (FRONT.has(char)) return "front";
  }
  return "neutral";
}

/** The tables build-suffixes.mjs wrote, in the shape the checker uses them. */
export function loadSuffixes() {
  const data = JSON.parse(readFileSync(join(dataDir, "suffixes.json"), "utf-8"));
  return {
    accept: new Map(data.accept.map(([suffix, harmony, after]) => [suffix, { harmony, after }])),
    suggest: new Set(data.suggest),
    minStem: data.minStem,
    maxSuffix: data.maxSuffix,
  };
}

function suffixFits(stem, rule) {
  if (rule.harmony !== "") {
    const harmony = harmonyOf(stem);
    if (harmony !== "neutral" && harmony !== rule.harmony) return false;
  }
  return rule.after.includes(stem[stem.length - 1]);
}

/**
 * Would the shipped checker accept this unlisted word as a valid inflection?
 *
 * `isKnownStem` is the caller's, because the two callers know it differently:
 * the browser reads a flag byte out of the artifact, the build script has the
 * corpus counts and the productive-stem list in front of it. Both mean the same
 * thing — a stem the library actually uses, or one the dictionary inflects
 * widely — and the parity test proves they agree.
 */
export function accepts(word, { accept, minStem, maxSuffix }, isKnownStem) {
  for (let take = 2; take <= maxSuffix && take < word.length; take++) {
    const stem = word.slice(0, word.length - take);
    if (stem.length < minStem) break;
    const rule = accept.get(word.slice(word.length - take));
    if (!rule) continue;
    if (!suffixFits(stem, rule)) continue;
    if (isKnownStem(stem)) return true;
  }
  return false;
}
