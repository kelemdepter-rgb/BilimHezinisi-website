/**
 * The credit that has to travel with a quoted verse.
 *
 * The Qur'an module redistributes two texts under licences that both require
 * attribution — the Tanzil Uthmani text (CC BY 3.0) and the QuranEnc Uyghur
 * translation. PROMPT 13 put that credit under the mushaf
 * (components/quran/source-note.tsx). A note that quotes a verse is another
 * copy of those texts, and an exported or printed note leaves this site
 * entirely, so the credit goes with it.
 *
 * One line per document rather than one under every verse: the obligation is
 * to name the source, not to repeat it until the note is unreadable. The
 * wording is the same as the mushaf's, deliberately.
 */
export const QURAN_ATTRIBUTION =
  "قۇرئان تېكىستى مەنبەسى: ئەرەبچە ئەسلى تېكىست — Tanzil Project (CC BY 3.0)، ھېچ ئۆزگەرتىلمىگەن؛ " +
  "ئۇيغۇرچە تەرجىمە — شەيخ مۇھەممەد سالىھ، QuranEnc.com نەشرى (v1.0.2-xml.1).";

/** How the DOCX export and the print view spot a note that quotes a verse. */
export const UTHMANIC_MARKER = "Uthmanic Hafs";
