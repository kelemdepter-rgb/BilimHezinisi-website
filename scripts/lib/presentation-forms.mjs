/**
 * Glyph codepoints, folded back into letters — for scripts.
 *
 * Duplicated from lib/books/presentation-forms.ts on purpose, and for the same
 * reason as scripts/lib/uyghur.mjs: the scripts are plain .mjs run by node with
 * no bundler. The copy is held honest by tests/unit/presentation-forms.test.ts,
 * which runs both implementations over the same strings and fails on the first
 * disagreement.
 *
 * Read the TypeScript module for why this is a per-character fold and not
 * `normalize("NFKC")` over the whole string: NFKC expands ﷲ and ﷺ into the
 * phrases they stand for, and this library holds tens of thousands of them.
 */

const FORMS_B_FIRST = 0xfe70;
const FORMS_B_LAST = 0xfeff;
const FORMS_A_FIRST = 0xfb50;
const FORMS_A_LAST = 0xfbff;

const AE = "\u06d5";

/** The two heh forms that are really a Uyghur AE — see the TypeScript twin. */
const AE_FROM_HEH_FORM = {
  "\ufee9": AE, // ARABIC LETTER HEH ISOLATED FORM
  "\ufeea": AE, // ARABIC LETTER HEH FINAL FORM
};

export function isPresentationForm(codePoint) {
  return (
    (codePoint >= FORMS_B_FIRST && codePoint <= FORMS_B_LAST) ||
    (codePoint >= FORMS_A_FIRST && codePoint <= FORMS_A_LAST)
  );
}

export function foldPresentationForms(input) {
  if (!input) return "";
  let out = "";
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!isPresentationForm(codePoint)) {
      out += character;
      continue;
    }
    out += AE_FROM_HEH_FORM[character] ?? character.normalize("NFKC");
  }
  return out;
}

export function normalizeImportedText(input) {
  if (!input) return "";
  return foldPresentationForms(input).normalize("NFC");
}

export function presentationFormShare(input) {
  let forms = 0;
  let total = 0;
  for (const character of input ?? "") {
    total += 1;
    if (isPresentationForm(character.codePointAt(0) ?? 0)) forms += 1;
  }
  return { forms, total, share: total === 0 ? 0 : forms / total };
}

/**
 * The lam-alef ligatures — the ONLY characters the fold makes longer, one
 * codepoint standing for two letters. The repair script checks every expansion
 * it is about to write against this range, so an unexpected one (a religious
 * ligature leaking into the fold, say, which would add seventeen characters)
 * stops the write instead of silently rewriting the book.
 */
export const LAM_ALEF_FIRST = 0xfef5;
export const LAM_ALEF_LAST = 0xfefc;

/**
 * How much of a row must be glyph codepoints before it is worth rewriting.
 *
 * Measured across the whole library on 2026-09-03: the one damaged book runs
 * 80.2%–90.3% per row, and the healthiest page that carries a form at all is a
 * single character in 176,565 — 0.05% of its page. Nothing sits between the
 * two, so any threshold in that gap picks the same rows; 20% is far from both
 * and keeps a stray glyph in a healthy page from being a reason to rewrite it.
 *
 * Overridable with --threshold on the repair script for a library this was not
 * measured against.
 */
export const CANDIDATE_SHARE = 0.2;

/** Is this row damaged enough to be worth repairing? */
export function isCandidate(text, threshold = CANDIDATE_SHARE) {
  const { forms, share } = presentationFormShare(text);
  return forms > 0 && share >= threshold;
}

/**
 * The religious ligatures — ﷲ ﷺ ﷻ ﷽ and the rest of the block.
 *
 * Never folded, and counted before and after every repair: these are ordinary
 * content in this library, and NFKC would expand one of them into a phrase of
 * up to eighteen characters.
 */
export const SACRED_FIRST = 0xfdf0;
export const SACRED_LAST = 0xfdfd;

export function countSacredLigatures(text) {
  let n = 0;
  for (const character of text ?? "") {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= SACRED_FIRST && codePoint <= SACRED_LAST) n += 1;
  }
  return n;
}
