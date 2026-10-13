import { DEFAULT_NOTE_SORT, isNoteSort, type NoteSort } from "@/lib/notes/list-sort";

/**
 * The list's chosen order, remembered in this browser — an external store
 * like the notebook's typography (lib/notes/typography-store.ts) for the
 * same reason: localStorage does not exist during SSR, so the server renders
 * the default and the browser adopts the stored choice on the first commit.
 *
 * A convenience only: unreadable storage (a private window, blocked site
 * data) simply means the default order.
 */
export const NOTE_SORT_KEY = "bh-notes-sort";

let cached: NoteSort | null = null;
const listeners = new Set<() => void>();

function readStored(): NoteSort {
  try {
    const stored = window.localStorage.getItem(NOTE_SORT_KEY);
    return isNoteSort(stored) ? stored : DEFAULT_NOTE_SORT;
  } catch {
    return DEFAULT_NOTE_SORT;
  }
}

export function subscribeNoteSort(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getNoteSortSnapshot(): NoteSort {
  cached ??= readStored();
  return cached;
}

export function getNoteSortServerSnapshot(): NoteSort {
  return DEFAULT_NOTE_SORT;
}

export function setNoteSort(sort: NoteSort): void {
  cached = sort;
  try {
    window.localStorage.setItem(NOTE_SORT_KEY, sort);
  } catch {
    // Remembered for this visit only.
  }
  for (const listener of listeners) listener();
}
