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
