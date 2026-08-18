/**
 * The evaluation data, generated from the library itself.
 *
 * Run:  node --env-file=.env.local scripts/build-eval-sets.mjs
 *
 * Output (all committed, so the numbers can be re-checked without a database):
 *   tests/fixtures/spellcheck/positive-words.txt   must NOT be flagged
 *   tests/fixtures/spellcheck/negative-words.txt   MUST be flagged
 *   tests/fixtures/spellcheck/paradigms.json       inflection families
 *
 * WHY GENERATE IT AT ALL. UyghurEdit++ — the mature checker this project was
 * ported from — red-underlines «قالدۇرمىغۇدەك» and «تەۋەلەنگەن», both of which
 * are perfectly ordinary Uyghur. So there is no external tool whose acceptance
 * can be copied or trusted as ground truth, and hand-written test words would
 * only encode the same intuitions the code already has. The published library is
 * the way out: 15 edited volumes, 7,525 pages, written and proofread by people
 * who know the language.
 *
 * THE POSITIVE SET is words the corpus attests widely. A word that appears many
 * times across several different books is overwhelmingly correct Uyghur, so
 * every one the checker rejects is a coverage failure — the exact failure
 * UyghurEdit++ exhibits. The threshold is on the BOOK count first: a word
 * repeated forty times in one volume is a proper noun or that volume's house
 * spelling, while the same word in three volumes is the language.
 *
 * THE NEGATIVE SET is those same known-good words with one realistic error
 * applied, drawn from the confusion table learned from real corrections — so
 * these are the mistakes Uyghur writers actually make, not random noise. A
 * mutation that lands on another real word is discarded, because then it is not
 * a misspelling at all. Whatever the checker still accepts is a false accept,
 * and that number is the binding constraint on every widening of the suffix
 * inventory.
 *
 * Both sets are drawn from the corpus, and the vocabulary the checker ships also
 * comes from the corpus. That overlap is not hidden: the evaluation reports
 * coverage separately for words morphology reaches and words the vocabulary had
 * to be told about, because the second group is covered by construction and
 * proves nothing on its own.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { corpusCounts } from "./lib/corpus.mjs";
import { looksUyghur, encodable, UYGHUR_VOWELS } from "./lib/uyghur.mjs";
import { baseWords } from "./lib/wordlist.mjs";
import { mineWeights, splitCorrections } from "./build-edit-weights.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const desktop = resolve(repoRoot, "..", "bilim hezinisi", "bilim hezinisi pc", "assets", "spellcheck");
const fixtures = join(repoRoot, "tests", "fixtures", "spellcheck");

/** A word counts as known-good at this attestation and no less. */
export const POSITIVE_MIN_TOTAL = 5;
export const POSITIVE_MIN_BOOKS = 2;
/** Mutations are only drawn from confusions seen this often in real corrections. */
const MUTATION_MIN_COUNT = 5;
/** How many negatives to generate. Enough that the rate is stable to a tenth. */
const NEGATIVE_TARGET = 4000;
/** A suffix chain must appear on this many other stems to count as expected. */
const PARADIGM_MIN_STEMS = 40;
/** How many stems to build inflection families for. */
const PARADIGM_STEMS = 12;

/** Deterministic per-word choice, so the sets regenerate identically. */
function seededPick(word, salt, length) {
  let value = 0x811c9dc5 ^ salt;
  for (const char of word) {
    value ^= char.codePointAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value % length;
}

async function main() {
  const { counts, books } = await corpusCounts({ rescan: process.argv.includes("--rescan") });
  const dictionary = new Set(baseWords());
  const inDictionary = new Set(dictionary);

  // ── the known-good pool ────────────────────────────────────────────────
  const known = [];
  for (const [word, [total, bookCount]] of counts) {
    if (!looksUyghur(word) || !encodable(word)) continue;
    if (total < POSITIVE_MIN_TOTAL || bookCount < POSITIVE_MIN_BOOKS) continue;
    known.push(word);
  }
  known.sort();

  // Anything the corpus saw at all is "a real word" for the purpose of
  // rejecting mutations, even below the attestation threshold — a mutation that
  // lands on a rare but real word is not a misspelling.
  const anyReal = new Set([...counts.keys()].filter((word) => encodable(word)));

  // ── mutations, from the confusions real corrections demonstrate ────────
  const corrections = JSON.parse(await readFile(join(desktop, "uyghur_corrections.json"), "utf-8"));
  const { training } = splitCorrections(corrections);
  const { confusions } = mineWeights(training);
  const pairs = [...confusions.entries()]
    .filter(([, count]) => count >= MUTATION_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([pair]) => [...pair]);

  const byLetter = new Map();
  for (const [a, b] of pairs) {
    if (!byLetter.has(a)) byLetter.set(a, []);
    if (!byLetter.has(b)) byLetter.set(b, []);
    byLetter.get(a).push(b);
    byLetter.get(b).push(a);
  }

  const negatives = [];
  const seenNegative = new Set();
  for (const word of known) {
    if (negatives.length >= NEGATIVE_TARGET) break;
    const chars = [...word];
    // Positions whose letter has a known confusion, walked from a
    // word-dependent start so the errors are not all in the same place.
    const positions = chars.map((_, index) => index).filter((index) => byLetter.has(chars[index]));
    if (positions.length === 0) continue;
    const start = seededPick(word, 1, positions.length);

    for (let step = 0; step < positions.length; step++) {
      const at = positions[(start + step) % positions.length];
      const options = byLetter.get(chars[at]);
      const replacement = options[seededPick(word, 2 + at, options.length)];
      const mutant = [...chars.slice(0, at), replacement, ...chars.slice(at + 1)].join("");

      // Discard anything that is not actually a misspelling.
      if (inDictionary.has(mutant) || anyReal.has(mutant)) continue;
      if (!looksUyghur(mutant)) continue;
      if (seenNegative.has(mutant)) continue;
      seenNegative.add(mutant);
      negatives.push({ typed: mutant, from: word });
      break;
    }
  }

  // ── inflection paradigms ───────────────────────────────────────────────
  // A suffix chain that attaches to hundreds of stems is expected on all of
  // them. Where a stem is missing one, the dictionary has a hole — and «قالدۇر»
  // having five of its six forms is exactly the failure being measured.
  const suffixCount = new Map();
  for (const word of dictionary) {
    for (let cut = 3; cut < word.length; cut++) {
      const stem = word.slice(0, cut);
      if (!inDictionary.has(stem)) continue;
      const suffix = word.slice(cut);
      if (suffix.length < 2 || suffix.length > 8) continue;
      suffixCount.set(suffix, (suffixCount.get(suffix) ?? 0) + 1);
      break;
    }
  }
  const productive = [...suffixCount.entries()]
    .filter(([, count]) => count >= PARADIGM_MIN_STEMS)
    .sort((a, b) => b[1] - a[1])
    .map(([suffix]) => suffix);

  const backVowels = new Set(["ا", "و", "ۇ"]);
  const harmonyOf = (word) => {
    for (const char of [...word].reverse()) {
      if (backVowels.has(char)) return "back";
      if (UYGHUR_VOWELS.has(char)) return "front";
    }
    return "front";
  };

  // Stems worth reporting: real words, frequent in the corpus, that already
  // carry many of these suffixes — so the family is genuinely theirs.
  const stemScore = new Map();
  for (const suffix of productive.slice(0, 120)) {
    for (const stem of known) {
      if (stem.length < 4) continue;
      if (inDictionary.has(stem + suffix)) {
        stemScore.set(stem, (stemScore.get(stem) ?? 0) + 1);
      }
    }
  }
  const stems = [...stemScore.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, PARADIGM_STEMS)
    .map(([stem]) => stem);
  // «قالدۇر» is the case that started this; report it whether or not it ranks.
  if (!stems.includes("قالدۇر")) stems.push("قالدۇر");

  const paradigms = stems.map((stem) => {
    const harmony = harmonyOf(stem);
    const forms = productive
      .filter((suffix) => harmonyOf(stem + suffix) === harmony)
      .slice(0, 40)
      .map((suffix) => ({ form: stem + suffix, suffix, inDictionary: inDictionary.has(stem + suffix) }));
    return { stem, harmony, forms };
  });

  await mkdir(fixtures, { recursive: true });
  await writeFile(
    join(fixtures, "positive-words.txt"),
    `# Attested in the published library: >=${POSITIVE_MIN_TOTAL} occurrences across >=${POSITIVE_MIN_BOOKS} of ${books} books.\n` +
      `# Every one of these SHOULD be accepted. Flagging one is a coverage failure.\n` +
      `${known.join("\n")}\n`,
    "utf-8",
  );
  await writeFile(
    join(fixtures, "negative-words.txt"),
    `# Known-good corpus words with one realistic error applied, drawn from the\n` +
      `# confusion table learned from real corrections. Mutations landing on another\n` +
      `# real word were discarded. Every one of these MUST still be flagged.\n` +
      `# Format: typed<TAB>the word it was made from\n` +
      `${negatives.map((row) => `${row.typed}\t${row.from}`).join("\n")}\n`,
    "utf-8",
  );
  await writeFile(join(fixtures, "paradigms.json"), `${JSON.stringify(paradigms, null, 1)}\n`, "utf-8");

  const gaps = paradigms.reduce(
    (sum, entry) => sum + entry.forms.filter((form) => !form.inDictionary).length,
    0,
  );
  const totalForms = paradigms.reduce((sum, entry) => sum + entry.forms.length, 0);

  console.log(`\npositive set:  ${known.length.toLocaleString("en-US")} words`);
  console.log(`  attested >=${POSITIVE_MIN_TOTAL}x across >=${POSITIVE_MIN_BOOKS} books`);
  console.log(`  already in the dictionary: ${known.filter((word) => inDictionary.has(word)).length.toLocaleString("en-US")}`);
  console.log(`  NOT in the dictionary:     ${known.filter((word) => !inDictionary.has(word)).length.toLocaleString("en-US")}  <- today's coverage failures`);
  console.log(`\nnegative set:  ${negatives.length.toLocaleString("en-US")} misspellings`);
  console.log(`  from ${pairs.length} confusion pairs seen >=${MUTATION_MIN_COUNT}x in real corrections`);
  console.log(`\nparadigms:     ${paradigms.length} stems, ${totalForms} forms`);
  console.log(`  missing from the dictionary: ${gaps} (${((gaps / totalForms) * 100).toFixed(1)}%)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
