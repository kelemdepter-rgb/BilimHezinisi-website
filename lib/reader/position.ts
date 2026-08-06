/**
 * Reading-position helpers.
 *
 * A position is a page number plus a 0–1 offset within that page, so it
 * survives font-size and window changes (a pixel offset would not).
 */

export type ReadingPosition = {
  pageNo: number;
  /** Fraction scrolled through that page, 0–1. */
  offset: number;
};

export const DEFAULT_POSITION: ReadingPosition = { pageNo: 1, offset: 0 };

/** Keep a position inside the book, tolerating bad or stale stored values. */
export function clampPosition(
  position: Partial<ReadingPosition> | null | undefined,
  pageCount: number,
): ReadingPosition {
  const totalPages = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 1;
  const rawPage = Number(position?.pageNo);
  const pageNo = Number.isFinite(rawPage) ? Math.min(Math.max(Math.floor(rawPage), 1), totalPages) : 1;
  const rawOffset = Number(position?.offset);
  const offset = Number.isFinite(rawOffset) ? Math.min(Math.max(rawOffset, 0), 1) : 0;
  return { pageNo, offset };
}

/** True when the stored position is far enough in to be worth restoring. */
export function shouldRestore(position: ReadingPosition): boolean {
  return position.pageNo > 1 || position.offset > 0.02;
}

/** Which page window to load first so the restored page is inside it. */
export function initialPageWindow(
  position: ReadingPosition,
  pageCount: number,
  windowSize: number,
): { from: number; to: number } {
  const totalPages = Math.max(1, Math.floor(pageCount) || 1);
  const size = Math.max(1, Math.floor(windowSize));
  // Start a little before the saved page so there is context to scroll back to.
  const lead = Math.min(2, size - 1);
  const from = Math.min(Math.max(1, position.pageNo - lead), Math.max(1, totalPages - size + 1));
  const to = Math.min(totalPages, from + size - 1);
  return { from, to };
}

export const POSITION_STORAGE_PREFIX = "bh-reading-position:";

/** localStorage key used for anonymous readers. */
export function positionStorageKey(bookId: number): string {
  return `${POSITION_STORAGE_PREFIX}${bookId}`;
}

export function parseStoredPosition(raw: string | null, pageCount: number): ReadingPosition {
  if (!raw) return DEFAULT_POSITION;
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingPosition>;
    return clampPosition(parsed, pageCount);
  } catch {
    return DEFAULT_POSITION;
  }
}
