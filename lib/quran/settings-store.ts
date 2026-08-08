import {
  DEFAULT_TRANSLATION_MODE,
  QURAN_SETTINGS_KEY,
  isTranslationMode,
  type TranslationMode,
} from "@/lib/quran/settings";

/**
 * External store for the mushaf's translation mode, mirroring
 * lib/reader/settings-store.ts: localStorage does not exist during SSR, so
 * the server renders the default and the browser adopts the stored value on
 * the first commit — with a cached snapshot, so useSyncExternalStore settles.
 */
let cached: TranslationMode | null = null;
const listeners = new Set<() => void>();

function read(): TranslationMode {
  if (typeof window === "undefined") return DEFAULT_TRANSLATION_MODE;
  try {
    const raw = window.localStorage.getItem(QURAN_SETTINGS_KEY);
    return isTranslationMode(raw) ? raw : DEFAULT_TRANSLATION_MODE;
  } catch {
    return DEFAULT_TRANSLATION_MODE;
  }
}

export function subscribeTranslationMode(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getTranslationModeSnapshot(): TranslationMode {
  if (!cached) cached = read();
  return cached;
}

export function getTranslationModeServerSnapshot(): TranslationMode {
  return DEFAULT_TRANSLATION_MODE;
}

export function setTranslationMode(mode: TranslationMode): void {
  cached = mode;
  try {
    window.localStorage.setItem(QURAN_SETTINGS_KEY, mode);
  } catch {
    // Private mode or a full quota — the choice simply does not persist.
  }
  for (const listener of listeners) listener();
}
