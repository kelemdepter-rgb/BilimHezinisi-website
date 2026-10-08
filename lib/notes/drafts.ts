/**
 * The notebook's write-ahead copy (PROMPT-43).
 *
 * Every change to a note is written to this browser before it is sent, and
 * removed only once the server has confirmed that exact content. Whatever
 * happens between — a dropped connection, a closed tab, a phone switching
 * apps, a database that stopped answering — the writing is still here when
 * the note is opened again.
 *
 * The key carries the account: two people sharing one browser never see each
 * other's unsaved work in the app. The user id in it is a storage namespace
 * and nothing more — the server decides who owns a note, every time.
 */

export const DRAFT_PREFIX = "bh-note-draft-v2:";
/** Before PROMPT-43: the raw HTML, one key per note, no account and no base. */
const LEGACY_KEY = /^bh-note-draft-(\d+)$/;

export type DraftRecord = {
  v: 2;
  userId: string;
  noteId: number;
  title: string;
  html: string;
  /** The server version this text was written on; null when unknown. */
  baseUpdatedAt: string | null;
  revision: number;
  writtenAt: number;
  /** Which open copy of the note wrote it, so another one never removes it. */
  tab: string;
};

/** The slice of the Web Storage API this file uses — injectable for tests. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/**
 * localStorage, or null where the browser refuses it (private modes, blocked
 * site data). Merely reading `window.localStorage` can throw.
 */
export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function draftKey(userId: string, noteId: number): string {
  return `${DRAFT_PREFIX}${userId}:${noteId}`;
}

export function legacyDraftKey(noteId: number): string {
  return `bh-note-draft-${noteId}`;
}

function isDraft(value: unknown, userId: string, noteId: number): value is DraftRecord {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    draft.v === 2 &&
    draft.userId === userId &&
    draft.noteId === noteId &&
    typeof draft.title === "string" &&
    typeof draft.html === "string" &&
    (draft.baseUpdatedAt === null || typeof draft.baseUpdatedAt === "string") &&
    typeof draft.revision === "number" &&
    typeof draft.writtenAt === "number" &&
    typeof draft.tab === "string"
  );
}

export function readDraft(
  storage: DraftStorage | null,
  userId: string,
  noteId: number,
): DraftRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(userId, noteId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed, userId, noteId) ? parsed : null;
  } catch {
    return null;
  }
}

/** False when the copy could not be written — quota, or storage refused. */
export function writeDraft(storage: DraftStorage | null, draft: DraftRecord): boolean {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(draft.userId, draft.noteId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove this note's copy — only the one `tab` wrote, when given.
 *
 * Two tabs on one note share the key. A tab whose save succeeded must not
 * delete the copy a second, stale tab wrote while its own save was refused.
 */
export function removeDraft(
  storage: DraftStorage | null,
  userId: string,
  noteId: number,
  tab?: string,
): void {
  if (!storage) return;
  try {
    if (tab !== undefined) {
      const current = readDraft(storage, userId, noteId);
      if (current && current.tab !== tab) return;
    }
    storage.removeItem(draftKey(userId, noteId));
  } catch {
    // Nothing to clean up where storage is refused.
  }
}

/** The pre-PROMPT-43 copy of a note, if one is still here. */
export function readLegacyDraft(storage: DraftStorage | null, noteId: number): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(legacyDraftKey(noteId));
  } catch {
    return null;
  }
}

export function removeLegacyDraft(storage: DraftStorage | null, noteId: number): void {
  if (!storage) return;
  try {
    storage.removeItem(legacyDraftKey(noteId));
  } catch {
    // Best effort.
  }
}

function allKeys(storage: DraftStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/**
 * After an account is deleted: its copies, and every copy from before
 * accounts were part of the key (those cannot be told apart, and the person
 * who just deleted their notebook is the likeliest owner). Another account's
 * copies on the same browser stay.
 */
export function clearAccountDrafts(storage: DraftStorage | null, userId: string): number {
  if (!storage) return 0;
  try {
    const own = `${DRAFT_PREFIX}${userId}:`;
    const doomed = allKeys(storage).filter((key) => key.startsWith(own) || LEGACY_KEY.test(key));
    for (const key of doomed) storage.removeItem(key);
    return doomed.length;
  } catch {
    return 0;
  }
}

/**
 * The account a deletion was asked for, kept for the page the server sends
 * the browser to once it is done. sessionStorage, so it never outlives the
 * tab, and only the confirmation page reads it — a deletion the server
 * refused leaves every copy where it was.
 */
export const PENDING_DELETION_KEY = "bh-account-deletion";

export function rememberPendingDeletion(userId: string): void {
  try {
    window.sessionStorage.setItem(PENDING_DELETION_KEY, userId);
  } catch {
    // Without it the copies stay — the safe direction to fail in.
  }
}

/** On the "account deleted" page: drop that account's copies, once. */
export function finishPendingDeletion(): void {
  try {
    const userId = window.sessionStorage.getItem(PENDING_DELETION_KEY);
    if (!userId) return;
    window.sessionStorage.removeItem(PENDING_DELETION_KEY);
    clearAccountDrafts(browserStorage(), userId);
  } catch {
    // Storage refused: nothing was written there either.
  }
}
