/**
 * What in a note is quoted material rather than the writer's own words.
 *
 * A link is how a citation is anchored (lib/notes/insert.ts), and the Uthmani
 * face is only ever applied to an inserted verse — so both are exact tests
 * for "this is quoted material", never a guess. Neither is the writer's
 * spelling to fix: the AI proofreader never sends it (lib/ai/note-blocks.ts),
 * and the spellchecker never marks a word inside it (PROMPT-48). One
 * definition, so the two can never disagree about what a quotation is.
 */

/** An inserted Qur'an verse: the Arabic, in the Uthmani face. */
export const AYA_SELECTOR = '[style*="Uthmanic Hafs"]';

/** A citation's link, or a verse. */
export const QUOTED_SELECTOR = `a[href], ${AYA_SELECTOR}`;
