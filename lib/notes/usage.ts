import { NOTE_QUOTA_MAX_BYTES, NOTE_QUOTA_MAX_NOTES } from "@/lib/notes/limits";

/**
 * Where a writer stands against the notebook's quota (PROMPT-44), for the
 * line under /notes' heading. Plain logic, so the thresholds are unit-tested.
 */

export const MEGABYTE = 1024 * 1024;

/** At this share of either limit the line turns into a warning. */
export const USAGE_WARN_RATIO = 0.9;

/** `ok` plain, `near` the warning colour, `full` the strong one and a hint. */
export type UsageLevel = "ok" | "near" | "full";

export type NotebookUsage = { count: number; bytes: number; level: UsageLevel };

/**
 * Megabytes with one decimal, rounded DOWN: 4.96 MB reads «4.9», so «5.0»
 * never appears while there is still room to save.
 */
export function formatMegabytes(bytes: number): string {
  return (Math.floor((Math.max(0, bytes) * 10) / MEGABYTE) / 10).toFixed(1);
}

/** The limit itself, as written in the messages: «5». */
export const QUOTA_MEGABYTES = String(NOTE_QUOTA_MAX_BYTES / MEGABYTE);

export function notebookUsage(notes: ReadonlyArray<{ bytes: number }>): NotebookUsage {
  const count = notes.length;
  const bytes = notes.reduce((total, note) => total + note.bytes, 0);
  let level: UsageLevel = "ok";
  if (count >= NOTE_QUOTA_MAX_NOTES || bytes >= NOTE_QUOTA_MAX_BYTES) level = "full";
  else if (
    count >= NOTE_QUOTA_MAX_NOTES * USAGE_WARN_RATIO ||
    bytes >= NOTE_QUOTA_MAX_BYTES * USAGE_WARN_RATIO
  ) {
    level = "near";
  }
  return { count, bytes, level };
}
