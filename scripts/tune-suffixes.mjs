/**
 * Sweep the suffix-inventory thresholds and print what each one costs.
 *
 * Run:  node scripts/tune-suffixes.mjs
 *
 * This is a measurement tool, not part of the build. It exists because the
 * inventory has to be TIGHTENED until the false-accept rate holds and then
 * whatever recall falls out is reported — not the other way round. Widening a
 * morphology until coverage looks good and only afterwards asking what it let
 * through is how a spellchecker quietly stops checking.
 *
 * Every row below is measured on the committed evaluation sets, so the number
 * that decides the shipped thresholds is the same number the report quotes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { baseWords } from "./lib/wordlist.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtures = join(repoRoot, "tests", "fixtures", "spellcheck");

const BACK = new Set(["ا", "و", "ۇ"]);
const FRONT = new Set(["ە", "ې", "ۆ", "ۈ"]);

/** Back or front, from the last vowel that commits to either. ى is neutral. */
export function harmonyOf(word) {
  for (const char of [...word].reverse()) {
    if (BACK.has(char)) return "back";
    if (FRONT.has(char)) return "front";
  }
  return "neutral";
}

/**
 * Mine suffixes, recording which stem harmony classes each one is seen with.
 *
 * The harmony is learned rather than hand-written: «غا» attaches to back stems
 * and «گە» to front ones, and reading that off the dictionary is both less
 * error-prone than my writing the rule out and checkable against the data.
 */
export function mineSuffixes(words, dictionary, { minStem, maxSuffix }) {
  const found = new Map();
  for (const word of words) {
    for (let cut = minStem; cut < word.length; cut++) {
      const stem = word.slice(0, cut);
      if (!dictionary.has(stem)) continue;
      const suffix = word.slice(cut);
      if (suffix.length < 2 || suffix.length > maxSuffix) continue;
      let entry = found.get(suffix);
      if (!entry) {
        entry = { stems: 0, back: 0, front: 0, neutral: 0, after: new Map() };
        found.set(suffix, entry);
      }
      entry.stems++;
      entry[harmonyOf(stem)]++;
      const last = stem[stem.length - 1];
      entry.after.set(last, (entry.after.get(last) ?? 0) + 1);
    }
  }
  return found;
}

/** The inventory at one threshold, as a map from suffix to allowed harmony. */
export function inventoryAt(found, { minStems, harmonyRatio, minBoundary = 3 }) {
  const out = new Map();
  for (const [suffix, entry] of found) {
    if (entry.stems < minStems) continue;
    const committed = entry.back + entry.front;
    let allow = "both";
    if (committed >= 20) {
      // A suffix seen almost only with one class is restricted to it. That is
      // the single strongest brake on false accepts: «گە» on a back stem is not
      // Uyghur, and a misspelling that decomposes that way stays flagged.
      if (entry.back / committed >= harmonyRatio) allow = "back";
      else if (entry.front / committed >= harmonyRatio) allow = "front";
    }
    const after = new Set();
    for (const [char, count] of entry.after) if (count >= minBoundary) after.add(char);
    out.set(suffix, { allow, after });
  }
  return out;
}

/** Does `word` split into a dictionary stem plus up to `depth` known suffixes? */
export function decomposes(word, dictionary, inventory, { minStem, maxSuffix, depth }) {
  const walk = (rest, left) => {
    if (rest.length >= minStem && dictionary.has(rest)) return true;
    if (left === 0) return false;
    for (let take = 2; take <= maxSuffix && take < rest.length; take++) {
      const suffix = rest.slice(rest.length - take);
      const rule = inventory.get(suffix);
      if (rule === undefined) continue;
      const stem = rest.slice(0, rest.length - take);
      if (stem.length < minStem) continue;
      if (rule.allow !== "both") {
        const stemHarmony = harmonyOf(stem);
        if (stemHarmony !== "neutral" && stemHarmony !== rule.allow) continue;
      }
      // Uyghur picks the suffix shape from the sound the stem ends in — «دا»
      // after a voiced final, «تا» after a voiceless one. Learning which finals
      // each suffix is actually attested after is what stops «ئالغاندا» being
      // mis-accepted as «ئالغانتا».
      if (!rule.after.has(stem[stem.length - 1])) continue;
      if (walk(stem, left - 1)) return true;
    }
    return false;
  };
  return walk(word, depth);
}

function loadWords(file) {
  return readFileSync(join(fixtures, file), "utf-8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
}

function main() {
  const words = baseWords();
  const dictionary = new Set(words);
  const positives = loadWords("positive-words.txt");
  const negatives = loadWords("negative-words.txt").map((line) => line.split("\t")[0]);

  // Only the positives the dictionary does not already contain are interesting:
  // the rest are accepted whatever the morphology does.
  const missing = positives.filter((word) => !dictionary.has(word));
  console.log(
    `positives ${positives.length} (${missing.length} not in the dictionary) · negatives ${negatives.length}\n`,
  );

  const MIN_STEM = 4;
  const MIN_BOUNDARY = Number(process.env.MIN_BOUNDARY ?? 3);
  const MAX_SUFFIX = 7;
  const found = mineSuffixes(words, dictionary, { minStem: MIN_STEM, maxSuffix: MAX_SUFFIX });

  console.log("minStems  harmony  depth  suffixes  recovered   false accepts");
  console.log("-".repeat(66));
  for (const minStems of [50, 100, 200, 500, 1000]) {
    for (const harmonyRatio of [0.98]) {
      const inventory = inventoryAt(found, { minStems, harmonyRatio, minBoundary: MIN_BOUNDARY });
      for (const depth of [1, 2]) {
        const options = { minStem: MIN_STEM, maxSuffix: MAX_SUFFIX, depth };
        let recovered = 0;
        for (const word of missing) if (decomposes(word, dictionary, inventory, options)) recovered++;
        let accepted = 0;
        for (const word of negatives) {
          if (dictionary.has(word)) continue;
          if (decomposes(word, dictionary, inventory, options)) accepted++;
        }
        console.log(
          `${String(minStems).padStart(8)}  ${String(harmonyRatio).padStart(7)}  ${String(depth).padStart(5)}  ` +
            `${String(inventory.size).padStart(8)}  ` +
            `${String(recovered).padStart(5)} ${((recovered / missing.length) * 100).toFixed(1).padStart(5)}%  ` +
            `${String(accepted).padStart(6)} ${((accepted / negatives.length) * 100).toFixed(2).padStart(6)}%`,
        );
      }
    }
  }

  // The two field cases, at every setting, so it is visible which ones reach them.
  console.log("\nfield cases (the point of the exercise):");
  for (const [typed, intended] of [["تەۋەلىنگەن", "تەۋەلەنگەن"], ["قالدورمىغۇدەك", "قالدۇرمىغۇدەك"]]) {
    const inDict = dictionary.has(intended);
    console.log(`  ${intended}  in dictionary: ${inDict}`);
    for (const minStems of [50, 100, 200]) {
      const inventory = inventoryAt(found, { minStems, harmonyRatio: 0.98, minBoundary: MIN_BOUNDARY });
      for (const depth of [1, 2]) {
        const ok = decomposes(intended, dictionary, inventory, {
          minStem: MIN_STEM,
          maxSuffix: MAX_SUFFIX,
          depth,
        });
        console.log(`    minStems=${minStems} depth=${depth}: decomposes = ${ok}`);
      }
    }
    void typed;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
