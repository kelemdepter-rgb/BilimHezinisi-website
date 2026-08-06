/**
 * Client-side twin of the SQL `ug_normalize()` (migration 0002), so in-book
 * search matches the same text the database index would.
 *
 * Deliberately mirrors the desktop `normalizeArabicQuery`: strip diacritics,
 * marks and tatweel, unify alif variants, lowercase. Alif maqsura (ى) and ta
 * marbuta (ة) are LEFT ALONE — ى is the Uyghur vowel "i" and folding it into ي
 * would merge two distinct letters.
 *
 * Every transform is per-character (or deletes a character), which is what
 * lets findMatches map normalized offsets back to the original text.
 */
const DIACRITICS = /[ً-ٰۖ-ۭ࣓-ࣿـ]/;

const ALIF_VARIANTS: Record<string, string> = {
  "ٱ": "ا", // ٱ
  "آ": "ا", // آ
  "أ": "ا", // أ
  "إ": "ا", // إ
};

export function ug_normalize_client(input: string): string {
  if (!input) return "";
  let out = "";
  for (const char of input) {
    if (DIACRITICS.test(char)) continue;
    out += (ALIF_VARIANTS[char] ?? char).toLowerCase();
  }
  return out;
}
