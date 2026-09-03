/**
 * Glyph codepoints, folded back into letters.
 *
 * Unicode carries two blocks of Arabic PRESENTATION FORMS — one codepoint per
 * drawn shape of a letter, so ق has four of them depending on where it stands
 * in the word. They exist only so that legacy encodings can round-trip; text is
 * supposed to be stored as letters and shaped at display time. Some Word
 * installations save Uyghur that way regardless, and the result looks perfect
 * on screen and is a different string to every computer that reads it: it is
 * invisible to search, it groups as its own author, and it is unusable when a
 * reader copies it out.
 *
 * One book in this library (989, «قاراخانىيلار خانلىقى ۋە قارلۇقلار») arrived
 * like that — 80% of its characters were glyph codepoints — which is what this
 * module was written for. `scripts/normalize-presentation-forms.mjs` repaired
 * that book; the extraction pipeline calls `normalizeImportedText` so no new
 * one can arrive the same way.
 *
 * THE ONE THING NOT TO DO HERE is run `normalize("NFKC")` over a whole string.
 * NFKC also expands the religious ligatures: ﷲ (U+FDF2) becomes four
 * characters, ﷺ (U+FDFA) becomes the eighteen-character phrase it stands for.
 * Those are legitimately used — this library holds 58,749 ﷲ and 437 ﷺ — so the
 * fold below is applied per character, and only to characters inside the two
 * letter ranges. U+FDF0–U+FDFD is left alone by construction.
 */

/** Arabic Presentation Forms-B: every Arabic letter, one codepoint per shape. */
const FORMS_B_FIRST = 0xfe70;
const FORMS_B_LAST = 0xfeff;

/**
 * Arabic Presentation Forms-A, the LETTER range. The block continues past
 * U+FBFF into the word ligatures and, at U+FDF0–U+FDFD, the religious ones;
 * neither belongs in a letter fold, so the range stops here.
 */
const FORMS_A_FIRST = 0xfb50;
const FORMS_A_LAST = 0xfbff;

/** ARABIC LETTER AE — the Uyghur vowel «ە». */
const AE = "\u06d5";

/**
 * The heh forms that are really an AE.
 *
 * AE has presentation forms of its own (U+FBEC, U+FBED), but the encoders that
 * produced this text never used them: they wrote the HEH forms, because the two
 * letters are drawn identically when they stand alone or end a word. NFKC
 * therefore hands them back as ARABIC LETTER HEH (ه U+0647) — a letter that is
 * not in the Uyghur alphabet at all — and «دۆلەت» comes back as «دۆلهت», still
 * wrong on the page and still unsearchable.
 *
 * Joining behaviour tells the two apart. HEH joins on both sides, so a heh with
 * a letter after it is written U+FEEB (initial) or U+FEEC (medial), which are
 * left to NFKC and stay ه. AE joins backwards only, so it can never be anything
 * but U+FEE9 (isolated) or U+FEEA (final) — the two mapped here.
 *
 * Measured in book 989 before the repair: 227 heh forms, every one of them
 * isolated or final and not one initial or medial, on pages that already
 * carried six plain ە and no plain ه at all.
 */
const AE_FROM_HEH_FORM: Record<string, string> = {
  "\ufee9": AE, // ARABIC LETTER HEH ISOLATED FORM
  "\ufeea": AE, // ARABIC LETTER HEH FINAL FORM
};

/** Is this codepoint a drawn shape of a letter rather than the letter itself? */
function isPresentationForm(codePoint: number): boolean {
  return (
    (codePoint >= FORMS_B_FIRST && codePoint <= FORMS_B_LAST) ||
    (codePoint >= FORMS_A_FIRST && codePoint <= FORMS_A_LAST)
  );
}

/**
 * Replace every glyph codepoint with the letter (or letters) it stands for.
 *
 * Everything outside the two letter ranges is copied through untouched, so the
 * religious ligatures, the ornate parentheses ﴾ ﴿ and ordinary text all come
 * out exactly as they went in.
 *
 * The only characters that change LENGTH are the lam-alef ligatures
 * U+FEF5–U+FEFC, one codepoint standing for two letters; each of those adds
 * exactly one character. The repair script asserts that, which is how it knows
 * a row it is about to write is the row it read.
 */
export function foldPresentationForms(input: string | null | undefined): string {
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

/**
 * What the import pipeline stores: letters, in canonical form.
 *
 * NFC is the safe, lossless normal form and is what stored text should be — it
 * composes a letter and its mark into the single codepoint a reader's keyboard
 * would have produced — and it is applied AFTER the fold so anything the fold
 * emits is composed too. Text that is already ordinary Uyghur comes back
 * unchanged, character for character.
 */
export function normalizeImportedText(input: string | null | undefined): string {
  if (!input) return "";
  return foldPresentationForms(input).normalize("NFC");
}
