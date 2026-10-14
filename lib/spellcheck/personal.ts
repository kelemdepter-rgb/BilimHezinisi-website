import { isSingleToken } from "@/lib/spellcheck/dictionary";

/**
 * The personal dictionary: the words one writer told the checker are right
 * (PROMPT-48 D).
 *
 * It lives in this browser, not in Postgres — a list of a few dozen words
 * for most writers, a few thousand at most, for which a table would add a
 * migration, an RLS policy and a round trip on every note open. So it does
 * not follow the writer to another device by itself; the panel exports it as
 * a JSON file and imports one, and that is how it moves.
 *
 * An imported file is untrusted input. Nothing in it is executed or rendered
 * as HTML: it is parsed as JSON, and only strings that are exactly one word
 * as the checker reads words survive.
 */

export const PERSONAL_KEY = "bh-personal-dictionary";
/** However many a writer adds, by hand or by importing. */
export const MAX_PERSONAL_WORDS = 5000;
export const MIN_WORD_CHARS = 2;
export const MAX_WORD_CHARS = 64;
/** A full dictionary of 64-character words is ~1.3 MB; anything larger is not one. */
export const MAX_IMPORT_BYTES = 2_000_000;
export const EXPORT_FILE_NAME = "bilim-hezinisi-lughet.json";

/** Exactly one word, as the checker reads words, of 2–64 characters. */
export function isPersonalWord(value: unknown): value is string {
  if (typeof value !== "string" || !isSingleToken(value)) return false;
  const length = [...value].length;
  return length >= MIN_WORD_CHARS && length <= MAX_WORD_CHARS;
}

/**
 * What is stored, read back. Tolerant: it was written by this site, so it is
 * the writer's list as it is — older entries the import rules would refuse
 * are shown, so they can be seen and deleted, rather than silently dropped.
 */
export function parsePersonal(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((word): word is string => typeof word === "string" && word !== ""))];
  } catch {
    return [];
  }
}

export type ImportResult =
  | { ok: true; words: string[]; added: number; rejected: number }
  | { ok: false; reason: "not_json" | "not_array" };

/**
 * A chosen file's text merged into `existing`. Every entry that is not one
 * word of 2–64 characters is rejected; a word already there, or twice in the
 * file, is simply dropped; and whatever would take the dictionary past 5,000
 * words is rejected too, so the count the writer is told adds up.
 */
export function mergeImport(existing: readonly string[], text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "not_array" };

  const words = [...existing];
  const present = new Set(existing);
  let added = 0;
  let rejected = 0;
  for (const entry of parsed) {
    if (!isPersonalWord(entry)) {
      rejected += 1;
      continue;
    }
    if (present.has(entry)) continue;
    if (words.length >= MAX_PERSONAL_WORDS) {
      rejected += 1;
      continue;
    }
    present.add(entry);
    words.push(entry);
    added += 1;
  }
  return { ok: true, words, added, rejected };
}

/** The file «چىقىرىش» downloads: a JSON array of strings, one word a line. */
export function exportPersonal(words: readonly string[]): string {
  return `${JSON.stringify(words, null, 2)}\n`;
}
