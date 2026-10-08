import { MAX_NOTE_CHARS } from "@/lib/notes/limits";

/**
 * What a note save can answer, shared by the Server Actions and the editor.
 *
 * A plain module on purpose: a `"use server"` file may only export async
 * functions, and the editor needs the same codes, labels and limits as the
 * server — one list here, never two copies that drift.
 *
 * Adding a result code (stage 3 adds `quota` and `rate`) is one line in
 * SAVE_CODES, one in CODE_STATE and one in SAVE_MESSAGES; TypeScript refuses
 * the build until all three agree.
 */
export const SAVE_CODES = [
  "needs_account",
  "not_found",
  "too_long",
  "too_large",
  "conflict",
  "failed",
] as const;

export type SaveCode = (typeof SAVE_CODES)[number];

export type SaveFailure = {
  ok: false;
  code: SaveCode;
  /** The Uyghur sentence for this code. */
  error: string;
  /** Present on `conflict`: the version the server holds now. */
  serverUpdatedAt?: string;
};

export type SaveResult = { ok: true; updatedAt: string } | SaveFailure;

/** Every state the editor's label can be in. */
export type SaveState =
  | "idle"
  | "saved"
  | "dirty"
  | "saving"
  | "offline"
  | "retrying"
  | "blocked"
  | "conflict";

/**
 * Where each refusal leaves the editor.
 *
 * `retrying` tries again by itself on a schedule; `blocked` waits for the next
 * edit, because sending the same thing again would get the same answer;
 * `conflict` pauses autosave until the writer chooses.
 */
export const CODE_STATE: Record<SaveCode, "blocked" | "retrying" | "conflict"> = {
  needs_account: "blocked",
  not_found: "blocked",
  too_long: "blocked",
  too_large: "blocked",
  conflict: "conflict",
  failed: "retrying",
};

/** The exact text of `data-testid="save-state"` in each state. */
export const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saved: "ساقلاندى",
  dirty: "ئۆزگەردى…",
  saving: "ساقلىنىۋاتىدۇ…",
  offline: "ئۇلىنىش يوق — بۇ ئۈسكۈنىدە ساقلاندى",
  retrying: "ساقلانمىدى — بۇ ئۈسكۈنىدە ساقلاندى، قايتا سىنايدۇ",
  // The full reason is in the notice under the toolbar; the title row on a
  // 360 px phone has room for two words.
  blocked: "ساقلانمىدى",
  conflict: "ساقلانمىدى",
};

export const SAVE_MESSAGES: Record<SaveCode, string> = {
  needs_account:
    "ھېساباتىڭىزدىن چىقىپ كېتىپسىز. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى — قايتا كىرسىڭىز ساقلىنىدۇ.",
  not_found: "بۇ خاتىرە تېپىلمىدى. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.",
  too_long: `خاتىرە بەك ئۇزۇن بولۇپ كەتتى (${MAX_NOTE_CHARS.toLocaleString("en-US")} ھەرپتىن ئاشماسلىقى كېرەك). ئىككىگە بۆلۈپ يېزىڭ.`,
  too_large:
    "خاتىرىدىكى فورمات بەك كۆپ، ساقلىغىلى بولمىدى. بىر قىسمىنى «فورماتنى تازىلاش» بىلەن ئاددىيلاشتۇرۇڭ ياكى ئىككىگە بۆلۈڭ. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.",
  conflict:
    "بۇ خاتىرە باشقا يەردە (باشقا بەتكۈچ ياكى ئۈسكۈنىدە) ئۆزگەرتىلدى. يازغانلىرىڭىز يوقالمىدى.",
  failed: "مەشغۇلات مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
};

export function saveFailure(code: SaveCode, serverUpdatedAt?: string): SaveFailure {
  return serverUpdatedAt === undefined
    ? { ok: false, code, error: SAVE_MESSAGES[code] }
    : { ok: false, code, error: SAVE_MESSAGES[code], serverUpdatedAt };
}

/** Shown once when this device cannot keep its own copy. */
export const STORAGE_FULL_MESSAGE =
  "بۇ ئۈسكۈنىنىڭ ساقلىغۇچى تولغان — ئۇلىنىش ئۈزۈلسە يازغانلىرىڭىز ساقلانماسلىقى مۇمكىن.";

export const MAX_TITLE_CHARS = 200;
export const UNTITLED = "يېڭى خاتىرە";

/** The title as the server stores it — the editor compares against the same. */
export function normalizeTitle(title: string): string {
  return title.trim().slice(0, MAX_TITLE_CHARS) || UNTITLED;
}

/**
 * The largest save the editor sends.
 *
 * Next.js refuses a Server Action body over 1 MB (`serverActions.bodySizeLimit`,
 * which stays at its default — raising it raises what every visitor can make
 * a function swallow). The request is JSON, and escaping the quotes of a
 * heavily styled paste adds a few per cent, so the line is drawn well short of
 * the limit: a note that would be refused is never sent, and the writer is
 * told why instead of watching «ئۇلىنىش يوق» forever (N23).
 */
export const MAX_SAVE_BYTES = 900 * 1024;

/** UTF-8 length without allocating a copy of a possibly large string. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function saveBytes(content: { title: string; html: string }): number {
  return utf8Bytes(content.title) + utf8Bytes(content.html);
}

/**
 * A note's version, as microseconds since the epoch.
 *
 * `updated_at` travels as the string PostgREST printed — microseconds, and
 * Postgres trims trailing zeros — and it is sent back exactly as received,
 * because the save compares it for equality. Ordering ("is the server's
 * newer?") needs the number, which a JS Date cannot hold: it stops at
 * milliseconds.
 */
export function versionMicros(stamp: string): number | null {
  const match = /^(.+?T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(stamp.trim());
  if (!match) return null;
  const [, seconds, fraction = "", zone = "Z"] = match;
  const millis = Date.parse(`${seconds}${zone === "Z" ? "Z" : normalizeZone(zone)}`);
  if (Number.isNaN(millis)) return null;
  return millis * 1000 + Number(fraction.padEnd(6, "0"));
}

function normalizeZone(zone: string): string {
  // "+00" and "+0000" are valid Postgres output but not what Date.parse wants.
  const digits = zone.slice(1).replace(":", "");
  return `${zone[0]}${digits.slice(0, 2)}:${(digits.slice(2) || "00").padEnd(2, "0")}`;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = versionMicros(a);
  const right = versionMicros(b);
  if (left === null || right === null) return a === b ? 0 : a < b ? -1 : 1;
  return left - right;
}
