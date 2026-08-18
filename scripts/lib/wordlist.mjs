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

/** Words admitted from the corpus, as reviewed. Empty before the first build. */
export function vocabularyWords() {
  const path = join(repoRoot, "data", "spellcheck", "vocabulary.txt");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t")[0])
    .filter(Boolean);
}

/** Everything the shipped dictionary should contain, sorted and deduplicated. */
export function allWords() {
  return [...new Set([...baseWords(), ...vocabularyWords()])].sort();
}
