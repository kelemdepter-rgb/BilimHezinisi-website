import { compareVersions } from "@/lib/notes/save-protocol";

/**
 * The notebook list's three orders (PROMPT-47) — plain logic, unit-tested.
 * Pinned notes always come first, in the same order among themselves.
 */

export const NOTE_SORTS = ["updated", "created", "title"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];
export const DEFAULT_NOTE_SORT: NoteSort = "updated";

export const NOTE_SORT_LABELS: Record<NoteSort, string> = {
  updated: "ئەڭ يېڭى ئۆزگەرتىلگەن",
  created: "ئەڭ يېڭى قۇرۇلغان",
  title: "ماۋزۇ بويىچە",
};

export function isNoteSort(value: unknown): value is NoteSort {
  return typeof value === "string" && (NOTE_SORTS as readonly string[]).includes(value);
}

type Sortable = { id: number; title: string; created_at: string; updated_at: string; pinned_at: string | null };

export type TitleCompare = (a: string, b: string) => number;

/* ── Titles in Uyghur order ──────────────────────────────────────────────── */

/**
 * The Uyghur alphabet in the order the browsers that know Uyghur use (CLDR's
 * «ug», measured in Firefox, Safari and Node): ئ counts as a letter of its
 * own, before ا — so every title that opens on a vowel comes first — and the
 * 32 letters follow in alphabet order. The same letters, and the same
 * folding of the Arabic-only ones, as the database's ug_sort_key (0021);
 * that one drops ئ, as a printed dictionary does, which suits an author
 * index — here every browser has to agree with every other.
 */
const ALPHABET = "ئاەبپتجچخدرزژسشغفقكگڭلمنھوۇۆۈۋېىي";
const FOLDED: Readonly<Record<string, string>> = {
  ث: "س",
  ح: "ھ",
  ذ: "ز",
  ص: "س",
  ض: "ز",
  ط: "ت",
  ظ: "ز",
  ع: "ا",
  ه: "ھ",
  ة: "ھ",
};
/** ug_normalize's marks (0002): tashkil and tatweel. */
const MARKS = /[ً-ٰۖ-ۭ࣓-ࣿـ]/g;
const ALIFS = /[ٱآأإ]/g;
/** Each letter becomes a private-use character, in alphabet order. */
const KEY_BASE = 0xe000;

/**
 * A title rewritten so that comparing code points puts it in Uyghur order:
 * normalized as search normalizes, then each Uyghur letter mapped onto a run
 * of private-use characters that sort in alphabet order. Anything else —
 * Latin, digits, punctuation — stays as it is and sorts before the letters.
 */
export function uyghurSortKey(title: string): string {
  const normal = title.replace(MARKS, "").replace(ALIFS, "ا").replace(/\s+/g, " ").trim().toLowerCase();
  let key = "";
  for (const character of normal) {
    const index = ALPHABET.indexOf(FOLDED[character] ?? character);
    key += index >= 0 ? String.fromCharCode(KEY_BASE + index) : character;
  }
  return key;
}

/** Does this browser know Uyghur order? Firefox and Safari do; Chromium does not. */
export function supportsUyghurCollation(): boolean {
  try {
    return Intl.Collator.supportedLocalesOf(["ug"]).length > 0;
  } catch {
    return false;
  }
}

/**
 * How titles are compared: the browser's own Uyghur collation where it has
 * one, and the alphabet above where it does not. Chromium — and so Chrome on
 * Android, where most of this library's readers are — has no Uyghur data:
 * left to itself it puts «ە», the second letter, after «ب», and «ئۆ» before
 * «ئۇ». Numbers inside a title compare as numbers either way («دەرس 2»
 * before «دەرس 10»).
 */
export function titleComparer(hasUyghur: boolean = supportsUyghurCollation()): TitleCompare {
  if (hasUyghur) {
    const collator = new Intl.Collator("ug", { numeric: true });
    return (a, b) => collator.compare(a, b);
  }
  // The root order keeps the private-use letters in code-point order, and
  // still compares digits as numbers.
  const root = new Intl.Collator(undefined, { numeric: true });
  return (a, b) => root.compare(uyghurSortKey(a), uyghurSortKey(b)) || (a < b ? -1 : a > b ? 1 : 0);
}

/* ── The orders ──────────────────────────────────────────────────────────── */

/** Newest first. */
function newer(a: string, b: string): number {
  return compareVersions(b, a);
}

/**
 * The notes in the chosen order, pinned ones first under their own heading.
 * Ties fall back to the newest edit, then the newest id, so the order never
 * shuffles between two renders.
 */
export function sortNotes<T extends Sortable>(
  notes: readonly T[],
  sort: NoteSort,
  compareTitles: TitleCompare,
): { pinned: T[]; others: T[] } {
  const tie = (a: T, b: T) => newer(a.updated_at, b.updated_at) || b.id - a.id;
  const order: (a: T, b: T) => number =
    sort === "created"
      ? (a, b) => newer(a.created_at, b.created_at) || tie(a, b)
      : sort === "title"
        ? (a, b) => compareTitles(a.title, b.title) || tie(a, b)
        : tie;
  const sorted = [...notes].sort(order);
  return { pinned: sorted.filter((note) => note.pinned_at), others: sorted.filter((note) => !note.pinned_at) };
}
