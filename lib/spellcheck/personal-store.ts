import { PERSONAL_KEY, parsePersonal } from "@/lib/spellcheck/personal";

/**
 * The personal dictionary as an external store, the shape of the notebook's
 * typography (lib/notes/typography-store.ts): localStorage does not exist
 * during SSR, so the server renders an empty list and the browser adopts the
 * stored one on the first commit.
 *
 * One list for the whole page — the popup's «لۇغەتكە قوش», the panel and the
 * running checker all read and write it here — and for every tab: a change
 * made in another tab arrives through the storage event.
 */

const EMPTY: readonly string[] = [];
let cached: readonly string[] | null = null;
const listeners = new Set<() => void>();

function readStored(): readonly string[] {
  try {
    return parsePersonal(window.localStorage.getItem(PERSONAL_KEY));
  } catch {
    return EMPTY;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  // A null key is another tab clearing the whole storage.
  if (event.key !== null && event.key !== PERSONAL_KEY) return;
  cached = readStored();
  notify();
}

export function subscribePersonal(onChange: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getPersonalSnapshot(): readonly string[] {
  cached ??= readStored();
  return cached;
}

export function getPersonalServerSnapshot(): readonly string[] {
  return EMPTY;
}

/** False when the browser refused to keep it; it then lasts as long as the page. */
export function setPersonalWords(words: readonly string[]): boolean {
  cached = [...new Set(words)];
  let kept = true;
  try {
    window.localStorage.setItem(PERSONAL_KEY, JSON.stringify(cached));
  } catch {
    kept = false;
  }
  notify();
  return kept;
}
