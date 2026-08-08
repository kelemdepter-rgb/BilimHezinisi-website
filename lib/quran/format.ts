/** Display helpers for the mushaf, ported from desktop src/quran.js. */

import type { Sura } from "@/lib/quran/types";

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** 255 → ٢٥٥ — aya numbers are shown in Arabic-Indic digits, as on desktop. */
export function toArabicNumerals(value: number | string): string {
  return String(value)
    .split("")
    .map((char) => (/\d/.test(char) ? ARABIC_INDIC_DIGITS[Number(char)] : char))
    .join("");
}

/**
 * The basmala as the Uthmani Hafs text spells it. The seeder strips this
 * prefix from aya 1 of every sura that carries it (stripBasmalaPrefix), so
 * the mushaf renders it once, as a heading.
 */
export const BASMALA = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ";

/**
 * Al-Fatiha opens with the basmala as its own first aya, and At-Tawba has no
 * basmala at all — every other sura gets the heading.
 */
export function showsBasmala(suraNumber: number): boolean {
  return suraNumber !== 1 && suraNumber !== 9;
}

export function revelationLabel(revelation: string): string {
  return revelation === "medinan" ? "مەدىنىدە چۈشۈرۈلگەن" : "مەككىدە چۈشۈرۈلگەن";
}

/** Matches Arabic name, Uyghur name, transliteration or sura number. */
export function filterSuras(suras: Sura[], filter: string): Sura[] {
  const trimmed = filter.trim();
  if (!trimmed) return suras;
  const lower = trimmed.toLowerCase();
  return suras.filter(
    (sura) =>
      sura.name_ar.includes(trimmed) ||
      sura.name_ug.toLowerCase().includes(lower) ||
      sura.name_translit.toLowerCase().includes(lower) ||
      String(sura.number).includes(trimmed),
  );
}
