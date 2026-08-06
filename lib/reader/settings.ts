/** Reader typography settings, persisted locally and applied instantly. */

export type ReaderFont = "ukij" | "trad" | "bahij";

export type ReaderSettings = {
  fontSize: number;
  lineHeight: number;
  font: ReaderFont;
};

export const FONT_STACKS: Record<ReaderFont, string> = {
  ukij: "'UKIJ Ekran', 'Traditional Arabic', serif",
  trad: "'Traditional Arabic', 'UKIJ Ekran', serif",
  bahij: "'Bahij Nazanin', 'UKIJ Ekran', serif",
};

export const FONT_LABELS: Record<ReaderFont, string> = {
  ukij: "UKIJ Ekran",
  trad: "Traditional Arabic",
  bahij: "Bahij Nazanin",
};

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
    font: font === "trad" || font === "bahij" ? font : DEFAULT_SETTINGS.font,
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
