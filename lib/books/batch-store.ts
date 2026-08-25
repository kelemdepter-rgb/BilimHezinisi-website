/**
 * The typing survives the tab.
 *
 * Entering title, author, description, category and status for twenty books is
 * an hour of somebody's evening. A closed tab, a reload, a phone that decided
 * to reclaim memory — any of them would otherwise take all of it. So every
 * keystroke of metadata is written to IndexedDB, keyed by filename plus size,
 * and re-selecting the same files restores what was typed.
 *
 * A file handle itself cannot be persisted (the browser will not hand out
 * lasting access to a file the user picked once), and it does not need to be:
 * re-picking the folder takes a second, and it is the metadata that took the
 * evening.
 *
 * Everything here fails soft. Private mode, a blocked database, a quota — all
 * of them mean "no recovery this time", never a broken import screen.
 */
import type { BatchMeta } from "@/lib/books/batch";

const DB_NAME = "bh-batch-import";
const DB_VERSION = 1;
const STORE = "metadata";

/** A saved batch older than this is somebody else's abandoned evening. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type SavedRow = { id: string; meta: BatchMeta; savedAt: number };

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Firefox in private mode never settles either handler.
    request.onblocked = () => resolve(null);
  });
}

function finish(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

/** Write the metadata for the rows given, replacing what was there. */
export async function saveBatchMeta(rows: { id: string; meta: BatchMeta }[]): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const savedAt = Date.now();
    for (const row of rows) store.put({ id: row.id, meta: row.meta, savedAt } satisfies SavedRow);
    await finish(transaction);
  } catch {
    // Nothing recoverable to do: the import itself still works.
  } finally {
    database.close();
  }
}

/** Everything saved, by row key, with anything long abandoned dropped. */
export async function loadBatchMeta(): Promise<Record<string, BatchMeta>> {
  const database = await openDatabase();
  if (!database) return {};
  try {
    const rows = await new Promise<SavedRow[]>((resolve) => {
      try {
        const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
        request.onsuccess = () => resolve((request.result as SavedRow[]) ?? []);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });

    const cutoff = Date.now() - MAX_AGE_MS;
    const fresh: Record<string, BatchMeta> = {};
    const stale: string[] = [];
    for (const row of rows) {
      if (row.savedAt < cutoff) stale.push(row.id);
      else fresh[row.id] = row.meta;
    }
    if (stale.length > 0) {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const id of stale) store.delete(id);
      await finish(transaction);
    }
    return fresh;
  } catch {
    return {};
  } finally {
    database.close();
  }
}

/** How many rows are waiting to be recovered, for the notice on the page. */
export async function countBatchMeta(): Promise<number> {
  return Object.keys(await loadBatchMeta()).length;
}

/** Throw the saved batch away, at the admin's explicit request. */
export async function clearBatchMeta(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    await finish(transaction);
  } catch {
    // Already gone, or never there.
  } finally {
    database.close();
  }
}

/** Forget just the rows that were imported, leaving the rest recoverable. */
export async function forgetBatchRows(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const id of ids) store.delete(id);
    await finish(transaction);
  } catch {
    // Leaving a stale row behind is harmless: it expires on its own.
  } finally {
    database.close();
  }
}
