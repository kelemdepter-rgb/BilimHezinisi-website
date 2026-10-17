import type { Annotation } from "@/lib/reader/pages";

/**
 * Keeping the reader's bookmark and note lists right while they load.
 *
 * The reader loads a book's bookmarks and notes once, as the book opens, and
 * the reader may add or remove one before that answer arrives. The database
 * can have READ the list before the change and DELIVER it after: written over
 * the panel's list, that answer made a bookmark that had just been saved
 * vanish until a reload, and readers added it again (2026-10-17). So the
 * answer is merged with what is on screen instead — never written over it.
 */

/** By page, then in the order they were made. */
function sorted(items: Iterable<Annotation>): Annotation[] {
  return [...items].sort((a, b) => a.page_no - b.page_no || a.id - b.id);
}

/**
 * The first load's answer, with what the reader did while it was on its way:
 * everything on screen stays (an addition the answer predates included), and
 * nothing removed in this visit comes back with it. One row per id.
 */
export function mergeLoaded(
  loaded: readonly Annotation[],
  onScreen: readonly Annotation[],
  removed: ReadonlySet<number>,
): Annotation[] {
  const byId = new Map<number, Annotation>();
  for (const item of loaded) if (!removed.has(item.id)) byId.set(item.id, item);
  for (const item of onScreen) if (!removed.has(item.id)) byId.set(item.id, item);
  return sorted(byId.values());
}

/** The list with one saved row in it — once, even if the load already brought it. */
export function withAnnotation(list: readonly Annotation[], item: Annotation): Annotation[] {
  return sorted([...list.filter((existing) => existing.id !== item.id), item]);
}
