/**
 * "Too many people are searching right now" — the one answer a search may
 * give under a flood (PROMPT-40).
 *
 * Two things say it, and both say it the same way to the reader:
 *   - the database: every expensive anonymous search must hold one of a few
 *     slots (migration 0028), and when none is free it ends at once with
 *     SQLSTATE PT429 and the message `bh:search_busy`. PostgREST turns that
 *     into HTTP 429, and supabase-js hands back `{ code: "PT429", message:
 *     "bh:search_busy" }`. This is what holds against a flood from many
 *     addresses at once;
 *   - this server's own per-address brake, SEARCH_RULE in lib/rate-limit.ts,
 *     which answers before the database is asked at all.
 *
 * A plain module — no server-only import — because the reader's navigator
 * calls the database from the browser and has to recognise the same answer.
 */

/** The SQLSTATE migration 0028 raises; PostgREST maps `PTxyz` to HTTP xyz. */
export const SEARCH_BUSY_CODE = "PT429";

/** The message it carries — machine-readable on purpose, never shown. */
export const SEARCH_BUSY_MESSAGE = "bh:search_busy";

/**
 * What the reader is told. Calm on purpose: nothing is broken, and trying
 * again in a moment works.
 */
export const SEARCH_BUSY_TEXT = "ھازىر ئىزدەۋاتقانلار كۆپ. بىر نەچچە سېكۇنتتىن كېيىن قايتا سىناڭ.";

/** True for the database's "every slot is in use" answer, whatever carried it. */
export function isSearchBusy(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === SEARCH_BUSY_CODE || error.message === SEARCH_BUSY_MESSAGE;
}
