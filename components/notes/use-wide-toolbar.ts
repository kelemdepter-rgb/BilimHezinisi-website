"use client";

import { useSyncExternalStore } from "react";

/**
 * Where the notebook's tool row stops being a phone's.
 *
 * Below 640 px (Tailwind's `sm`) the header is a title row and ONE tool row
 * of seven controls, because with the on-screen keyboard up every extra row
 * is taken from the space left to write in (N18, PROMPT-45). From 640 px up
 * there is room for italic, underline and find in the row as well. Each of
 * those is one button that sits in one place or the other — never a copy in
 * each — so it is the same control, with the same name, wherever it is.
 *
 * `null` until the browser has said: the server cannot know the width. The
 * editor then renders those buttons in the row behind `hidden sm:inline-flex`,
 * so a wide screen shows them from the first paint and the row does not
 * shift under a finger when the page hydrates, while a phone shows nothing
 * extra.
 */
const WIDE_QUERY = "(min-width: 640px)";

function subscribe(callback: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function useWideToolbar(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => null,
  );
}
