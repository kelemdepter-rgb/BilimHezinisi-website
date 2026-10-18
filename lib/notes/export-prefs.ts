/**
 * Whether an export turns citations into footnotes («مەنبەلەرنى ئاستى ئىزاھات
 * قىلىش», PROMPT-50), remembered in this browser. Word and Markdown both
 * follow it, so the two files of one note agree.
 *
 * An external store like the spellchecker's switch
 * (lib/spellcheck/toggle-store.ts), for the same reason: localStorage does
 * not exist during SSR, so the server renders it off and the browser adopts
 * the stored choice on the first commit. Off until the writer turns it on —
 * citations as inline links is what every export did before. Unreadable
 * storage simply means off.
 */
export const EXPORT_FOOTNOTES_KEY = "bh-note-export-footnotes";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(EXPORT_FOOTNOTES_KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribeExportFootnotes(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getExportFootnotesSnapshot(): boolean {
  cached ??= readStored();
  return cached;
}

export function getExportFootnotesServerSnapshot(): boolean {
  return false;
}

export function setExportFootnotes(on: boolean): void {
  cached = on;
  try {
    window.localStorage.setItem(EXPORT_FOOTNOTES_KEY, on ? "1" : "0");
  } catch {
    // Remembered for this visit only.
  }
  for (const listener of listeners) listener();
}
