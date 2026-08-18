/**
 * Is this word wrong, and what should it be instead.
 *
 * Kept apart from dictionary.ts because this is where the three sources of
 * knowledge meet — the word list, the learned edit weights, and the morphology —
 * and none of them should have to import the others.
 */
import {
  editsOnce,
  frequencyOf,
  hasWord,
  isCheckable,
  MAX_SUGGESTIONS,
  normalizeForLookup,
  UYGHUR_LETTERS,
  type PackedDictionary,
} from "./dictionary";
import { CONFUSABLE_WITH } from "./confusion";
import { accepts, isConfusionRepair, nearestSuffixes, splits } from "./morphology";
import { rankCandidates } from "./rank";

/**
 * Is this word spelled correctly?
 *
 * Follows the desktop's isCorrect — including its compound rule, where
 * «foo-bar» is fine when both halves are words in their own right — and then
 * adds the one thing the desktop never had: a word that is not listed but is a
 * correctly formed inflection of a stem we know is accepted rather than
 * underlined. That is the whole point of the morphology, and it is also the
 * only place in the checker that can produce a false accept, which is why
 * `accepts` is measured against a negative set rather than trusted.
 */
export function isCorrect(
  dictionary: PackedDictionary,
  word: string,
  personal: ReadonlySet<string> = new Set(),
): boolean {
  const normalized = normalizeForLookup(word);
  if (!isCheckable(normalized)) return true;
  if (hasWord(dictionary, normalized) || personal.has(normalized)) return true;

  if (normalized.includes("-")) {
    const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every((part) => hasWord(dictionary, part) || personal.has(part))) {
      return true;
    }
  }
  return accepts(dictionary, normalized);
}

type Candidate = { term: string; frequency?: number };

/**
 * The second edit, kept to what people actually do.
 *
 * Deletions and transpositions in full — they are cheap and they are common —
 * but substitutions only into letters the corrections data says are confused
 * with this one. Insertions are dropped entirely at this depth: an insertion
 * on top of another error is the rarest combination there is and it was costing
 * more than everything else together.
 *
 * MEASURED, BECAUSE THE OBVIOUS VERSION WAS WORSE. Composing the full
 * 34-letter edit set with itself — every string two arbitrary edits away — was
 * tried first, on all 719 held-out pairs. It found nothing: rank 1 went from
 * 94.0% to 93.9% and top 3 from 97.5% to 97.2%, both very slightly WORSE,
 * because the extra tens of thousands of distant candidates occasionally
 * displace the right answer. It cost 20x the time and took a long word to
 * 230 ms, which is past where typing stutters.
 *
 * So the second step is composed of realistic edits instead. That keeps the
 * property the brief actually wants — two-edit candidates are ALWAYS generated
 * and scored alongside one-edit ones, never gated behind "distance 1 found
 * nothing" — while staying inside the frame budget on every word length.
 */
function editsAgain(word: string): Set<string> {
  const out = new Set<string>();
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    out.add(chars.slice(0, i).concat(chars.slice(i + 1)).join(""));
  }
  for (let i = 0; i < chars.length - 1; i++) {
    const swapped = chars.slice();
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    out.add(swapped.join(""));
  }
  for (let i = 0; i < chars.length; i++) {
    const options = CONFUSABLE_WITH.get(chars[i]);
    if (!options) continue;
    for (const letter of options) {
      const replaced = chars.slice();
      replaced[i] = letter;
      out.add(replaced.join(""));
    }
  }
  out.delete(word);
  return out;
}

/**
 * Ranked corrections for one word.
 *
 * Candidates come from four places and every one of them is scored by the same
 * function before anything is cut:
 *
 *   1. the hand-built corrections table, which encodes mistakes people actually
 *      make and is given a frequency floor so it ranks well without being
 *      exempt from the scoring;
 *   2. dictionary words one edit away;
 *   3. dictionary words two edits away — generated ALWAYS, not only when one
 *      edit found nothing. The old code stopped at the first non-empty result,
 *      so a word with any near neighbour could never reach the right answer two
 *      edits out;
 *   4. morphology: a correctly spelled suffix on a misspelled stem, or a
 *      misspelled suffix on a stem that is fine.
 *
 * The desktop's stem-prefix fallback is last and only when nothing else
 * answered — it returns a prefix of the typed word, which is a poor correction
 * and must never displace a real candidate.
 */
export function suggest(
  dictionary: PackedDictionary,
  word: string,
  options: {
    alphabet?: string;
    corrections?: ReadonlyMap<string, string>;
    limit?: number;
  } = {},
): string[] {
  const alphabet = options.alphabet ?? UYGHUR_LETTERS;
  const limit = options.limit ?? MAX_SUGGESTIONS;
  const normalized = normalizeForLookup(word);
  if (!normalized || normalized.length < 2) return [];

  /** Words we can point at: listed, hand-collected, or a valid inflection. */
  const candidates: Candidate[] = [];
  /** Forms this function assembled and cannot otherwise vouch for. */
  const constructed: Candidate[] = [];

  const add = (term: string, frequency?: number) => {
    if (term && term !== normalized) candidates.push({ term, frequency });
  };

  /**
   * A morphology result, filed by how much evidence stands behind it.
   *
   * `plausible` says the repair itself was a slip people actually make. A
   * constructed form that fails even that is dropped outright rather than kept
   * as a fallback — «چوقۇپلاشقان» came from swapping ر for پ, a pair never
   * observed once, and no amount of having nothing better to offer makes it a
   * word.
   */
  const offer = (term: string, frequency: number, plausible: boolean) => {
    if (!term || term === normalized) return;
    if (hasWord(dictionary, term) || accepts(dictionary, term)) {
      candidates.push({ term, frequency });
    } else if (plausible) {
      constructed.push({ term, frequency });
    }
  };

  // 1. The curated table. The floor is one step above the busiest corpus
  // bucket, so a hand-collected pair outranks anything the edit search finds at
  // the same distance without being able to beat a strictly closer word.
  const known = options.corrections?.get(normalized);
  if (known) add(known, 16);

  // 2. One arbitrary edit — the single slip, which really is arbitrary.
  const once = editsOnce(normalized, alphabet);
  for (const candidate of once) {
    if (hasWord(dictionary, candidate)) add(candidate);
  }

  // 3. Two edits, always, never gated on the first step having failed. The
  // second step is composed of realistic edits rather than arbitrary ones; see
  // editsAgain for the measurement that settled it.
  const realistic = editsAgain(normalized);
  for (const candidate of realistic) {
    if (hasWord(dictionary, candidate)) add(candidate);
    for (const further of editsAgain(candidate)) {
      if (further !== normalized && hasWord(dictionary, further)) add(further);
    }
  }

  // 4. Morphology, both directions.
  //
  // This is the one path that BUILDS a string rather than finding one, so every
  // result is a claim that a word exists, and the claim has to be backed. Two
  // buckets: candidates we can vouch for, and constructed forms we cannot.
  for (const { stem, suffix } of splits(dictionary, normalized)) {
    if (!hasWord(dictionary, stem)) {
      // The stem is wrong: fix it and put the writer's own suffix back.
      // «قالدور|مىغۇدەك» → «قالدۇر» + «مىغۇدەك».
      //
      // The repair must be a KNOWN CONFUSION, and that is a hard condition
      // rather than a preference. Any other single edit turns the stem into a
      // DIFFERENT WORD, and bolting the writer's suffix onto a different word
      // is not a spelling correction — it is how «چوقۇرلاشقان» came back as
      // «چوقۇپلاشقان» and «چوقۇملاشقان», neither of which exists. Nothing is
      // lost by the strictness either: if repairing the stem by one edit
      // produces a word that IS listed, then editing the whole word by one edit
      // produces it too, and step 2 above has already found it.
      for (const repaired of editsOnce(stem, alphabet)) {
        if (!isConfusionRepair(stem, repaired)) continue;
        if (!hasWord(dictionary, repaired)) continue;
        offer(repaired + suffix, frequencyOf(dictionary, repaired), true);
      }
    } else {
      // The stem is fine, so the suffix is the suspect.
      // «تەۋە|لىنگەن» → «تەۋە» + «لەنگەن».
      for (const replacement of nearestSuffixes(suffix)) {
        offer(stem + replacement, frequencyOf(dictionary, stem), true);
      }
    }
  }

  // WORDS WE CAN VOUCH FOR COME FIRST, AND ALONE.
  //
  // A constructed form is only shown when nothing evidenced was found at all.
  // That single rule is what stopped the checker offering «چوقۇپلاشقان»,
  // «تەۋەسىنگەن» and «جەمئىگۈچى» — none of which are words in any language, and
  // all of which appeared next to a perfectly good answer the writer could not
  // see for the noise. Where there IS no evidenced answer, a repair built from
  // a real stem and the writer's own suffix is better than an empty popup: that
  // is how «قالدۇرمىغۇدەك» is reached, a correct word the list simply lacks.
  const usable = candidates.length > 0 ? candidates : constructed;
  const ranked = rankCandidates(dictionary, normalized, usable, limit);
  if (ranked.length > 0) return ranked;

  // Last resort, from the desktop (spellcheck.js line 174): the longest prefix
  // that is itself a word. Only ever reached when nothing above answered.
  for (let length = normalized.length - 1; length >= 3; length--) {
    const stem = normalized.slice(0, length);
    if (hasWord(dictionary, stem)) return [stem];
  }
  return [];
}
