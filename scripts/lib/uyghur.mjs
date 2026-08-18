/**
 * The Uyghur alphabet and word rules, for build scripts.
 *
 * These constants are duplicated from lib/spellcheck/dictionary.ts on purpose:
 * the scripts are plain .mjs run by node with no bundler, and the TypeScript
 * modules use the "@/" path alias that only next/vitest resolve. The copy is
 * held honest by tests/unit/script-parity.test.ts, which fails if the two ever
 * disagree — the same arrangement the SQL/matcher parity test uses.
 */

/** UEYHerpler, verbatim from the desktop (Uyghur.cs line 301). */
export const UYGHUR_LETTERS = "ـئابتجخدرزسشغفقكلمنوىيپچژڭگھۆۇۈۋېەلا";

/** MainForm.cs line 93: words may join with a hyphen. */
export const WORD_PATTERN = new RegExp(
  `[${UYGHUR_LETTERS}'’]+(?:[-]?[${UYGHUR_LETTERS}'’]+)*`,
  "gu",
);

const ONLY_UYGHUR = new RegExp(`^[${UYGHUR_LETTERS}'’-]+$`, "u");

/** Arabic tatweel — stripped before any lookup, as the desktop's SOZGHUCH does. */
const TATWEEL = "ـ";

export function normalizeForLookup(word) {
  return String(word ?? "").split(TATWEEL).join("").trim().toLowerCase();
}

/** Whether a token is worth counting or checking at all. */
export function isCheckable(word) {
  const normalized = normalizeForLookup(word);
  if (!normalized || normalized.length < 2) return false;
  if (/^[\d\s]+$/.test(normalized)) return false;
  if (/^[a-zA-Z'’-]+$/.test(normalized)) return false;
  return ONLY_UYGHUR.test(normalized);
}

/** Every checkable word of a text, normalised. */
export function wordsOf(text) {
  const out = [];
  WORD_PATTERN.lastIndex = 0;
  let match;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const word = normalizeForLookup(match[0]);
    if (isCheckable(word)) out.push(word);
  }
  return out;
}

/**
 * The 34 characters the dictionary actually contains — 33 Uyghur letters and
 * the hyphen that joins compounds. Counted from the built artifact, and
 * re-verified on every build: a character outside this table is a hard error,
 * never a silently dropped or corrupted word.
 *
 * ORDER IS LOAD-BEARING. The codes are assigned in Unicode code-point order, so
 * comparing two encoded words byte by byte gives exactly the same answer as
 * comparing the words as strings. That is what lets the binary search over the
 * packed dictionary keep working unchanged across the encoding change — the
 * artifact stays sorted in the order it always was. Ordering the codes by
 * letter frequency instead would have saved nothing and broken the search.
 */
export const DICT_ALPHABET = [
  "-", "ئ", "ا", "ب", "ت", "ج", "خ", "د", "ر", "ز", "س", "ش",
  "غ", "ف", "ق", "ك", "ل", "م", "ن", "و", "ى", "ي", "پ", "چ",
  "ژ", "ڭ", "گ", "ھ", "ۆ", "ۇ", "ۈ", "ۋ", "ې", "ە",
];

/** IsSozuq, from the desktop's Uyghur.cs by way of spellcheck.js line 50. */
export const UYGHUR_VOWELS = new Set(["ا", "ە", "و", "ۇ", "ۆ", "ۈ", "ې", "ى"]);

/**
 * Does this look like a word written in Uyghur orthography at all?
 *
 * The published library is mostly religious writing, so a sixth of the corpus
 * tokens are ARABIC — «ال», «ول», «ان», «لي», «وس». Arabic uses no letter Uyghur
 * does not, so nothing in `isCheckable` can tell them apart, and left unfiltered
 * they would be admitted to the dictionary as "well attested" (ال occurs 88,785
 * times across all 15 books) and would then make the checker accept real Uyghur
 * misspellings that happen to look like them.
 *
 * Two rules separate them, and neither is a guess — both were verified to hold
 * on ALL 441,322 words of the shipped dictionary, with zero exceptions:
 *
 *   1. Every Uyghur word contains a vowel letter. Arabic writes short vowels as
 *      diacritics or not at all, so «لي», «ين», «بن» have none.
 *   2. No Uyghur word begins with a bare vowel. Uyghur spells a word-initial
 *      vowel as ئ plus the vowel — «ئالما», never «الما» — so any token starting
 *      with ا و ى ې ە ۇ ۆ ۈ is Arabic.
 *
 * Used only to decide what the CORPUS may contribute (vocabulary admissions and
 * evaluation sets). It is deliberately not part of `isCheckable`: refusing to
 * check a word is a false accept, and this filter is tuned to be strict about
 * what it lets IN, not about what it waves through.
 */
export function looksUyghur(word) {
  const chars = [...word];
  if (chars.length < 3) return false;
  if (UYGHUR_VOWELS.has(chars[0])) return false;
  return chars.some((char) => UYGHUR_VOWELS.has(char));
}

/** Only the 34 characters the dictionary encoding can represent. */
const IN_ALPHABET = new Set(DICT_ALPHABET);
export function encodable(word) {
  return [...word].every((char) => IN_ALPHABET.has(char));
}
