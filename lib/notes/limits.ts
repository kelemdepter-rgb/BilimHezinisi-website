/**
 * A note is text. The cap is generous for writing and small enough that a
 * runaway paste cannot fill the free tier: at ~184 KB per imported book, one
 * note is worth about a third of one.
 *
 * It lives here rather than beside the Server Actions because a `"use server"`
 * module may only export async functions — exporting a constant from one makes
 * the whole module invalid.
 */
export const MAX_NOTE_CHARS = 60_000;

/**
 * What one account's notebook may hold (PROMPT-44, decided by the owner on
 * 2026-10-07): 200 notes and 5 MB, counted as the UTF-8 bytes of each note's
 * title, HTML and plain text together.
 *
 * The DATABASE enforces both — supabase/migrations/0030_note_quota.sql, whose
 * `note_quota_max_notes()` and `note_quota_max_bytes()` return these same
 * numbers (tests/unit/note-quota-sql.test.ts holds the two to each other).
 * These copies only let the page say where a writer stands and word the
 * refusals; changing them here changes nothing that is enforced.
 */
export const NOTE_QUOTA_MAX_NOTES = 200;
export const NOTE_QUOTA_MAX_BYTES = 5 * 1024 * 1024;

/**
 * How long a note waits in the trash before it is deleted for good
 * (PROMPT-47). supabase/migrations/0031_note_list.sql's `note_trash_days()`
 * is what the daily purge uses; tests/unit/note-list-sql.test.ts holds the
 * two to each other. This copy words «N كۈندىن كېيىن مەڭگۈلۈك ئۆچىدۇ».
 */
export const NOTE_TRASH_DAYS = 30;
