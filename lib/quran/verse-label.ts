/**
 * A verse's translation and its label: «… ئىگىسىدۇر. [4]» — the desktop's
 * `src/verse-label.js` (3.6) in TypeScript.
 *
 * The Uyghur translation renders some runs of consecutive verses as one
 * sentence (186 groups, lib/quran/groups.generated.ts). Wherever a
 * translation is shown or leaves the mushaf — copied, inserted into a note,
 * listed as a search result — it carries its label: «[7]», or «[4 _ 6]» for a
 * group. The label is written exactly «[» from « _ » to «]», Western digits,
 * an underscore (U+005F) with one space on each side, in that logical order
 * and with NO left-to-right isolation: inside a right-to-left paragraph a
 * reader meets 4 first.
 *
 * This module carries the group table, so only what already shows the Qur'an
 * imports it. The notebook gets its units from the server and imports the
 * `VerseUnit` type alone (lib/quran/copy.ts, lib/notes/insert.ts).
 */
import { GROUP_TEXT_AYA, QURAN_GROUPS } from "@/lib/quran/groups.generated";
import type { Aya } from "@/lib/quran/types";

export type VerseRange = { from: number; to: number };

/**
 * One translation and the verses it belongs to, as it is shown, copied or
 * inserted: each verse's Arabic, then `text` once, followed by `label`.
 */
export type VerseUnit = {
  sura: number;
  from: number;
  to: number;
  ayas: Aya[];
  /** The group's translation (the longest of its verses' texts). */
  text: string;
  label: string;
};

/** «[7]» or «[4 _ 6]». */
export function label(from: number, to: number = from): string {
  return to > from ? `[${from} _ ${to}]` : `[${from}]`;
}

/** The translation followed by its label, or "" when there is none. */
export function withLabel(text: string, from: number, to: number = from): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed} ${label(from, to)}` : "";
}

let index: Map<string, VerseRange> | null = null;
let textAyas: Map<string, number> | null = null;

/** The group a verse belongs to; a verse in no listed group is its own. */
export function groupOf(sura: number, aya: number): VerseRange {
  if (!index) {
    index = new Map();
    for (const [s, from, to] of QURAN_GROUPS) {
      for (let a = from; a <= to; a++) index.set(`${s}:${a}`, { from, to });
    }
  }
  return index.get(`${sura}:${aya}`) ?? { from: aya, to: aya };
}

/**
 * For a group whose verses' texts differ (53:13–14), the verse whose text is
 * the group's translation (53:13); null when every verse of the group carries
 * the same text, so any of them will do.
 */
export function groupTextAya(sura: number, aya: number): number | null {
  const { from } = groupOf(sura, aya);
  if (!textAyas) {
    textAyas = new Map(GROUP_TEXT_AYA.map(([s, f, a]) => [`${s}:${f}`, a]));
  }
  return textAyas.get(`${sura}:${from}`) ?? null;
}

/**
 * A group's translation from the rows on hand: the longest of its verses'
 * texts (identical but for 53:13–14).
 */
export function groupText(rows: readonly Aya[], sura: number, range: VerseRange): string {
  let best = "";
  for (const row of rows) {
    if (row.sura === sura && row.aya >= range.from && row.aya <= range.to && row.text_ug.length > best.length) {
      best = row.text_ug;
    }
  }
  return best;
}

/**
 * One verse as its own unit, carrying its group's translation and label —
 * what a copy or an insert of a verse of a group writes. `rows` are the
 * verses on hand that may hold the group's text (a sura, or the group).
 */
export function unitOf(aya: Aya, rows: readonly Aya[]): VerseUnit {
  const range = groupOf(aya.sura, aya.aya);
  const text = groupText(rows, aya.sura, range) || aya.text_ug;
  return { sura: aya.sura, ...range, ayas: [aya], text, label: label(range.from, range.to) };
}

/**
 * A run of verses as it is copied or inserted: consecutive rows of the same
 * sura and the same group make ONE unit, so a group's translation is written
 * once, after the last of its verses in the run.
 */
export function units(rows: readonly Aya[]): VerseUnit[] {
  const out: VerseUnit[] = [];
  for (const row of rows) {
    const range = groupOf(row.sura, row.aya);
    const previous = out[out.length - 1];
    if (previous && previous.sura === row.sura && previous.from === range.from && previous.to === range.to) {
      previous.ayas.push(row);
      if (row.text_ug.length > previous.text.length) previous.text = row.text_ug;
      continue;
    }
    out.push({
      sura: row.sura,
      ...range,
      ayas: [row],
      text: row.text_ug,
      label: label(range.from, range.to),
    });
  }
  return out;
}
