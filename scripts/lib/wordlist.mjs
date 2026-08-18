/**
 * The word list every build script agrees on.
 *
 * Two sources, and the order matters only in that both are deduplicated:
 *
 *   the desktop's uyghur_words.txt   441,322 fully inflected forms, READ-ONLY
 *   data/spellcheck/vocabulary.txt   words the published library attests and
 *                                    the desktop list lacks, reviewable and
 *                                    committed
 *
 * Reading the source rather than the built artifact matters: the artifact is
 * an output, and a script that mines suffixes out of its own previous output
 * would drift a little further from the truth on every rebuild.
 */
import { readFileSync, existsSync } from "node:fs";
import { readVocabulary } from "./vocabulary.mjs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
export const desktopAssets = resolve(
  repoRoot,
  "..",
  "bilim hezinisi",
  "bilim hezinisi pc",
  "assets",
  "spellcheck",
);

/** The desktop list alone, which is what the "before" measurements are against. */
export function baseWords() {
  const path = join(desktopAssets, "uyghur_words.txt");
  if (!existsSync(path)) {
    console.error(
      `\nThe desktop dictionary was not found at\n  ${path}\n` +
        "These scripts read the desktop app's assets and never write to them.\n",
    );
    process.exit(1);
  }
  const raw = readFileSync(path, "utf-8");
  return [...new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].sort();
}

const vocabularyPath = () => join(repoRoot, "data", "spellcheck", "vocabulary.txt");

/**
 * Words admitted from the corpus, as reviewed.
 *
 * A word the owner marked wrong is NOT here — the whole point of marking it is
 * to keep it out. Its correction is, though, because a word someone had to
 * write out by hand is a word this library uses.
 */
export function vocabularyWords() {
  const words = [];
  for (const entry of readVocabulary(vocabularyPath())) {
    if (entry.decision === "admitted") words.push(entry.word);
    else if (entry.decision === "corrected") words.push(entry.correction);
  }
  return words;
}

/**
 * The wrong → right pairs the owner wrote while reviewing.
 *
 * These are worth more than the deletions they replace. A deletion only keeps a
 * misspelling out of the dictionary; a correction also tells the checker what
 * was meant, so the next person who types it is offered the right word first.
 */
export function vocabularyCorrections() {
  const pairs = new Map();
  for (const entry of readVocabulary(vocabularyPath())) {
    if (entry.decision === "corrected") pairs.set(entry.word, entry.correction);
  }
  return pairs;
}

/** Everything the shipped dictionary should contain, sorted and deduplicated. */
export function allWords() {
  return [...new Set([...baseWords(), ...vocabularyWords()])].sort();
}
