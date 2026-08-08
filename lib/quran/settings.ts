/**
 * Which languages the mushaf shows. Typography (font size, line height,
 * theme) comes from the reader's own settings so the two reading surfaces
 * stay in step — this file only adds what the Quran needs on top.
 */

export type TranslationMode = "both" | "ar" | "ug";

export const TRANSLATION_MODES: TranslationMode[] = ["both", "ar", "ug"];

export const TRANSLATION_LABELS: Record<TranslationMode, string> = {
  both: "ئەرەبچە + تەرجىمە",
  ar: "پەقەت ئەرەبچە",
  ug: "پەقەت تەرجىمە",
};

export const DEFAULT_TRANSLATION_MODE: TranslationMode = "both";

export const QURAN_SETTINGS_KEY = "bh-quran-settings";

export function isTranslationMode(value: unknown): value is TranslationMode {
  return value === "both" || value === "ar" || value === "ug";
}

/**
 * Arabic needs far more room than the Uyghur prose around it: tashkil sits
 * above and below the line. These ratios reproduce the desktop's 28 px / 15 px
 * pairing from the reader's default 18 px body size.
 */
export const ARABIC_SIZE_RATIO = 1.55;
export const TRANSLATION_SIZE_RATIO = 0.92;
/** Fixed, generous leading so vowel marks never collide (desktop: 2.2). */
export const ARABIC_LINE_HEIGHT = 2.2;
