/**
 * Turn a hand-edited vocabulary list back into recorded decisions.
 *
 * Run:  node scripts/adopt-review.mjs <reviewed-file> [original-file]
 *
 * WHY THIS EXISTS. The review file offers «= توغرىسى» to correct a word, but
 * the natural thing to do when reading two thousand lines is simply to fix the
 * word where it sits. That works — the wrong form leaves the list and the right
 * one takes its place — but it throws away the more valuable half of the
 * judgement. «ئۆزەڭ» corrected to «ئۆزۈڭ» is not just one word swapped for
 * another: it is someone who knows Uyghur saying THIS is a misspelling of THAT,
 * and that pair is worth more than either word alone, because it lets the
 * checker fix the mistake instead of only underlining it.
 *
 * HOW THE PAIRS ARE RECOVERED. The two counts beside each word were left
 * untouched during the edit, and they are effectively a fingerprint: a word
 * occurring 101 times across 15 books, sitting where it sat, is the same entry
 * whatever its spelling now reads. So a removed word and a new word sharing a
 * count pair are the two halves of one correction. Where a bucket is ambiguous
 * the entries are matched in order, and every recovered pair is printed with
 * its edit distance so a wrong guess is visible rather than silent.
 *
 * Pairs that look nothing like each other are NOT adopted as corrections. A
 * recovered pair is a claim about the language, and one the tool is only
 * entitled to make when the evidence is a small, plausible edit.
 */
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { formatVocabulary, parseVocabulary } from "./lib/vocabulary.mjs";
import { repoRoot } from "./lib/wordlist.mjs";

/** Beyond this many edits apart, a recovered pair is reported but not adopted. */
const MAX_PLAUSIBLE_EDITS = 4;

function distance(a, b) {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[y.length];
}

/**
 * Read a hand-edited list.
 *
 * Deliberately looser than the normal parser: a reviewer may well have written
 * a correction as two words («ۋەياكى» → «ۋە ياكى»), which is right about the
 * language even though a dictionary entry cannot hold a space.
 */
function readLoose(path) {
  const entries = [];
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(.+?)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) {
      entries.push({ word: match[1].trim(), total: Number(match[2]), books: Number(match[3]) });
    } else {
      entries.push({ word: line, total: 0, books: 0, malformed: true });
    }
  }
  return entries;
}

async function main() {
  const [reviewedArg, originalArg] = process.argv.slice(2);
  if (!reviewedArg) {
    console.error("Usage: node scripts/adopt-review.mjs <reviewed-file> [original-file]");
    process.exit(1);
  }
  const reviewedPath = resolve(reviewedArg);
  const originalPath = originalArg
    ? resolve(originalArg)
    : join(repoRoot, "data", "spellcheck", "vocabulary.txt");

  const original = parseVocabulary(readFileSync(originalPath, "utf-8"));
  const reviewed = readLoose(reviewedPath);

  const originalWords = new Set(original.map((entry) => entry.word));
  const reviewedWords = new Set(reviewed.map((entry) => entry.word));

  const removed = original.filter((entry) => !reviewedWords.has(entry.word));
  const appeared = reviewed.filter((entry) => !originalWords.has(entry.word));

  // Bucket both sides by the count pair the reviewer left alone.
  const bucket = (entry) => `${entry.total}\t${entry.books}`;
  const newByBucket = new Map();
  for (const entry of appeared) {
    const key = bucket(entry);
    if (!newByBucket.has(key)) newByBucket.set(key, []);
    newByBucket.get(key).push(entry);
  }

  const corrections = [];
  const rejections = [];
  const doubtful = [];

  /**
   * Pair up one bucket by SIMILARITY, not by the order the lines happened to be
   * in. A count pair like «5 3» can hold a hundred entries, and taking them in
   * order matched «ھېچۋەقەسى» against whatever sorted first instead of against
   * «ھېچ ۋەقەسى» sitting further down the same bucket. Every candidate pairing
   * is scored and the closest are taken first, so an obvious pair is never
   * displaced by an accident of ordering.
   */
  const removedByBucket = new Map();
  for (const gone of removed) {
    const key = bucket(gone);
    if (!removedByBucket.has(key)) removedByBucket.set(key, []);
    removedByBucket.get(key).push(gone);
  }

  for (const [key, goneList] of removedByBucket) {
    const arrivals = newByBucket.get(key) ?? [];
    const scored = [];
    for (const gone of goneList) {
      for (const arrival of arrivals) {
        scored.push({ gone, arrival, edits: distance(gone.word, arrival.word) });
      }
    }
    scored.sort((a, b) => a.edits - b.edits);

    const takenGone = new Set();
    const takenArrival = new Set();
    for (const candidate of scored) {
      if (takenGone.has(candidate.gone.word) || takenArrival.has(candidate.arrival.word)) continue;
      takenGone.add(candidate.gone.word);
      takenArrival.add(candidate.arrival.word);
      const pair = { ...candidate.gone, correction: candidate.arrival.word, edits: candidate.edits };
      if (candidate.edits > MAX_PLAUSIBLE_EDITS) doubtful.push(pair);
      else corrections.push(pair);
    }
    for (const gone of goneList) {
      if (!takenGone.has(gone.word)) rejections.push(gone);
    }
    newByBucket.set(key, arrivals.filter((entry) => !takenArrival.has(entry.word)));
  }

  // Anything new left unmatched was added by hand rather than corrected.
  const unmatched = [...newByBucket.values()].flat();

  const entries = [
    ...reviewed
      .filter((entry) => originalWords.has(entry.word))
      .map((entry) => ({ ...entry, decision: "admitted", correction: null })),
    ...corrections.map((pair) => ({
      word: pair.word,
      total: pair.total,
      books: pair.books,
      decision: "corrected",
      correction: pair.correction,
    })),
    // A doubtful bucket is two independent decisions, not one pair: the word
    // that left was removed, and the word that arrived was wanted. Reading it
    // as a pair would invent a correction nobody wrote; dropping the newcomer
    // would silently discard a word the reviewer chose to keep.
    ...doubtful.flatMap((pair) => [
      { word: pair.word, total: pair.total, books: pair.books, decision: "rejected", correction: null },
      {
        word: pair.correction,
        total: pair.total,
        books: pair.books,
        decision: "admitted",
        correction: null,
      },
    ]),
    ...rejections.map((entry) => ({
      word: entry.word,
      total: entry.total,
      books: entry.books,
      decision: "rejected",
      correction: null,
    })),
    ...unmatched.map((entry) => ({
      word: entry.word,
      total: entry.total,
      books: entry.books,
      decision: "admitted",
      correction: null,
    })),
  ];
  // The same word can arrive twice — two misspellings corrected to one target,
  // where the target was also in the list on its own. Keep the most specific
  // decision so a dedupe can never quietly turn a rejection into an admission.
  const rank = { corrected: 3, rejected: 2, admitted: 1 };
  const unique = new Map();
  for (const entry of entries) {
    const existing = unique.get(entry.word);
    if (!existing || rank[entry.decision] > rank[existing.decision]) unique.set(entry.word, entry);
  }
  entries.length = 0;
  entries.push(...unique.values());
  entries.sort((a, b) => b.books - a.books || b.total - a.total || (a.word < b.word ? -1 : 1));

  const outPath = join(repoRoot, "data", "spellcheck", "vocabulary.txt");
  await writeFile(
    outPath,
    formatVocabulary(entries, "Reviewed by hand; in-place edits recovered as corrections."),
    "utf-8",
  );

  const counts = { admitted: 0, corrected: 0, rejected: 0 };
  for (const entry of entries) counts[entry.decision]++;

  console.log(`reviewed file:  ${reviewed.length.toLocaleString("en-US")} entries`);
  console.log(`original list:  ${original.length.toLocaleString("en-US")} entries\n`);
  console.log(`recovered:`);
  console.log(`  admitted    ${counts.admitted.toLocaleString("en-US")}  kept as they were`);
  console.log(`  corrected   ${counts.corrected.toLocaleString("en-US")}  edited in place — the pair is now recorded`);
  console.log(`  rejected    ${counts.rejected.toLocaleString("en-US")}  removed from the list`);
  if (unmatched.length > 0) console.log(`  added       ${unmatched.length}  new words, not replacing anything`);
  if (doubtful.length > 0) {
    console.log(`\nNOT adopted as corrections — too far apart to be sure they are pairs.`);
    console.log(`They are recorded as plain rejections instead, which is the safe reading:`);
    for (const pair of doubtful.slice(0, 12)) {
      console.log(`  ${pair.word}  ~  ${pair.correction}   (${pair.edits} edits)`);
    }
    if (doubtful.length > 12) console.log(`  … and ${doubtful.length - 12} more`);
  }

  const byEdits = new Map();
  for (const pair of corrections) byEdits.set(pair.edits, (byEdits.get(pair.edits) ?? 0) + 1);
  console.log(`\ncorrections by how far apart the two spellings are:`);
  for (const edits of [...byEdits.keys()].sort((a, b) => a - b)) {
    console.log(`  ${edits} edit${edits === 1 ? " " : "s"}   ${byEdits.get(edits)}`);
  }
  console.log(`\nthe most-used corrections recovered:`);
  for (const pair of corrections.slice(0, 20)) {
    console.log(`  ${pair.word.padEnd(20)} → ${pair.correction.padEnd(20)} ${pair.total}x / ${pair.books} books`);
  }
  console.log(`\nwritten to data/spellcheck/vocabulary.txt`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
