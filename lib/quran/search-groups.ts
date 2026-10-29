/**
 * Qur'an search results, one card per translation group: a group's verses
 * share one translation, so a search that finds three of them shows the
 * translation once, with its label «[4 _ 6]», and the Arabic of each verse
 * that matched (the desktop's `collapseQuranGroups`, 3.6).
 *
 * Grouping happens within the page of hits the RPC returned; pagination and
 * the search itself (search_quran, migration 0028) are unchanged.
 */
import { groupOf, groupTextAya, label } from "@/lib/quran/verse-label";
import type { QuranHit } from "@/lib/quran/types";

export type QuranCard = {
  sura: number;
  sura_name_ar: string;
  sura_name_ug: string;
  from: number;
  to: number;
  label: string;
  /** The verses of the group that matched, in mushaf order. */
  verses: { aya: number; text_ar: string }[];
  /** The group's translation; "" when the verse has none. */
  text_ug: string;
  /**
   * The verse whose text is the group's when no hit carried it (53:14 found
   * without 53:13) — the caller reads that text; otherwise null.
   */
  needsTextOf: number | null;
};

/** One card per group, in the order its first hit came back in. */
export function groupQuranHits(hits: readonly QuranHit[]): QuranCard[] {
  const cards: QuranCard[] = [];
  const byGroup = new Map<string, QuranCard>();
  const carriesText = new Set<QuranCard>();

  for (const hit of hits) {
    const range = groupOf(hit.sura, hit.aya);
    const key = `${hit.sura}:${range.from}`;
    let card = byGroup.get(key);
    if (!card) {
      card = {
        sura: hit.sura,
        sura_name_ar: hit.sura_name_ar,
        sura_name_ug: hit.sura_name_ug,
        ...range,
        label: label(range.from, range.to),
        verses: [],
        text_ug: "",
        needsTextOf: null,
      };
      byGroup.set(key, card);
      cards.push(card);
    }
    card.verses.push({ aya: hit.aya, text_ar: hit.text_ar });
    if (hit.text_ug.length > card.text_ug.length) card.text_ug = hit.text_ug;
    if (hit.aya === groupTextAya(hit.sura, hit.aya)) carriesText.add(card);
  }

  for (const card of cards) {
    card.verses.sort((a, b) => a.aya - b.aya);
    const wanted = groupTextAya(card.sura, card.from);
    if (wanted !== null && !carriesText.has(card)) card.needsTextOf = wanted;
  }
  return cards;
}
