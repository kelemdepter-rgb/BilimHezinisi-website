import type { IconName } from "@/components/icons";
import type { CategorySymbolName } from "@/components/category-icons";

/**
 * Every picture a category may wear — the shared sprite's (components/icons.tsx)
 * and the category-only ones (components/category-icons.tsx) — with the
 * Uyghur name the admin's picker shows. The value stored in
 * `categories.icon` is the English sprite name and never changes; only what
 * the admin reads is Uyghur.
 *
 * Grouped, because a list of fifty names is only usable in sections. The
 * order inside a group is the order in the picker; «ھۆججەت قىسقۇچ» (folder)
 * comes first because it is the default.
 */
export type CategoryIconName = IconName | CategorySymbolName;

export type CategoryIconOption = { name: CategoryIconName; label: string };

export const CATEGORY_ICON_GROUPS: { label: string; icons: CategoryIconOption[] }[] = [
  {
    label: "كىتاب ۋە يېزىق",
    icons: [
      { name: "folder", label: "ھۆججەت قىسقۇچ" },
      { name: "book", label: "كىتاب" },
      { name: "book-open", label: "ئوچۇق كىتاب" },
      { name: "book-marked", label: "خەتكۈچلۈك كىتاب" },
      { name: "bookmark", label: "خەتكۈچ" },
      { name: "notebook-pen", label: "دەپتەر ۋە قەلەم" },
      { name: "file-text", label: "ھۆججەت" },
      { name: "newspaper", label: "گېزىت" },
      { name: "scroll", label: "ئورام قەغەز" },
      { name: "feather", label: "پەي قەلەم" },
      { name: "pencil", label: "قەلەم" },
      { name: "quote", label: "تىرناق" },
      { name: "languages", label: "تىللار" },
      { name: "glasses", label: "كۆزەينەك" },
      { name: "layers", label: "قاتلاملار" },
      { name: "tag", label: "يارلىق" },
    ],
  },
  {
    label: "ئىسلام",
    icons: [
      { name: "crescent-star", label: "ئاي يۇلتۇز" },
      { name: "moon", label: "يېڭى ئاي" },
      { name: "mosque", label: "مەسچىت" },
      { name: "kaaba", label: "كەبە" },
      { name: "tasbih", label: "تەسبىھ" },
      { name: "lantern", label: "پانۇس" },
      { name: "compass", label: "قىبلىنامە" },
      { name: "palm", label: "خورما دەرىخى" },
      { name: "scale", label: "تارازا" },
    ],
  },
  {
    label: "تارىخ ۋە ۋەتەن",
    icons: [
      { name: "landmark", label: "قەدىمىي بىنا" },
      { name: "hourglass", label: "قۇم سائەت" },
      { name: "flag", label: "بايراق" },
      { name: "mountain", label: "تاغ" },
      { name: "map", label: "خەرىتە" },
      { name: "globe", label: "يەر شارى" },
      { name: "calendar", label: "كالېندار" },
    ],
  },
  {
    label: "ئىلىم-پەن",
    icons: [
      { name: "graduation-cap", label: "ئوقۇش قالپىقى" },
      { name: "flask", label: "تەجرىبە كولبىسى" },
      { name: "atom", label: "ئاتوم" },
      { name: "idea", label: "ئىدىيە" },
      { name: "stethoscope", label: "تىبابەت" },
      { name: "laptop", label: "كومپيۇتېر" },
      { name: "coins", label: "تەڭگىلەر" },
    ],
  },
  {
    label: "ئادەم ۋە ئائىلە",
    icons: [
      { name: "user", label: "ئادەم" },
      { name: "users", label: "ئادەملەر" },
      { name: "award", label: "مېدال" },
      { name: "family", label: "ئائىلە" },
      { name: "baby", label: "بوۋاق" },
      { name: "smile", label: "كۈلكە" },
      { name: "heart", label: "يۈرەك" },
      { name: "sprout", label: "مايسا" },
      { name: "house", label: "ئۆي" },
      { name: "utensils", label: "ئاشپەزلىك" },
    ],
  },
  {
    label: "باشقا",
    icons: [
      { name: "star", label: "يۇلتۇز" },
      { name: "sparkles", label: "پارقىراق" },
      { name: "oil-lamp", label: "سېھرىي چىراغ" },
      { name: "chat", label: "سۆھبەت" },
      { name: "sun", label: "قۇياش" },
    ],
  },
];

export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = CATEGORY_ICON_GROUPS.flatMap(
  (group) => group.icons,
);
