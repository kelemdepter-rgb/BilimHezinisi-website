/** Shapes returned by the Quran tables and the search_quran RPC. */

export type Sura = {
  number: number;
  name_ar: string;
  name_ug: string;
  name_translit: string;
  revelation: string;
  aya_count: number;
};

export type Aya = {
  sura: number;
  aya: number;
  text_ar: string;
  text_ug: string;
};

/**
 * One row of search_quran (migration 0008). The verses come back whole and
 * unmodified — the Uthmani spelling with its tashkil — and the query is
 * highlighted client-side against that original text. See AyaText for why
 * the database cannot do the highlighting without damaging the verse.
 */
export type QuranHit = {
  sura: number;
  aya: number;
  sura_name_ar: string;
  sura_name_ug: string;
  text_ar: string;
  text_ug: string;
  rank: number;
};
