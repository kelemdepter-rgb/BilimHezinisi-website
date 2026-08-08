-- ============================================================================
-- Drop the snippet columns from search_quran.
--
-- 0007 highlighted matches with ts_headline. ts_headline can only mark up the
-- text it tokenizes, and the tokens the index matched come from
-- ug_normalize(text_ar_simple) — tashkil stripped, alif variants folded. So a
-- highlighted result showed the Quran stripped of its vowel marks, which is
-- not how it is written.
--
-- Highlighting now happens in the browser against the ORIGINAL text_ar, where
-- the client-side twin of ug_normalize() works per character and can map a
-- match back to real offsets in the verse (components/quran/aya-text.tsx).
-- That leaves the two ts_headline calls per row computing something nobody
-- reads, so they go: less CPU per search, and less egress on the free tier.
--
-- text_ar and text_ug were already returned in full, so the rows the page
-- needs are unchanged.
-- ============================================================================

drop function if exists public.search_quran(text, int, int);

create function public.search_quran(
  q text,
  lim int default 50,
  off int default 0
)
returns table (
  sura int,
  aya int,
  sura_name_ar text,
  sura_name_ug text,
  text_ar text,
  text_ug text,
  rank real
)
language sql
stable
as $fn$
  with tsq as (
    select websearch_to_tsquery('simple', public.ug_normalize(q)) as query
  )
  select
    a.sura,
    a.aya,
    s.name_ar as sura_name_ar,
    s.name_ug as sura_name_ug,
    a.text_ar,
    a.text_ug,
    ts_rank(
      to_tsvector('simple', public.ug_normalize(a.text_ar_simple || ' ' || a.text_ug)),
      tsq.query
    ) as rank
  from public.quran_ayas a
  join public.quran_suras s on s.number = a.sura
  cross join tsq
  where to_tsvector('simple', public.ug_normalize(a.text_ar_simple || ' ' || a.text_ug)) @@ tsq.query
  order by rank desc, a.sura, a.aya
  limit greatest(coalesce(lim, 50), 0)
  offset greatest(coalesce(off, 0), 0)
$fn$;

grant execute on function public.search_quran(text, int, int) to anon, authenticated;
