/**
 * How the notebook page itself is set: face, size and line height.
 *
 * The desktop applies these to the SELECTION («خەت نۇسخىسى», «خەت چوڭلۇقى»,
 * «قۇر ئارىلىقى» in src/notes.js). This applies them to the whole editor
 * instead, and that is a deliberate difference rather than a shortcut:
 *
 *  - PROMPT 16 asks for the choice to be remembered per user, and a per-word
 *    inline style is not a preference — it is content, and it would travel to
 *    every reader of an exported file whether they wanted it or not;
 *  - on a phone the selection is the hardest thing to hold on to. A control
 *    that needs one is a control that mostly does nothing;
 *  - it costs the note nothing: not one byte of styling is stored, so the same
 *    note read on a small screen at 20px and on a laptop at 15px is one note.
 *
 * Inserted Qur'an verses carry their own inline `font-family`, so the Uthmani
 * face survives regardless of what is chosen here — see lib/notes/insert.ts.
 *
 * Only fonts this project may serve are offered, which is why the list is the
 * reader's own list rather than a new one (THIRD-PARTY-NOTICES.md).
 */
import { FONT_LABELS, FONT_STACKS, READER_FONTS, type ReaderFont } from "@/lib/reader/settings";

export type NoteTypography = {
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
};

export const NOTE_FONTS = READER_FONTS;
export const NOTE_FONT_LABELS = FONT_LABELS;
export const NOTE_FONT_STACKS = FONT_STACKS;

export const MIN_NOTE_SIZE = 14;
export const MAX_NOTE_SIZE = 28;
export const MIN_NOTE_LEADING = 1.4;
export const MAX_NOTE_LEADING = 2.6;

export const DEFAULT_TYPOGRAPHY: NoteTypography = {
  font: "ukij",
  fontSize: 16,
  lineHeight: 1.9,
};

export const TYPOGRAPHY_STORAGE_KEY = "bh-note-typography";

function isNoteFont(value: unknown): value is ReaderFont {
  return typeof value === "string" && value in FONT_STACKS;
}

export function clampTypography(input: Partial<NoteTypography> | null | undefined): NoteTypography {
  const fontSize = Number(input?.fontSize);
  const lineHeight = Number(input?.lineHeight);
  return {
    // A face that no longer exists — one removed over its licence — falls back
    // to the default rather than rendering an empty picker.
    font: isNoteFont(input?.font) ? input.font : DEFAULT_TYPOGRAPHY.font,
    fontSize: Number.isFinite(fontSize)
      ? Math.min(Math.max(Math.round(fontSize), MIN_NOTE_SIZE), MAX_NOTE_SIZE)
      : DEFAULT_TYPOGRAPHY.fontSize,
    lineHeight: Number.isFinite(lineHeight)
      ? Math.min(Math.max(Number(lineHeight.toFixed(2)), MIN_NOTE_LEADING), MAX_NOTE_LEADING)
      : DEFAULT_TYPOGRAPHY.lineHeight,
  };
}

export function readStoredTypography(): NoteTypography {
  if (typeof window === "undefined") return DEFAULT_TYPOGRAPHY;
  try {
    const raw = window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
    return raw ? clampTypography(JSON.parse(raw) as Partial<NoteTypography>) : DEFAULT_TYPOGRAPHY;
  } catch {
    return DEFAULT_TYPOGRAPHY;
  }
}

export function writeStoredTypography(typography: NoteTypography): void {
  try {
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(typography));
  } catch {
    // Private mode or a full quota — the choice lasts for this session only.
  }
}
