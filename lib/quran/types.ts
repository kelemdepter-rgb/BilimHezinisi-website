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

/** One row of search_quran (migration 0007). */
export type QuranHit = {
  sura: number;
  aya: number;
  sura_name_ar: string;
  sura_name_ug: string;
  text_ar: string;
  text_ug: string;
  snippet_ar: string;
  snippet_ug: string;
  rank: number;
};
