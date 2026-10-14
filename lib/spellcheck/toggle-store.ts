/**
 * Whether the writer keeps the spellchecker on, remembered in this browser
 * (N14, PROMPT-48). It used to start off every time a note opened, so a
 * writer who always wants it had to ask for it again on every note.
 *
 * An external store like the notebook's typography
 * (lib/notes/typography-store.ts), for the same reason: localStorage does not
 * exist during SSR, so the server renders it off and the browser adopts the
 * stored choice on the first commit — and the dictionary starts loading then,
 * exactly as it does when the switch is tapped. A convenience only:
 * unreadable storage simply means off.
 */
export const SPELL_ON_KEY = "bh-spell-on";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(SPELL_ON_KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribeSpellOn(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getSpellOnSnapshot(): boolean {
  cached ??= readStored();
  return cached;
}

export function getSpellOnServerSnapshot(): boolean {
  return false;
}

export function setSpellOn(on: boolean): void {
  cached = on;
  try {
    window.localStorage.setItem(SPELL_ON_KEY, on ? "1" : "0");
  } catch {
    // Remembered for this visit only.
  }
  for (const listener of listeners) listener();
}
