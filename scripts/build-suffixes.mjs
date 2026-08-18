/**
 * The Uyghur suffix inventory, read off the dictionary itself.
 *
 * Run:  node --env-file=.env.local scripts/build-suffixes.mjs
 *
 * Output:
 *   lib/spellcheck/suffixes.generated.ts
 *
 * WHY MINE IT RATHER THAN WRITE IT OUT. Uyghur is agglutinative: a stem takes
 * chains of suffixes, so the set of valid words is unbounded and no list of
 * forms can cover it. The shipped dictionary has 441,322 forms and still holds
 * five of «قالدۇر»'s six, which is the proof that enumeration cannot work rather
 * than a gap to patch. But a hand-written suffix list would just be my guesses
 * about Uyghur, and this project has already been burned once by a confusion
 * table built from intuition. So the inventory is counted: wherever a dictionary
 * word splits into another dictionary word plus a tail, that tail is a candidate
 * suffix, and the ones that recur across hundreds of different stems are real.
 *
 * TWO TIERS, BECAUSE THEY CARRY DIFFERENT RISK.
 *
 *   ACCEPT is used to decide that an unlisted word is nonetheless correct. Every
 *   entry here is a chance to wave a real misspelling through, so it is tuned
 *   against the negative evaluation set and kept deliberately narrow.
 *
 *   SUGGEST is used only to take a word apart so a correction can be offered.
 *   Adding a candidate to a ranked list cannot make the checker accept anything,
 *   so this tier is far wider — it is what lets «قالدورمىغۇدەك» be split at
 *   «مىغۇدەك» (23 stems, nowhere near the ACCEPT bar) so the stem underneath can
 *   be corrected and the tail put back.
 *
 * THREE CONSTRAINTS, ALL LEARNED, NONE WRITTEN BY HAND:
 *
 *   productivity  how many distinct stems the suffix is attested on.
 *   harmony       Uyghur back and front vowels do not mix, so «گە» goes on front
 *                 stems and «غا» on back ones. Counted per suffix, not assumed.
 *   boundary      the shape depends on the sound the stem ends in — «دا» after a
 *                 voiced final, «تا» after a voiceless one. Without this the
 *                 checker accepted «ئالغانتا» for «ئالغاندا» and «ئاساستۇ» for
 *                 «ئاساستا»; with it, it does not.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { corpusCounts, dataDir } from "./lib/corpus.mjs";
import { allWords } from "./lib/wordlist.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Shortest thing that may be called a stem. */
export const MIN_STEM = 4;
/** Longest tail treated as one suffix. */
export const MAX_SUFFIX = 7;
/**
 * Distinct stems a suffix needs before it may make a word CORRECT, by length.
 *
 * A flat threshold was tried first and is worse at both ends. Short suffixes
 * are the dangerous ones: the negative set is built by changing one letter, and
 * a two-letter suffix is one letter away from several other two-letter
 * suffixes, so «ئالغاندا» becomes «ئالغانتا» and a flat bar low enough to admit
 * real long suffixes waves it through. Long suffixes are nearly impossible to
 * hit by accident, so they can be admitted on far less evidence.
 *
 * Measured against the evaluation sets, this ladder against a flat 500:
 *   false accepts   1.80% -> 1.13%
 *   paradigm        78.1% -> 76.7%
 * and it is what lets «تەۋەلەنگەن» be accepted at all — «لەنگەن» is attested on
 * 101 stems, which no flat threshold worth having would reach.
 */
const ACCEPT_MIN_STEMS = { 2: 3000, 3: 1500, 4: 600, 5: 250, 6: 100, 7: 40 };
/** Distinct stems a suffix needs before it may be used to take a word apart. */
const SUGGEST_MIN_STEMS = 20;
/** Share of committed stems in one harmony class before the suffix is bound to it. */
const HARMONY_RATIO = 0.98;
/** Times a stem-final letter must be seen before the boundary counts as attested. */
const MIN_BOUNDARY = 3;
/** Dictionary-attested inflected forms that make a stem "productive". */
export const PRODUCTIVE_STEM_FORMS = 150;

const BACK = new Set(["ا", "و", "ۇ"]);
const FRONT = new Set(["ە", "ې", "ۆ", "ۈ"]);

/** Back or front, from the last vowel that commits to either. ى is neutral. */
export function harmonyOf(word) {
  for (let index = word.length - 1; index >= 0; index--) {
    const char = word[index];
    if (BACK.has(char)) return "back";
    if (FRONT.has(char)) return "front";
  }
  return "neutral";
}

async function main() {
  const words = allWords();
  const dictionary = new Set(words);
  const { counts } = await corpusCounts();

  /** suffix → how often, on which harmony classes, after which final letters */
  const found = new Map();
  /** stem → how many inflected forms the dictionary itself gives it */
  const formCount = new Map();

  for (const word of words) {
    for (let cut = MIN_STEM; cut < word.length; cut++) {
      const stem = word.slice(0, cut);
      if (!dictionary.has(stem)) continue;
      const suffix = word.slice(cut);
      if (suffix.length < 2 || suffix.length > MAX_SUFFIX) continue;

      let entry = found.get(suffix);
      if (!entry) {
        entry = { stems: 0, back: 0, front: 0, after: new Map() };
        found.set(suffix, entry);
      }
      entry.stems++;
      const harmony = harmonyOf(stem);
      if (harmony !== "neutral") entry[harmony]++;
      const last = stem[stem.length - 1];
      entry.after.set(last, (entry.after.get(last) ?? 0) + 1);
      formCount.set(stem, (formCount.get(stem) ?? 0) + 1);
    }
  }

  const accept = [];
  for (const [suffix, entry] of found) {
    if (entry.stems < ACCEPT_MIN_STEMS[suffix.length]) continue;
    const committed = entry.back + entry.front;
    let allow = "";
    if (committed >= 20) {
      if (entry.back / committed >= HARMONY_RATIO) allow = "back";
      else if (entry.front / committed >= HARMONY_RATIO) allow = "front";
    }
    const after = [...entry.after.entries()]
      .filter(([, count]) => count >= MIN_BOUNDARY)
      .map(([char]) => char)
      .sort()
      .join("");
    if (!after) continue;
    accept.push([suffix, allow, after, entry.stems]);
  }
  accept.sort((a, b) => b[3] - a[3] || (a[0] < b[0] ? -1 : 1));

  const suggest = [...found.entries()]
    .filter(([, entry]) => entry.stems >= SUGGEST_MIN_STEMS)
    .sort((a, b) => b[1].stems - a[1].stems || (a[0] < b[0] ? -1 : 1))
    .map(([suffix]) => suffix);

  const productive = [...formCount.entries()]
    .filter(([, count]) => count >= PRODUCTIVE_STEM_FORMS)
    .map(([stem]) => stem);

  // Written out for build-spelldict.mjs, which folds it into the artifact's
  // per-word byte rather than shipping a second list.
  await writeFile(join(dataDir, "productive-stems.txt"), `${productive.sort().join("\n")}\n`, "utf-8");

  // The same tables as JSON, so the vocabulary build applies exactly the
  // acceptance rule the browser will rather than an approximation of it.
  await writeFile(
    join(dataDir, "suffixes.json"),
    JSON.stringify({
      accept: accept.map(([suffix, allow, after]) => [suffix, allow, after]),
      suggest,
      minStem: MIN_STEM,
      maxSuffix: MAX_SUFFIX,
    }),
    "utf-8",
  );

  const generated = `/**
 * GENERATED by scripts/build-suffixes.mjs — do not edit by hand.
 *
 * Counted from the ${words.length.toLocaleString("en-US")}-word dictionary: wherever one dictionary word is
 * another dictionary word plus a tail, that tail is a candidate suffix.
 *
 * ACCEPT (${accept.length}) may make an unlisted word count as CORRECT, so each entry is a
 * chance to wave a real misspelling through. Kept to suffixes attested on
 * enough distinct stems for their length (${Object.entries(ACCEPT_MIN_STEMS).map(([n, k]) => n + ":" + k).join(", ")}),
 * a ladder tuned against the negative evaluation set.
 *
 * SUGGEST (${suggest.length}) is only used to take a typed word apart so a correction can be
 * offered. That cannot make the checker accept anything, so the bar is ${SUGGEST_MIN_STEMS} stems —
 * which is what lets «قالدورمىغۇدەك» split at «مىغۇدەك» and have its stem fixed.
 *
 * Each ACCEPT entry is [suffix, harmony, stem-final letters it is attested after].
 * An empty harmony means the suffix is seen on both classes.
 */

export type SuffixRule = { readonly suffix: string; readonly harmony: "" | "back" | "front"; readonly after: string };

export const ACCEPT_SUFFIXES: readonly (readonly [string, "" | "back" | "front", string])[] = [
${accept.map(([suffix, allow, after]) => `  ["${suffix}", "${allow}", "${after}"],`).join("\n")}
];

/** Ordered by how many stems each is attested on, most productive first. */
export const SUGGEST_SUFFIXES: readonly string[] = [
${suggest.map((suffix) => `  "${suffix}",`).join("\n")}
];

export const MIN_STEM = ${MIN_STEM};
export const MAX_SUFFIX = ${MAX_SUFFIX};
`;

  await writeFile(join(repoRoot, "lib", "spellcheck", "suffixes.generated.ts"), generated, "utf-8");

  const corpusStems = productive.filter((stem) => counts.has(stem)).length;
  console.log(`accept tier:      ${accept.length} suffixes (by length: ${Object.entries(ACCEPT_MIN_STEMS).map(([n, k]) => n + "->" + k).join(", ")})`);
  console.log(`suggest tier:     ${suggest.length} suffixes (>=${SUGGEST_MIN_STEMS} stems)`);
  console.log(`productive stems: ${productive.length.toLocaleString("en-US")} (>=${PRODUCTIVE_STEM_FORMS} forms), ${corpusStems.toLocaleString("en-US")} also in the corpus`);
  console.log(`\nmost productive suffixes:`);
  for (const [suffix, allow, after, stems] of accept.slice(0, 16)) {
    console.log(`  ${suffix.padEnd(9)} ${String(stems).padStart(6)} stems  ${(allow || "both").padEnd(6)}  after ${after}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
