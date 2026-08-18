/**
 * Words the library uses that the dictionary has never heard of.
 *
 * Run:  node --env-file=.env.local scripts/build-vocabulary.mjs
 *
 * Output:
 *   data/spellcheck/vocabulary.txt   COMMITTED and meant to be read
 *
 * WHAT THIS IS FOR. Morphology closes the inflection gap — «قالدۇرمىغاندەك» is
 * derivable from «قالدۇر» — but it can do nothing about a word whose stem was
 * never in the dictionary at all. The published library is mostly religious
 * writing, and it is full of perfectly ordinary Uyghur the desktop word list
 * simply lacks: «ئەلەيھى», «رەزىيەللاھۇ», «بۇخارى», «مۇسلىم». No morphology
 * derives those. They have to be told.
 *
 * THE BAR IS ATTESTATION ACROSS BOOKS, NOT REPETITION. A word repeated forty
 * times in one volume is that volume's proper noun, its house spelling, or its
 * one recurring typo — importing it would teach the checker a mistake. The same
 * word in two or more different books, five or more times, is the language.
 * Both thresholds are stated below and quoted in the report so the number can
 * be argued with.
 *
 * TWO FILTERS BEFORE ANY OF THAT.
 *
 *   Orthography. A sixth of the corpus is Arabic quotation, and Arabic uses no
 *   letter Uyghur does not, so «ال» and «ول» look like ordinary tokens. They are
 *   rejected by rules verified against all 441,322 dictionary words: every
 *   Uyghur word has a vowel, and none begins with a bare one. See looksUyghur.
 *
 *   Redundancy. A word the morphology already accepts is not added. It would
 *   cost artifact space to say something the checker can already work out, and
 *   it would make the evaluation flatter itself — coverage that came from the
 *   word list looks the same as coverage that came from understanding the
 *   language, and only one of those generalises.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { corpusCounts, dataDir } from "./lib/corpus.mjs";
import { looksUyghur, encodable, UYGHUR_VOWELS } from "./lib/uyghur.mjs";
import { accepts, loadSuffixes } from "./lib/morphology.mjs";
import { formatVocabulary, readVocabulary } from "./lib/vocabulary.mjs";
import { baseWords } from "./lib/wordlist.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** A word must occur this often, across this many different books. */
export const MIN_TOTAL = 5;
export const MIN_BOOKS = 2;

/** One vowel per this many letters, below which a long token is not Uyghur. */
const VOWEL_DENSITY = 3;

/**
 * Two last checks before a corpus word may join the dictionary.
 *
 * A BARE SUFFIX IS NOT A WORD. «نىڭ» occurs 3,962 times across all 15 books,
 * and every one of them is a genitive that typesetting split off its stem.
 * Admitting it would teach the checker that any stray «نىڭ» is fine.
 *
 * ARABIC THAT SURVIVES THE ORTHOGRAPHY RULES. «رسول» starts with a consonant
 * and contains a vowel, so looksUyghur passes it, but Uyghur writes that word
 * «رەسۇل» — Arabic leaves short vowels unwritten and the giveaway is how few
 * vowels a long token has. Measured against the dictionary, only 0.78% of real
 * Uyghur words are this consonant-heavy, and they are loanwords like
 * «ئابستراكت» that are already listed. Rejecting the shape costs nothing here
 * and it is only ever used to decide what to let IN, never to check a word.
 */
function plausibleWord(word, { accept, suggest }) {
  if (accept.has(word) || suggest.has(word)) return false;
  const chars = [...word];
  if (chars.length < 4) return true;
  const vowels = chars.filter((char) => UYGHUR_VOWELS.has(char)).length;
  return vowels * VOWEL_DENSITY >= chars.length;
}

async function main() {
  const { counts, books } = await corpusCounts({ rescan: process.argv.includes("--rescan") });
  const dictionary = new Set(baseWords());
  const suffixes = loadSuffixes();
  const productive = new Set(
    readFileSync(join(dataDir, "productive-stems.txt"), "utf-8").split("\n").filter(Boolean),
  );

  // The same test the browser makes, expressed with what this script has: a
  // stem the library actually uses, or one the dictionary inflects widely.
  const isKnownStem = (stem) =>
    dictionary.has(stem) && (counts.has(stem) || productive.has(stem));

  const admitted = [];
  const rejected = { orthography: 0, attestation: 0, morphology: 0, shape: 0 };

  for (const [word, [total, bookCount]] of counts) {
    if (dictionary.has(word)) continue;
    if (!looksUyghur(word) || !encodable(word)) {
      rejected.orthography++;
      continue;
    }
    if (!plausibleWord(word, suffixes)) {
      rejected.shape++;
      continue;
    }
    if (total < MIN_TOTAL || bookCount < MIN_BOOKS) {
      rejected.attestation++;
      continue;
    }
    if (accepts(word, suffixes, isKnownStem)) {
      rejected.morphology++;
      continue;
    }
    admitted.push({ word, total, books: bookCount });
  }

  admitted.sort((a, b) => b.books - a.books || b.total - a.total || (a.word < b.word ? -1 : 1));

  const outDir = join(repoRoot, "data", "spellcheck");
  const listPath = join(outDir, "vocabulary.txt");

  // Carry every decision already made forward. Regenerating must never throw
  // away review: a word marked «-» stays rejected and is not offered again, and
  // a word given a correction keeps it. Only genuinely new candidates are added.
  const reviewed = new Map(readVocabulary(listPath).map((entry) => [entry.word, entry]));
  const merged = [];
  for (const row of admitted) {
    const existing = reviewed.get(row.word);
    merged.push(
      existing
        ? { ...existing, total: row.total, books: row.books }
        : { ...row, decision: "admitted", correction: null },
    );
    reviewed.delete(row.word);
  }
  // A decision on a word this scan no longer proposes is still a decision —
  // the corpus may have changed, or the morphology may now cover it — so it is
  // kept rather than dropped.
  for (const entry of reviewed.values()) {
    if (entry.decision !== "admitted") merged.push(entry);
  }
  merged.sort((a, b) => b.books - a.books || b.total - a.total || (a.word < b.word ? -1 : 1));

  await mkdir(outDir, { recursive: true });
  await writeFile(
    listPath,
    formatVocabulary(
      merged,
      `From ${books} published books, at >=${MIN_TOTAL} occurrences across >=${MIN_BOOKS} of them.`,
    ),
    "utf-8",
  );

  const decisions = { admitted: 0, corrected: 0, rejected: 0 };
  for (const entry of merged) decisions[entry.decision]++;
  console.log(`\ncandidates: ${merged.length.toLocaleString("en-US")} words`);
  console.log(`  admitted:   ${decisions.admitted.toLocaleString("en-US")}`);
  console.log(`  corrected:  ${decisions.corrected.toLocaleString("en-US")}  (kept out, and their correction shipped)`);
  console.log(`  rejected:   ${decisions.rejected.toLocaleString("en-US")}`);
  console.log(`\nnewly proposed this run: ${admitted.length.toLocaleString("en-US")} words`);
  console.log(`rejected:  ${rejected.orthography.toLocaleString("en-US")} not Uyghur orthography`);
  console.log(`           ${rejected.shape.toLocaleString("en-US")} a bare suffix, or too consonant-heavy to be Uyghur`);
  console.log(`           ${rejected.attestation.toLocaleString("en-US")} not attested widely enough`);
  console.log(`           ${rejected.morphology.toLocaleString("en-US")} already accepted by the morphology`);
  console.log(`\nwritten to data/spellcheck/vocabulary.txt — read it, and mark what is wrong`);
  console.log(`\ntop candidates:`);
  for (const row of merged.slice(0, 20)) {
    const mark =
      row.decision === "corrected" ? ` = ${row.correction}` : row.decision === "rejected" ? " -" : "";
    console.log(`  ${row.word.padEnd(18)} ${String(row.total).padStart(6)}x  ${row.books} books${mark}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
