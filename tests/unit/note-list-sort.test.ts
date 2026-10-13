import { describe, expect, it } from "vitest";
import {
  NOTE_SORTS,
  NOTE_SORT_LABELS,
  sortNotes,
  supportsUyghurCollation,
  titleComparer,
  uyghurSortKey,
  type NoteSort,
} from "@/lib/notes/list-sort";

/**
 * The notebook list's orders (PROMPT-47). Node carries full ICU, so its
 * Intl.Collator("ug") is the order Firefox and Safari use; Chromium has none
 * and takes the fallback — which must agree with it. Titles are invented.
 */

/** Uyghur words, vowel-initial ones included, in no particular order. */
const WORDS = [
  "يېزىق", "ەلا", "بىلىم", "ئانا", "ئەل", "ۋەتەن", "ئۆي", "ئۇيغۇر", "ھەممە", "ئوقۇش", "ئۈزۈم", "ئېغىز",
  "ئىش", "ئاتا", "ئادەم", "انار", "پاختا", "چاي", "ژۇرنال", "غەلىبە", "ڭ", "گۈل", "كىتاب", "قەلەم",
  "ۇرۇق", "ۆي", "ۈزۈم", "ېلان", "ىز", "ى", "مەكتەپ", "نان", "لالە", "شەھەر", "سۇ", "زىمىستان",
];

let next = 1;
function note(title: string, extra: Partial<{ created_at: string; updated_at: string; pinned_at: string | null }> = {}) {
  const id = next++;
  return {
    id,
    title,
    created_at: extra.created_at ?? `2026-10-01T10:00:${String(id % 60).padStart(2, "0")}.000000+00:00`,
    updated_at: extra.updated_at ?? `2026-10-05T10:00:${String(id % 60).padStart(2, "0")}.000000+00:00`,
    pinned_at: extra.pinned_at ?? null,
  };
}

const titles = (notes: { title: string }[]) => notes.map((item) => item.title);

describe("Uyghur order", () => {
  it("Node has the Uyghur collation (the order Firefox and Safari use)", () => {
    expect(supportsUyghurCollation()).toBe(true);
    const sorted = [...WORDS].sort(titleComparer(true));
    expect(sorted.slice(0, 4)).toEqual(["ئاتا", "ئادەم", "ئانا", "ئەل"]);
    expect(sorted.indexOf("ەلا")).toBeLessThan(sorted.indexOf("بىلىم"));
    expect(sorted.indexOf("ئۇيغۇر")).toBeLessThan(sorted.indexOf("ئۆي"));
  });

  it("the fallback for a browser without it gives the very same order", () => {
    const real = [...WORDS].sort(titleComparer(true));
    const fallback = [...WORDS].sort(titleComparer(false));
    expect(fallback).toEqual(real);
  });

  it("the fallback is not code-point order, which would put ە after ب and ئۆ before ئۇ", () => {
    const codePoints = [...WORDS].sort();
    expect(codePoints.indexOf("ەلا")).toBeGreaterThan(codePoints.indexOf("بىلىم"));
    const fallback = [...WORDS].sort(titleComparer(false));
    expect(fallback).not.toEqual(codePoints);
  });

  it("compares numbers as numbers, either way", () => {
    for (const hasUyghur of [true, false]) {
      expect(["دەرس 10", "دەرس 2", "دەرس 1"].sort(titleComparer(hasUyghur))).toEqual(["دەرس 1", "دەرس 2", "دەرس 10"]);
    }
  });

  it("reads past tashkil, tatweel and the alif forms, as search does", () => {
    expect(uyghurSortKey("أَنَـار")).toBe(uyghurSortKey("انار"));
    expect(uyghurSortKey("  ئانا   ئەل ")).toBe(uyghurSortKey("ئانا ئەل"));
    const compare = titleComparer(false);
    expect(compare("آنار", "بىلىم")).toBeLessThan(0);
  });
});

describe("sortNotes", () => {
  const old = note("ئانا", { created_at: "2026-09-01T08:00:00+00:00", updated_at: "2026-10-12T08:00:00.000001+00:00" });
  const fresh = note("يېزىق", { created_at: "2026-10-10T08:00:00+00:00", updated_at: "2026-10-11T08:00:00+00:00" });
  const middle = note("بىلىم", { created_at: "2026-10-05T08:00:00+00:00", updated_at: "2026-10-12T08:00:00+00:00" });
  const pinned = note("ۋەتەن", {
    created_at: "2026-08-01T08:00:00+00:00",
    updated_at: "2026-08-02T08:00:00+00:00",
    pinned_at: "2026-10-13T08:00:00+00:00",
  });
  const notes = [middle, pinned, fresh, old];
  const order = (sort: NoteSort) => sortNotes(notes, sort, titleComparer(false));

  it("newest edit first — to the microsecond — pinned notes always first", () => {
    const { pinned: top, others } = order("updated");
    expect(titles(top)).toEqual(["ۋەتەن"]);
    expect(titles(others)).toEqual(["ئانا", "بىلىم", "يېزىق"]);
  });

  it("newest made first", () => {
    expect(titles(order("created").others)).toEqual(["يېزىق", "بىلىم", "ئانا"]);
  });

  it("by title, in Uyghur order", () => {
    expect(titles(order("title").others)).toEqual(["ئانا", "بىلىم", "يېزىق"]);
  });

  it("pinned notes keep the chosen order among themselves", () => {
    const a = note("بىرىنچى", { pinned_at: "2026-10-13T08:00:00+00:00", updated_at: "2026-10-01T08:00:00+00:00" });
    const b = note("ئاخىرقى", { pinned_at: "2026-10-12T08:00:00+00:00", updated_at: "2026-10-09T08:00:00+00:00" });
    expect(titles(sortNotes([a, b], "updated", titleComparer(false)).pinned)).toEqual(["ئاخىرقى", "بىرىنچى"]);
    expect(titles(sortNotes([b, a], "title", titleComparer(false)).pinned)).toEqual(["ئاخىرقى", "بىرىنچى"]);
  });

  it("two notes of one title never swap places between renders", () => {
    const first = note("سىناق", { updated_at: "2026-10-05T08:00:00+00:00" });
    const second = note("سىناق", { updated_at: "2026-10-06T08:00:00+00:00" });
    const third = note("سىناق", { updated_at: "2026-10-06T08:00:00+00:00" });
    for (const input of [
      [first, second, third],
      [third, first, second],
    ]) {
      expect(sortNotes(input, "title", titleComparer(true)).others.map((item) => item.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
    }
  });

  it("offers exactly the three orders, worded as the task asks", () => {
    expect(NOTE_SORTS.map((sort) => NOTE_SORT_LABELS[sort])).toEqual([
      "ئەڭ يېڭى ئۆزگەرتىلگەن",
      "ئەڭ يېڭى قۇرۇلغان",
      "ماۋزۇ بويىچە",
    ]);
  });
});
