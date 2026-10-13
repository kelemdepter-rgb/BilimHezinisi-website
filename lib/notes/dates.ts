import { versionMicros } from "@/lib/notes/save-protocol";

/**
 * When a note was written, as the list shows it: «2026-10-07 15:40», in the
 * reader's own time zone — or in `timeZone`, for a test.
 *
 * The list used to print the first ten characters of `updated_at`, which is
 * UTC: an edit made in Istanbul between midnight and three in the morning
 * showed the day before (N19). The stamp is read through versionMicros
 * because PostgREST prints microseconds, which not every engine's Date
 * parser accepts. Empty for a stamp that cannot be read.
 */
export function formatNoteTime(stamp: string, timeZone?: string): string {
  const micros = versionMicros(stamp);
  if (micros === null) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      numberingSystem: "latn",
    }).formatToParts(new Date(Math.floor(micros / 1000)));
  } catch {
    return "";
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
