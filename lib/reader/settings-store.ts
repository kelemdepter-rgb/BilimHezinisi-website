import {
  DEFAULT_SETTINGS,
  clampSettings,
  readStoredSettings,
  writeStoredSettings,
  type ReaderSettings,
} from "@/lib/reader/settings";

/**
 * External store for reader settings.
 *
 * The values live in localStorage, which does not exist during SSR, so they
 * cannot be a lazy useState initializer without a hydration mismatch. An
 * external store lets the server render defaults and the browser adopt the
 * stored values on the first commit — with a cached snapshot object, so
 * useSyncExternalStore does not loop.
 */
let cached: ReaderSettings | null = null;
const listeners = new Set<() => void>();

export function subscribeSettings(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getSettingsSnapshot(): ReaderSettings {
  if (!cached) cached = readStoredSettings();
  return cached;
}

export function getSettingsServerSnapshot(): ReaderSettings {
  return DEFAULT_SETTINGS;
}

export function updateSettingsStore(patch: Partial<ReaderSettings>): void {
  cached = clampSettings({ ...getSettingsSnapshot(), ...patch });
  writeStoredSettings(cached);
  for (const listener of listeners) listener();
}
