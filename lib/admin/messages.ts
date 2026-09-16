/** Shared Uyghur result messages for admin Server Actions. */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export const MSG = {
  forbidden: "بۇ مەشغۇلاتنى قىلىش ھوقۇقىڭىز يوق.",
  notConfigured: "سايت ساندانغا ئۇلانمىغان.",
  nameRequired: "ئىسىم قۇرۇق بولمايدۇ.",
  nameExists: "بۇ ئىسىمدىكى تۈر ئاللىبۇرۇن بار.",
  categoryHasChildren: "بۇ تۈرنىڭ ئاستىدا تارماق تۈرلەر بار — ئالدى بىلەن ئۇلارنى ئۆچۈرۈڭ ياكى باشقا يەرگە يۆتكەڭ.",
  categoryHasBooks: (n: number) =>
    `بۇ تۈردە ${n} كىتاب بار — ئالدى بىلەن ئۇلارنى باشقا تۈرگە يۆتكەڭ.`,
  categoryOwnParent: "بىر تۈرنى ئۆزىنىڭ ياكى ئۆز تارمىقىنىڭ ئاستىغا يۆتكىگىلى بولمايدۇ.",
  saved: "ساقلاندى.",
  deleted: "ئۆچۈرۈلدى.",
  lastAdmin: "ئاخىرقى باشقۇرغۇچىنى چۈشۈرگىلى بولمايدۇ — ئالدى بىلەن باشقا بىرىنى باشقۇرغۇچى قىلىڭ.",
  selfDemote: "ئۆزىڭىزنىڭ سالاھىيىتىنى ئۆزىڭىز چۈشۈرەلمەيسىز.",
  bookNotFound: "كىتاب تېپىلمىدى.",
  unknown: "مەشغۇلات مەغلۇپ بولدى. قايتا سىناڭ.",
  /**
   * The upload wizard's save step. Its writes go straight from the browser to
   * the database, so the failures it meets arrive as PostgREST messages — in
   * English, sometimes quoting a constraint name — and these are what the
   * admin is shown instead.
   */
  bookExists: "بۇ كىتاب كۇتۇپخانىدا ئاللىبۇرۇن بار — ئىككىنچى قېتىم ساقلانمايدۇ.",
  bookSaveFailed:
    "ساقلاش مەغلۇپ بولدى. تور ئۇلىنىشىنى تەكشۈرۈپ «قايتا سىناش» نى بېسىڭ — ساقلاش توختىغان يېرىدىن داۋاملىشىدۇ.",
  pageCountMismatch: (stored: number, expected: number) =>
    `بەت سانى ماس كەلمىدى (${stored}/${expected}). كىتاب قارالما پېتى تۇرىدۇ — «قايتا سىناش» نى بېسىڭ.`,
} as const;

export function failureMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "FORBIDDEN") return MSG.forbidden;
    if (/last admin/i.test(error.message)) return MSG.lastAdmin;
    if (/duplicate key|unique constraint/i.test(error.message)) return MSG.nameExists;
  }
  return MSG.unknown;
}

/**
 * The same idea for the upload wizard, whose writes run in the browser: a
 * duplicate key there is the book's content hash (the admin went past the
 * duplicate warning), and a row-level-security refusal means the session or
 * the role went away mid-save. Anything else is a dropped connection as far
 * as the admin is concerned, and the message says what to do about it.
 */
export function bookSaveFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/duplicate key|unique constraint/i.test(error.message)) return MSG.bookExists;
    if (/row-level security|permission denied|JWT/i.test(error.message)) return MSG.forbidden;
  }
  return MSG.bookSaveFailed;
}
