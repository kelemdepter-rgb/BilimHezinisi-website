import { isSingleToken } from "@/lib/spellcheck/dictionary";

/**
 * «بۇ خاتىرىدە سەل قارا» — a word accepted in ONE note (PROMPT-48).
 *
 * A false positive used to have one answer, the personal dictionary, which
 * accepts the word in every note for good. A name, a quoted spelling or a
 * deliberate dialect form is often right in one note and a real mistake
 * anywhere else, so it can now be accepted where it stands and nowhere else.
 *
 * Kept in this browser, like the personal dictionary and for the same reason:
 * a few words per note, not worth a table, a migration and a round trip on
 * every open. The key carries the account and the note, so two people
 * sharing a browser never see each other's lists — and the account's lists
 * go when the account does (lib/notes/drafts.ts finishPendingDeletion). The
 * user id is a storage namespace, never a permission.
 */

export const IGNORE_PREFIX = "bh-spell-ignore:";
/** Plenty for any real note; a ceiling so one note cannot fill the storage. */
export const MAX_IGNORED_PER_NOTE = 500;

/** The slice of the Web Storage API this file uses — injectable for tests. */
export type IgnoreStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function ignoreKey(userId: string, noteId: number): string {
  return `${IGNORE_PREFIX}${userId}:${noteId}`;
}

/** The words accepted in this note. Anything stored that is not a word is left out. */
export function readIgnored(storage: IgnoreStorage | null, userId: string, noteId: number): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ignoreKey(userId, noteId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const words = parsed.filter((word): word is string => typeof word === "string" && isSingleToken(word));
    return [...new Set(words)].slice(0, MAX_IGNORED_PER_NOTE);
  } catch {
    return [];
  }
}

/**
 * `words` with `word` added — the same list when it is already there, and
 * null when it is refused: not one word, or the note's list is full.
 */
export function withIgnored(words: readonly string[], word: string): string[] | null {
  if (!isSingleToken(word)) return null;
  if (words.includes(word)) return [...words];
  if (words.length >= MAX_IGNORED_PER_NOTE) return null;
  return [...words, word];
}

/** False when the browser refused to keep it; it then lasts as long as the page. */
export function writeIgnored(
  storage: IgnoreStorage | null,
  userId: string,
  noteId: number,
  words: readonly string[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ignoreKey(userId, noteId), JSON.stringify(words));
    return true;
  } catch {
    return false;
  }
}

/** Every note's list of one account, after the account is deleted. Others stay. */
export function clearAccountIgnores(storage: IgnoreStorage | null, userId: string): number {
  if (!storage) return 0;
  try {
    const own = `${IGNORE_PREFIX}${userId}:`;
    const doomed: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(own)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
    return doomed.length;
  } catch {
    return 0;
  }
}
