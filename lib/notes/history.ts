/**
 * Earlier versions of a note, kept on this device only (PROMPT-46).
 *
 * Autosave overwrites the note on the server every few seconds, so a mistaken
 * deletion, a replace-all, an AI correction or «مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا
 * قويۇش» would be permanent the moment it saved. Each of them first leaves a
 * version here, and «ئىلگىرىكى نۇسخىلار» puts any of them back.
 *
 * In IndexedDB, never in Supabase: a server-side history would multiply every
 * note's size inside the 500 MB free database. On the writer's own device it
 * costs the site nothing, works offline and never leaves the device.
 *
 * Everything here fails soft. A browser without IndexedDB, a private window
 * that refuses it, a full disk or a database that never opens: each answer
 * says "unavailable", nothing throws, and nothing in the save path ever waits
 * on it — the editor starts a write and moves on.
 */

export const HISTORY_DB = "bh-notebook";
const DB_VERSION = 1;
const VERSIONS = "versions";
/** One running total, so a write never has to read every version to size the store. */
const META = "meta";
const TOTAL_KEY = "bytes";

/** [userId, noteId, at]: one note's versions, oldest first. */
const BY_NOTE = "by-note";
/** [userId, noteId, reason, at]: a note's newest `auto` version, read from its key alone. */
const BY_NOTE_REASON = "by-note-reason";
/** [reason, at]: the oldest `auto` versions of every note, for eviction. */
const BY_REASON = "by-reason";
/** at: the oldest versions of any reason, for eviction. */
const BY_AT = "by-at";

export const MAX_VERSIONS_PER_NOTE = 30;
export const MAX_HISTORY_BYTES = 20 * 1024 * 1024;
/** An `auto` version is taken at most this often per note. */
export const AUTO_EVERY_MS = 5 * 60_000;
/** Some engines have been known never to answer an open; the editor will not wait. */
const OPEN_TIMEOUT_MS = 3000;

export const VERSION_REASONS = [
  "open",
  "auto",
  "before-replace-all",
  "before-ai",
  "before-restore",
  "before-conflict",
] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

export type NoteVersion = {
  id: number;
  userId: string;
  noteId: number;
  /** When it was taken, ms since the epoch. */
  at: number;
  title: string;
  html: string;
  /** Its length as text, for the list. */
  chars: number;
  reason: VersionReason;
};

export type VersionInput = { userId: string; noteId: number; title: string; html: string };

/** `same`: identical to the newest version of the note; `recent`: an `auto` too soon. */
export type KeepOutcome = "kept" | "same" | "recent" | "unavailable";

export type VersionList = { ok: true; versions: NoteVersion[] } | { ok: false };

export type HistoryUsage = { ok: true; bytes: number; count: number } | { ok: false };

export type HistoryDeps = {
  /** The factory, or undefined where there is none (or touching it throws). */
  indexedDB(): IDBFactory | undefined;
  now(): number;
};

/** What a version is reckoned to cost: two bytes a character, title and HTML. */
export function versionSize(version: { title: string; html: string }): number {
  return 2 * (version.title.length + version.html.length);
}

/** The note as text, for the list's «… ھەرپ». */
function textLength(html: string): number {
  if (typeof DOMParser !== "undefined") {
    try {
      // An inert document: nothing in the HTML loads or runs while it is read.
      return new DOMParser().parseFromString(html, "text/html").body.textContent?.length ?? 0;
    } catch {
      // Fall through to the rough count.
    }
  }
  return html.replace(/<[^>]*>/g, "").length;
}

function noteRange(userId: string, noteId: number): IDBKeyRange {
  return IDBKeyRange.bound([userId, noteId, -Infinity], [userId, noteId, Infinity]);
}

/** One request's answer as a promise — awaited inside its transaction, which stays open. */
function answer<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("request failed"));
  });
}

/**
 * Run `work` in one transaction and resolve once it has COMMITTED — a write
 * is only kept when the transaction completes, not when its last request
 * succeeded. Anything thrown aborts it, so a half-done eviction never lands.
 */
function inTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([VERSIONS, META], mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("transaction failed"));
    work(transaction).then(
      (value) => {
        result = value;
      },
      (error: unknown) => {
        try {
          transaction.abort();
        } catch {
          // Already finished; its own handler has answered.
        }
        reject(error);
      },
    );
  });
}

function upgrade(database: IDBDatabase, transaction: IDBTransaction | null): void {
  if (!database.objectStoreNames.contains(VERSIONS)) {
    const versions = database.createObjectStore(VERSIONS, { keyPath: "id", autoIncrement: true });
    versions.createIndex(BY_NOTE, ["userId", "noteId", "at"]);
    versions.createIndex(BY_NOTE_REASON, ["userId", "noteId", "reason", "at"]);
    versions.createIndex(BY_REASON, ["reason", "at"]);
    versions.createIndex(BY_AT, "at");
  }
  if (!database.objectStoreNames.contains(META)) {
    database.createObjectStore(META);
    transaction?.objectStore(META).put(0, TOTAL_KEY);
  }
}

/** The bytes the store holds, as recorded — counted afresh if the record is missing. */
async function readTotal(transaction: IDBTransaction): Promise<number> {
  const recorded = await answer(transaction.objectStore(META).get(TOTAL_KEY));
  if (typeof recorded === "number" && Number.isFinite(recorded) && recorded >= 0) return recorded;
  let total = 0;
  const request = transaction.objectStore(VERSIONS).openCursor();
  for (let cursor = await answer(request); cursor; cursor = await answer(request)) {
    total += versionSize(cursor.value as NoteVersion);
    cursor.continue();
  }
  return total;
}

/** The id of a note's newest version, read from the index key alone. */
async function newestId(transaction: IDBTransaction, userId: string, noteId: number): Promise<number | null> {
  const index = transaction.objectStore(VERSIONS).index(BY_NOTE);
  const cursor = await answer(index.openKeyCursor(noteRange(userId, noteId), "prev"));
  return cursor ? (cursor.primaryKey as number) : null;
}

/**
 * Over 30 for this note: the oldest `auto` versions go first, then the oldest
 * of any reason — never the newest. Returns the bytes freed.
 */
async function trimNote(transaction: IDBTransaction, userId: string, noteId: number): Promise<number> {
  const store = transaction.objectStore(VERSIONS);
  const range = noteRange(userId, noteId);
  const count = await answer(store.index(BY_NOTE).count(range));
  let excess = count - MAX_VERSIONS_PER_NOTE;
  if (excess <= 0) return 0;

  const all: { id: number; reason: VersionReason; size: number }[] = [];
  const request = store.index(BY_NOTE).openCursor(range);
  for (let cursor = await answer(request); cursor; cursor = await answer(request)) {
    const version = cursor.value as NoteVersion;
    all.push({ id: version.id, reason: version.reason, size: versionSize(version) });
    cursor.continue();
  }
  const candidates = all.slice(0, -1); // never the newest
  const order = [...candidates.filter((v) => v.reason === "auto"), ...candidates.filter((v) => v.reason !== "auto")];

  let freed = 0;
  for (const victim of order) {
    if (excess <= 0) break;
    store.delete(victim.id);
    freed += victim.size;
    excess -= 1;
  }
  return freed;
}

/**
 * Over 20 MB for the whole store: the oldest `auto` versions of every note go
 * first, then the oldest of any reason — never a note's newest version.
 * Returns the total afterwards.
 */
async function trimStore(transaction: IDBTransaction, total: number): Promise<number> {
  if (total <= MAX_HISTORY_BYTES) return total;
  const store = transaction.objectStore(VERSIONS);
  const newest = new Map<string, number | null>();

  async function isNewest(version: NoteVersion): Promise<boolean> {
    const key = JSON.stringify([version.userId, version.noteId]);
    if (!newest.has(key)) newest.set(key, await newestId(transaction, version.userId, version.noteId));
    return newest.get(key) === version.id;
  }

  async function sweep(request: IDBRequest<IDBCursorWithValue | null>) {
    for (let cursor = await answer(request); cursor && total > MAX_HISTORY_BYTES; cursor = await answer(request)) {
      const version = cursor.value as NoteVersion;
      if (!(await isNewest(version))) {
        cursor.delete();
        total -= versionSize(version);
      }
      cursor.continue();
    }
  }

  await sweep(store.index(BY_REASON).openCursor(IDBKeyRange.bound(["auto", -Infinity], ["auto", Infinity])));
  if (total > MAX_HISTORY_BYTES) await sweep(store.index(BY_AT).openCursor());
  return Math.max(total, 0);
}

/** Keep `input` as the note's newest version, unless it is the newest already. */
async function keepIn(
  transaction: IDBTransaction,
  input: VersionInput & { reason: VersionReason },
  now: number,
): Promise<KeepOutcome> {
  const store = transaction.objectStore(VERSIONS);
  const range = noteRange(input.userId, input.noteId);
  const newestCursor = await answer(store.index(BY_NOTE).openCursor(range, "prev"));
  const newest = (newestCursor?.value as NoteVersion | undefined) ?? null;
  if (newest && newest.title === input.title && newest.html === input.html) {
    // Not stored twice — but a note opened and at once replaced-all is found
    // under «ئالماشتۇرۇشتىن بۇرۇن», the name the writer will look for, not
    // under «ئېچىلغاندا». Only an `open` or `auto` label gives way.
    if (input.reason.startsWith("before-") && (newest.reason === "open" || newest.reason === "auto")) {
      await answer(newestCursor!.update({ ...newest, reason: input.reason }));
    }
    return "same";
  }

  const version: Omit<NoteVersion, "id"> = {
    userId: input.userId,
    noteId: input.noteId,
    // Strictly after the note's newest, so "newest" never depends on a tie.
    at: Math.max(now, (newest?.at ?? Number.NEGATIVE_INFINITY) + 1),
    title: input.title,
    html: input.html,
    chars: textLength(input.html),
    reason: input.reason,
  };
  // Read before the new version is in, or a recount would include it twice.
  let total = await readTotal(transaction);
  await answer(store.add(version));
  total += versionSize(version);
  total -= await trimNote(transaction, input.userId, input.noteId);
  total = await trimStore(transaction, total);
  transaction.objectStore(META).put(total, TOTAL_KEY);
  return "kept";
}

export function createNoteHistory(deps: HistoryDeps) {
  /** A fresh connection per call: writes are rare, and nothing is left holding a lock. */
  function open(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (database: IDBDatabase | null) => {
        if (settled) {
          database?.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(database);
      };
      const timer = setTimeout(() => settle(null), OPEN_TIMEOUT_MS);

      let request: IDBOpenDBRequest;
      try {
        const factory = deps.indexedDB();
        if (!factory) {
          settle(null);
          return;
        }
        request = factory.open(HISTORY_DB, DB_VERSION);
      } catch {
        settle(null);
        return;
      }
      request.onupgradeneeded = () => {
        try {
          upgrade(request.result, request.transaction);
        } catch {
          request.transaction?.abort();
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        // Another tab upgrading or deleting it: step aside rather than block it.
        database.onversionchange = () => database.close();
        settle(database);
      };
      request.onerror = () => settle(null);
      request.onblocked = () => settle(null);
    });
  }

  async function withDatabase<T>(
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T | null> {
    const database = await open();
    if (!database) return null;
    try {
      return await inTransaction(database, mode, work);
    } catch {
      return null;
    } finally {
      database.close();
    }
  }

  return {
    /** Keep the note as it is now, for `reason`. */
    async keep(input: VersionInput & { reason: VersionReason }): Promise<KeepOutcome> {
      const outcome = await withDatabase("readwrite", (transaction) => keepIn(transaction, input, deps.now()));
      return outcome ?? "unavailable";
    },

    /**
     * After a save the server confirmed: an `auto` version, if the note's
     * newest `auto` is at least five minutes old (or there is none yet).
     */
    async keepAuto(input: VersionInput): Promise<KeepOutcome> {
      const outcome = await withDatabase("readwrite", async (transaction): Promise<KeepOutcome> => {
        const now = deps.now();
        const autos = IDBKeyRange.bound(
          [input.userId, input.noteId, "auto", -Infinity],
          [input.userId, input.noteId, "auto", Infinity],
        );
        const index = transaction.objectStore(VERSIONS).index(BY_NOTE_REASON);
        const last = await answer(index.openKeyCursor(autos, "prev"));
        const lastAt = last ? ((last.key as [string, number, string, number])[3] ?? 0) : null;
        if (lastAt !== null && now - lastAt < AUTO_EVERY_MS) return "recent";
        return keepIn(transaction, { ...input, reason: "auto" }, now);
      });
      return outcome ?? "unavailable";
    },

    /** One note's versions, newest first. */
    async list(userId: string, noteId: number): Promise<VersionList> {
      const versions = await withDatabase("readonly", async (transaction) => {
        const found = await answer(
          transaction.objectStore(VERSIONS).index(BY_NOTE).getAll(noteRange(userId, noteId)),
        );
        return (found as NoteVersion[]).reverse();
      });
      return versions ? { ok: true, versions } : { ok: false };
    },

    /** How much the whole store holds, for /my/account. */
    async measure(): Promise<HistoryUsage> {
      const usage = await withDatabase("readonly", async (transaction) => ({
        bytes: await readTotal(transaction),
        count: await answer(transaction.objectStore(VERSIONS).count()),
      }));
      return usage ? { ok: true, ...usage } : { ok: false };
    },

    /** Every version of every note on this device — sign-out, account deletion, «تازىلاش». */
    async clearAll(): Promise<boolean> {
      const done = await withDatabase("readwrite", async (transaction) => {
        transaction.objectStore(VERSIONS).clear();
        transaction.objectStore(META).put(0, TOTAL_KEY);
        return true;
      });
      return done === true;
    },
  };
}

export type NoteHistory = ReturnType<typeof createNoteHistory>;

/** This browser's history. Touching `indexedDB` can itself throw, so it is asked lazily. */
export const noteHistory: NoteHistory = createNoteHistory({
  indexedDB: () => {
    try {
      return typeof indexedDB === "undefined" ? undefined : indexedDB;
    } catch {
      return undefined;
    }
  },
  now: () => Date.now(),
});

/**
 * Empty the store on the way out, waiting at most `withinMs`: signing out is
 * never held up, and never refused, because of it.
 */
export function forgetNoteHistory(withinMs: number, history: NoteHistory = noteHistory): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, withinMs);
    history.clearAll().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}
