import type { VersionReason } from "@/lib/notes/history";

/**
 * What «ئىلگىرىكى نۇسخىلار» says (PROMPT-46). Plain functions of a timestamp
 * and "now", so every wording is a unit test; local time throughout, because
 * «بۈگۈن» means the writer's today, not UTC's.
 */

export const REASON_LABEL: Record<VersionReason, string> = {
  auto: "ئاپتوماتىك",
  open: "ئېچىلغاندا",
  "before-replace-all": "ئالماشتۇرۇشتىن بۇرۇن",
  "before-ai": "AI تۈزىتىشتىن بۇرۇن",
  "before-restore": "ئەسلىگە قايتۇرۇشتىن بۇرۇن",
  "before-conflict": "زىددىيەتتىن بۇرۇن",
};

export const HISTORY_TITLE = "ئىلگىرىكى نۇسخىلار";
export const HISTORY_DEVICE_ONLY = "بۇ نۇسخىلار پەقەت مۇشۇ ئۈسكۈنىدە ساقلىنىدۇ.";
export const HISTORY_EMPTY = "تېخى نۇسخا يوق. يازغانسېرى بۇ يەردە ئۆزلۈكىدىن پەيدا بولىدۇ.";
export const HISTORY_UNAVAILABLE =
  "بۇ تور كۆرگۈچتە ئىلگىرىكى نۇسخىلارنى ساقلىغىلى بولمايدۇ (مەسىلەن، يوشۇرۇن كۆزنەكتە).";
export const HISTORY_RESTORED =
  "ئەسلىگە قايتۇرۇلدى. ئالدىنقى ھالىتى «ئىلگىرىكى نۇسخىلار» دا ساقلاندى.";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «بۈگۈن 15:40», «تۈنۈگۈن 09:12», otherwise «2026-10-07 15:40». */
export function versionTime(at: number, now: number): string {
  const when = new Date(at);
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const today = new Date(now);
  if (sameDay(when, today)) return `بۈگۈن ${clock}`;
  // The calendar's yesterday, not 24 hours ago — a day with a clock change in it is still one day.
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(when, yesterday)) return `تۈنۈگۈن ${clock}`;
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${clock}`;
}

/** «ھازىرلا», «5 مىنۇت ئىلگىرى», «2 سائەت ئىلگىرى», «3 كۈن ئىلگىرى». */
export function versionAge(at: number, now: number): string {
  const elapsed = now - at;
  if (elapsed < MINUTE) return "ھازىرلا";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} مىنۇت ئىلگىرى`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} سائەت ئىلگىرى`;
  return `${Math.floor(elapsed / DAY)} كۈن ئىلگىرى`;
}

/** «1,234 ھەرپ» — Latin digits, grouped as the note's own counts line is. */
export function versionLength(chars: number): string {
  return `${chars.toLocaleString("en-US")} ھەرپ`;
}
