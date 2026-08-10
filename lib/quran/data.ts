import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Aya, QuranHit, Sura } from "@/lib/quran/types";

const SURA_COLUMNS = "number, name_ar, name_ug, name_translit, revelation, aya_count";

/** All 114 suras, in mushaf order. */
export async function getSuras(): Promise<Sura[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("quran_suras")
    .select(SURA_COLUMNS)
    .order("number", { ascending: true });
  return (data as Sura[] | null) ?? [];
}

/** Every aya of one sura, in order. A sura is one page — no lazy loading. */
export async function getAyas(suraNumber: number): Promise<Aya[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("quran_ayas")
    .select("sura, aya, text_ar, text_ug")
    .eq("sura", suraNumber)
    .order("aya", { ascending: true });
  return (data as Aya[] | null) ?? [];
}

/** The ayas of one sura the signed-in user has bookmarked. */
export async function getSuraBookmarks(suraNumber: number): Promise<number[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("quran_bookmarks")
    .select("aya")
    .eq("sura", suraNumber)
    .order("aya", { ascending: true });
  return ((data as { aya: number }[] | null) ?? []).map((row) => row.aya);
}

export type QuranSearchOutcome = {
  hits: QuranHit[];
  elapsedMs: number;
  failed: boolean;
  moreAvailable: boolean;
};

/**
 * Quran-only search (migration 0007). Separate RPC, separate page and
 * separate results from the book search — neither can leak into the other.
 *
 * Asks for one row beyond the page size to learn whether a next page exists.
 */
/** Ceilings applied here, not only in the UI — the query string is a visitor's. */
const MAX_LIMIT = 50;
const MAX_OFFSET = 1000;

export async function runQuranSearch(input: {
  query: string;
  limit: number;
  offset: number;
}): Promise<QuranSearchOutcome> {
  const empty: QuranSearchOutcome = { hits: [], elapsedMs: 0, failed: false, moreAvailable: false };
  if (!input.query) return empty;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return empty;

  const limit = Math.min(Math.max(1, Math.floor(input.limit)), MAX_LIMIT);
  const offset = Math.min(Math.max(0, Math.floor(input.offset)), MAX_OFFSET);

  const started = Date.now();
  const { data, error } = await supabase.rpc("search_quran", {
    q: input.query,
    lim: limit + 1,
    off: offset,
  });
  const elapsedMs = Date.now() - started;

  const rows = (data as QuranHit[] | null) ?? [];
  return {
    hits: rows.slice(0, limit),
    elapsedMs,
    failed: Boolean(error),
    moreAvailable: rows.length > limit,
  };
}
