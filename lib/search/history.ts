/**
 * Recent searches, kept in the reader's own browser and nowhere else.
 *
 * This is a privacy decision before it is a technical one. What somebody
 * searches for in a library is the most revealing thing they produce here —
 * more so than which books they open — and on a free plan with no way to
 * promise anything about server logs, the honest answer is not to have the
 * data at all. So there is no table, no column and no request: the list lives
 * in localStorage, the reader can delete any entry or all of them, and
 * clearing it clears it completely.
 *
 * The desktop app keeps its history in SQLite on the reader's own machine
 * (`db-search-history`), which is the same promise in a different place.
 */

export const HISTORY_STORAGE_KEY = "bh-search-history";

/** Short on purpose: a list nobody scrolls, and less to leave behind. */
export const HISTORY_LIMIT = 8;

/** Longer than this is a paste, not a search worth offering again. */
const MAX_QUERY = 120;

export type SearchHistoryEntry = {
  query: string;
  /** Epoch milliseconds, so the list can be shown newest first. */
  at: number;
};

function isEntry(value: unknown): value is SearchHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<SearchHistoryEntry>;
  return typeof entry.query === "string" && entry.query !== "" && typeof entry.at === "number";
}

export function readSearchHistory(): SearchHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).sort((a, b) => b.at - a.at).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function write(entries: SearchHistoryEntry[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    else window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private mode or a full quota. History is a convenience; losing it is
    // not worth an error in front of a reader.
  }
}

/** Record one search. Searching the same thing again moves it to the top. */
export function rememberSearch(query: string): void {
  if (typeof window === "undefined") return;
  const trimmed = query.trim().slice(0, MAX_QUERY);
  if (!trimmed) return;
  const rest = readSearchHistory().filter((entry) => entry.query !== trimmed);
  write([{ query: trimmed, at: Date.now() }, ...rest].slice(0, HISTORY_LIMIT));
}

export function forgetSearch(query: string): SearchHistoryEntry[] {
  if (typeof window === "undefined") return [];
  const next = readSearchHistory().filter((entry) => entry.query !== query);
  write(next);
  return next;
}

/** Erase the lot. Nothing is left behind, including the key itself. */
export function clearSearchHistory(): void {
  if (typeof window === "undefined") return;
  write([]);
}
