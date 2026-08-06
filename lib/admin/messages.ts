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
} as const;

export function failureMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "FORBIDDEN") return MSG.forbidden;
    if (/last admin/i.test(error.message)) return MSG.lastAdmin;
    if (/duplicate key|unique constraint/i.test(error.message)) return MSG.nameExists;
  }
  return MSG.unknown;
}
