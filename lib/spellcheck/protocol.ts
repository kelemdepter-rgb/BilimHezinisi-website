/** Messages between the notebook and the spellcheck worker. */

export type ToWorker =
  | { type: "init"; dictUrl: string; correctionsUrl: string }
  | { type: "personal"; words: string[] }
  | { type: "check"; id: number; words: string[] }
  | { type: "suggest"; id: number; word: string };

export type FromWorker =
  | { type: "ready"; words: number; loadMs: number; fromCache: boolean }
  /** The dictionary could not be fetched. Writing continues without it. */
  | { type: "failed"; reason: string }
  | { type: "checked"; id: number; wrong: string[] }
  | { type: "suggestions"; id: number; word: string; list: string[] };

/** Where the built artifact is served from — Vercel's CDN, not Supabase. */
export const DICT_URL = "/spellcheck/uyghur-dict.bin";
export const CORRECTIONS_URL = "/spellcheck/corrections.json";
/**
 * Bumped when the artifact changes, so a stale copy is not served forever.
 * v2 is the byte-encoded dictionary: a browser holding the old text file would
 * fail the magic-number check, and this retires it instead.
 */
export const CACHE_NAME = "bh-spelldict-v2";
