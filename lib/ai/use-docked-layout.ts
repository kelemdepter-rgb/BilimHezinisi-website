"use client";

import { useSyncExternalStore } from "react";

/**
 * Where an AI panel stops being a sheet and becomes a column.
 *
 * Below this width it covers the screen, because a 375 px phone cannot show a
 * document and a side column at once and trying leaves both unreadable. At and
 * above it the panel docks beside the text and the reader — or the writer —
 * carries on while an answer arrives, which is how the desktop app has always
 * worked.
 *
 * Shared by the reader's panel and the notebook's, because getting this
 * threshold different in two places would mean two different behaviours at the
 * same window size.
 */
const DOCKED_QUERY = "(min-width: 1024px)";

function subscribe(callback: () => void) {
  const query = window.matchMedia(DOCKED_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function useDockedLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DOCKED_QUERY).matches,
    // The server cannot know the width, and a phone is the safer assumption:
    // it renders the sheet, which is correct at every width until JS runs.
    () => false,
  );
}
