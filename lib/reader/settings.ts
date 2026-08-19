/** Reader typography settings, persisted locally and applied instantly. */

/**
 * Every entry here is either a font this project may redistribute (the UKIJ
 * family, LGPL — served from /fonts) or one resolved from the reader's own
 * operating system. "Traditional Arabic" is the latter: it ships with Windows
 * as a Monotype font that may not be redistributed, so it is named in the
 * stack but no file is served and no @font-face declares it. Readers on
 * Windows get the exact face they always did; everyone else falls through to
 * UKIJ Ekran. Never add a "bahij" option back — see THIRD-PARTY-NOTICES.md.
 */
export type ReaderFont = "ukij" | "tuz" | "tuztom" | "tuzkitab" | "trad";

export type ReaderSettings = {
  fontSize: number;
  lineHeight: number;
  font: ReaderFont;
};

export const FONT_STACKS: Record<ReaderFont, string> = {
  ukij: "'UKIJ Ekran', 'Traditional Arabic', serif",
  tuz: "'UKIJ Tuz', 'UKIJ Ekran', serif",
  tuztom: "'UKIJ Tuz Tom', 'UKIJ Ekran', serif",
  tuzkitab: "'UKIJ Tuz Kitab', 'UKIJ Ekran', serif",
  trad: "'Traditional Arabic', 'UKIJ Ekran', serif",
};

export const FONT_LABELS: Record<ReaderFont, string> = {
  ukij: "UKIJ Ekran",
  tuz: "UKIJ Tuz",
  tuztom: "UKIJ Tuz Tom",
  tuzkitab: "UKIJ Tuz Kitab",
  trad: "Traditional Arabic",
};

export const READER_FONTS = Object.keys(FONT_LABELS) as ReaderFont[];

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 32;
export const MIN_LINE_HEIGHT = 1.6;
export const MAX_LINE_HEIGHT = 2.8;

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 2.1,
  font: "ukij",
};

export const SETTINGS_STORAGE_KEY = "bh-reader-settings";

function isReaderFont(value: unknown): value is ReaderFont {
  return typeof value === "string" && value in FONT_STACKS;
}

export function clampSettings(input: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  const fontSize = Number(input?.fontSize);
  const lineHeight = Number(input?.lineHeight);
  const font = input?.font;
  return {
    fontSize: Number.isFinite(fontSize)
      ? Math.min(Math.max(Math.round(fontSize), MIN_FONT_SIZE), MAX_FONT_SIZE)
      : DEFAULT_SETTINGS.fontSize,
    lineHeight: Number.isFinite(lineHeight)
      ? Math.min(Math.max(Number(lineHeight.toFixed(2)), MIN_LINE_HEIGHT), MAX_LINE_HEIGHT)
      : DEFAULT_SETTINGS.lineHeight,
    /**
     * A font that no longer exists — "bahij", removed for its licence —
     * silently becomes the default rather than throwing or rendering an
     * empty picker. Readers who had it selected notice nothing but a
     * different face.
     */
    font: isReaderFont(font) ? font : DEFAULT_SETTINGS.font,
  };
}

export function readStoredSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? clampSettings(JSON.parse(raw) as Partial<ReaderSettings>) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeStoredSettings(settings: ReaderSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota — settings simply do not persist.
  }
}
