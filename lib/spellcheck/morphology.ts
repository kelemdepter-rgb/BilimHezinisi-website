/**
 * Uyghur word structure: taking a word apart, and putting it back together.
 *
 * THE PROBLEM THIS SOLVES. Uyghur is agglutinative — a stem takes chains of
 * suffixes — so the set of valid words is unbounded and no list can hold it.
 * The shipped dictionary has 441,322 forms and contains five of «قالدۇر»'s six,
 * which is not a gap to patch by adding a word: it is proof that enumeration
 * cannot cover the language. UyghurEdit++, the mature checker this project was
 * ported from, has the same list-only design and red-underlines «تەۋەلەنگەن»
 * and «قالدۇرمىغۇدەك» — both perfectly ordinary Uyghur. That is the failure
 * being fixed here, and it is why there was no external tool to copy.
 *
 * ACCEPTANCE AND SUGGESTION ARE SEPARATE, AND DELIBERATELY SO.
 *
 *   `accepts` decides an unlisted word is nonetheless correct. Every rule it
 *   relaxes is a chance to wave a real misspelling through, so it uses the
 *   narrow suffix tier and three learned constraints on top, and it was tuned
 *   against a negative set of 4,000 realistic misspellings rather than against
 *   how much coverage it bought.
 *
 *   `splits` only takes a word apart so a correction can be offered. A
 *   candidate added to a ranked list cannot make the checker accept anything,
 *   so it uses the wide tier. This asymmetry is the whole trick: the risky
 *   half stays small while the useful half stays generous.
 *
 * The two field cases arrive by different routes, which is the point:
 *   «قالدورمىغۇدەك» — the STEM is wrong. Split at «مىغۇدەك», fix «قالدور» to
 *                     «قالدۇر» through the ordinary dictionary search, reattach.
 *   «تەۋەلىنگەن»   — the SUFFIX is wrong. The stem «تەۋە» is a real word and
 *                     «لىنگەن» is not a suffix; the nearest one that is, is
 *                     «لەنگەن». Correcting the stem would have done nothing.
 */
import { ACCEPT_SUFFIXES, MAX_SUFFIX, MIN_STEM, SUGGEST_SUFFIXES } from "./suffixes.generated";
import { hasWord, isKnownStem, type PackedDictionary } from "./dictionary";
import { CONFUSABLE_WITH } from "./confusion";

const BACK = new Set(["ا", "و", "ۇ"]);
const FRONT = new Set(["ە", "ې", "ۆ", "ۈ"]);

/**
 * Back or front, from the last vowel that commits to either.
 *
 * ى is neutral in Uyghur — it appears in both classes — so it is skipped rather
 * than counted, and a word with no committed vowel at all constrains nothing.
 */
export function harmonyOf(word: string): "back" | "front" | "neutral" {
  for (let index = word.length - 1; index >= 0; index--) {
    const char = word[index];
    if (BACK.has(char)) return "back";
    if (FRONT.has(char)) return "front";
  }
  return "neutral";
}

type AcceptRule = { harmony: "" | "back" | "front"; after: string };

const ACCEPT: ReadonlyMap<string, AcceptRule> = new Map(
  ACCEPT_SUFFIXES.map(([suffix, harmony, after]) => [suffix, { harmony, after }]),
);

const SUGGEST: ReadonlySet<string> = new Set(SUGGEST_SUFFIXES);

/**
 * Is this suffix legal on this stem?
 *
 * Two learned constraints, and between them they are what keeps the false
 * accept rate down where a productivity threshold alone could not:
 *
 *   harmony   «گە» goes on front stems and «غا» on back ones. A misspelling
 *             that decomposes across a harmony boundary is not Uyghur.
 *   boundary  the shape follows the sound the stem ends in — «دا» after a
 *             voiced final, «تا» after a voiceless one. Without this the
 *             checker accepted «ئالغانتا» for «ئالغاندا».
 */
function suffixFits(stem: string, rule: AcceptRule): boolean {
  if (rule.harmony !== "") {
    const harmony = harmonyOf(stem);
    if (harmony !== "neutral" && harmony !== rule.harmony) return false;
  }
  return rule.after.includes(stem[stem.length - 1]);
}

/**
 * Is this unlisted word a correctly formed inflection of a word we know?
 *
 * The stem must be one the library actually uses or one the dictionary itself
 * inflects widely — not merely present. That distinction matters more than it
 * looks: most false accepts came from splits that used some obscure dictionary
 * entry as a stem, and requiring the stem to be a word in real use removed them
 * without touching the genuine inflections.
 *
 * One suffix, not a chain. Chaining was measured and rejected: it bought 4.4
 * points of paradigm coverage for a third more false accepts, and the statistics
 * that would justify a chain — which suffix may follow which — are not
 * something this dictionary can support honestly.
 */
export function accepts(dictionary: PackedDictionary, word: string): boolean {
  for (let take = 2; take <= MAX_SUFFIX && take < word.length; take++) {
    const stem = word.slice(0, word.length - take);
    if (stem.length < MIN_STEM) break;
    const rule = ACCEPT.get(word.slice(word.length - take));
    if (!rule) continue;
    if (!suffixFits(stem, rule)) continue;
    if (isKnownStem(dictionary, stem)) return true;
  }
  return false;
}

export type Split = { stem: string; suffix: string };

/**
 * Every way this word could come apart, for the suggestion path only.
 *
 * Both halves are offered: splits where the tail IS a known suffix (so the stem
 * is the thing to fix) and splits where the stem IS a known word (so the tail
 * is). A word can appear in both lists, and that is fine — the ranking decides.
 */
export function splits(dictionary: PackedDictionary, word: string): Split[] {
  const out: Split[] = [];
  for (let take = 2; take <= MAX_SUFFIX && take < word.length; take++) {
    const stem = word.slice(0, word.length - take);
    if (stem.length < MIN_STEM) break;
    const suffix = word.slice(word.length - take);
    if (SUGGEST.has(suffix) || hasWord(dictionary, stem)) out.push({ stem, suffix });
  }
  return out;
}

/**
 * Is `b` the same string as `a` with exactly one letter swapped for one the
 * corrections data says people really confuse it with?
 *
 * This is the difference between repairing a misspelling and inventing a word.
 * «قالدور» → «قالدۇر» swaps و for ۇ, the fifth most common error there is.
 * «چوقۇر» → «چوقۇپ» swaps ر for پ, a pair never once observed in 3,400 real
 * corrections — those are two different words, not two spellings of one, and
 * gluing a suffix onto the second produced «چوقۇپلاشقان», which is not Uyghur.
 */
export function isConfusionRepair(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let at = -1;
  for (let index = 0; index < a.length; index++) {
    if (a[index] === b[index]) continue;
    if (at >= 0) return false;
    at = index;
  }
  if (at < 0) return false;
  return (CONFUSABLE_WITH.get(a[at]) ?? []).includes(b[at]);
}

/**
 * Known suffixes within one CONFUSION of this tail, most productive first.
 *
 * Deliberately narrow, and narrower than it was: same length, one character
 * different, and that one character has to be a pair writers actually mix up.
 * Without the last condition «لىنگەن» also matched «سىنگەن» and «كىنگەن» —
 * ل↔س and ل↔ك appear nowhere in the corrections data — and the checker offered
 * «تەۋەسىنگەن» and «تەۋەكىنگەن», which are not words in any language.
 */
export function nearestSuffixes(suffix: string, limit = 4): string[] {
  const out: string[] = [];
  for (const known of SUGGEST_SUFFIXES) {
    if (known.length !== suffix.length || known === suffix) continue;
    if (!isConfusionRepair(suffix, known)) continue;
    out.push(known);
    if (out.length >= limit) break;
  }
  return out;
}

/** Exposed for the evaluation report. */
export const ACCEPT_SUFFIX_COUNT = ACCEPT.size;
export const SUGGEST_SUFFIX_COUNT = SUGGEST.size;
