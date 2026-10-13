import { NOTE_TRASH_DAYS } from "@/lib/notes/limits";
import { SAVE_MESSAGES, versionMicros, type SaveCode } from "@/lib/notes/save-protocol";

/**
 * What the notebook's list and trash (PROMPT-47) answer, shared by their
 * Server Actions and the pages. A plain module for the same reason as
 * lib/notes/save-protocol.ts: a `"use server"` file may only export async
 * functions.
 *
 * The codes are the save's own (stage 2); only the sentences differ — on the
 * list there is no unsent text to reassure anyone about.
 */

export type ListCode = Extract<SaveCode, "needs_account" | "not_found" | "failed" | "rate">;

export type ListFailure = { ok: false; code: ListCode; error: string };

export const LIST_MESSAGES: Record<ListCode, string> = {
  needs_account: "خاتىرە يېزىش ئۈچۈن ھېساباتقا كىرىڭ.",
  not_found: "بۇ خاتىرە تېپىلمىدى.",
  failed: SAVE_MESSAGES.failed,
  // Only the search is rate-limited (NOTE_SEARCH_RULE).
  rate: "بەك تېز ئىزدەۋاتىسىز. بىر ئازدىن كېيىن قايتا سىناڭ.",
};

export function listFailure(code: ListCode): ListFailure {
  return { ok: false, code, error: LIST_MESSAGES[code] };
}

/** The search box asks from this many characters, trimmed (search_my_notes). */
export const SEARCH_MIN_CHARS = 2;
/** …and to this many; longer finds nothing (search_my_notes). */
export const SEARCH_MAX_CHARS = 100;
/** Typing pauses this long before a search goes out. */
export const SEARCH_DEBOUNCE_MS = 300;

/** How long «قايتۇرۇش» stays beside a note just moved to the trash. */
export const TRASH_UNDO_MS = 10_000;

export const SEARCH_EMPTY = "بۇ سۆز ھېچقايسى خاتىرىدە يوق.";
export const MOVED_TO_TRASH = "ئەخلەت ساندۇقىغا يۆتكەلدى.";
/** The read-only banner says what a refused save says. */
export const IN_TRASH = SAVE_MESSAGES.in_trash;
export const TRASH_EMPTY = "ئەخلەت ساندۇقى بوش.";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days until a note in the trash is deleted for good, never below one:
 * a note opened in its last hours still reads «1 كۈندىن كېيىن». Opening the
 * trash removes the ones whose time is up (lib/notes/data.ts openTrash).
 */
export function trashDaysLeft(deletedAt: string, now: number = Date.now()): number {
  // PostgREST prints microseconds, which not every engine's Date.parse takes.
  const micros = versionMicros(deletedAt);
  if (micros === null) return NOTE_TRASH_DAYS;
  return Math.max(1, Math.ceil((micros / 1000 + NOTE_TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

export function trashCountdown(days: number): string {
  return `${days} كۈندىن كېيىن مەڭگۈلۈك ئۆچىدۇ`;
}
