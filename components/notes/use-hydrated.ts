import { useSyncExternalStore } from "react";

const subscribeNothing = () => () => {};
const inBrowser = () => true;
const onServer = () => false;

/**
 * False while the server renders and while React hydrates; true after.
 *
 * The notebook's list and trash take input only from here on: a word typed
 * into the search box before the page has hydrated would stay on screen
 * while React never heard it — the list unfiltered under a search that
 * seemed to have been made.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNothing, inBrowser, onServer);
}
