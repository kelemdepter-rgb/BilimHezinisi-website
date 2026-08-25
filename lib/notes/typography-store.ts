import {
  DEFAULT_TYPOGRAPHY,
  clampTypography,
  readStoredTypography,
  writeStoredTypography,
  type NoteTypography,
} from "@/lib/notes/typography";

/**
 * External store for the notebook's typography, the same shape as the
 * reader's (lib/reader/settings-store.ts) and for the same reason: the values
 * live in localStorage, which does not exist during SSR, so they cannot be a
 * lazy useState initializer without a hydration mismatch. The server renders
 * the defaults and the browser adopts the stored choice on the first commit.
 */
let cached: NoteTypography | null = null;
const listeners = new Set<() => void>();

export function subscribeTypography(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getTypographySnapshot(): NoteTypography {
  if (!cached) cached = readStoredTypography();
  return cached;
}

export function getTypographyServerSnapshot(): NoteTypography {
  return DEFAULT_TYPOGRAPHY;
}

export function updateTypographyStore(patch: Partial<NoteTypography>): void {
  cached = clampTypography({ ...getTypographySnapshot(), ...patch });
  writeStoredTypography(cached);
  for (const listener of listeners) listener();
}
