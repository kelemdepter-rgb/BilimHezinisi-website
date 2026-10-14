/**
 * Personal-dictionary entries that look like two words stuck together
 * (PROMPT-48 D).
 *
 * Before line ends were word boundaries (PROMPT-42), «لۇغەتكە قوش» on the
 * last word of a line stored it glued to the first word of the next, and a
 * writer may still have some. Kept apart from personal.ts, which the page
 * itself loads: this needs the checker and the whole dictionary, so it runs
 * in the spellcheck worker only.
 */
import { hasWord, normalizeForLookup, type PackedDictionary } from "@/lib/spellcheck/dictionary";
import { isCorrect } from "@/lib/spellcheck/check";

/** Long enough that two real words could be in it. */
export const GLUED_MIN_LETTERS = 8;
/** Each half at least this long, so a suffix alone never counts as a word. */
export const GLUED_MIN_PART = 3;

/**
 * 8 letters or more, not a word the checker accepts on its own, and
 * splittable into two dictionary words of 3 letters or more. Uyghur writes
 * real compounds this way too, so this is a hint for the writer, never a
 * reason to remove anything; a hyphen is the writer's own join and is never
 * questioned.
 */
export function looksGlued(dictionary: PackedDictionary, word: string): boolean {
  const normalized = normalizeForLookup(word);
  if (normalized.includes("-")) return false;
  const letters = [...normalized];
  if (letters.length < GLUED_MIN_LETTERS) return false;
  if (isCorrect(dictionary, normalized)) return false;
  for (let cut = GLUED_MIN_PART; cut <= letters.length - GLUED_MIN_PART; cut++) {
    if (
      hasWord(dictionary, letters.slice(0, cut).join("")) &&
      hasWord(dictionary, letters.slice(cut).join(""))
    ) {
      return true;
    }
  }
  return false;
}
