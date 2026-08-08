-- ============================================================================
-- Phase 5 — Quran module.
--
-- Three changes:
--
--   1. Apply the Phase-4 storage lesson (0006) to quran_ayas. The stored
--      `text_norm` tsvector is a second full copy of the Arabic + Uyghur
--      search text; an expression index keeps the lookup without keeping the
--      copy. search_quran is rewritten against the identical expression so
--      the planner still picks the index — verify with explain_quran_search().
--      No trigram index over Quran text on purpose: a GIN trigram index costs
--      1–3× the text itself, and the Quran is fixed-size reference data that
--      FTS already covers.
--
--   2. search_quran gains highlighted snippets and the Arabic sura name, so
--      the web results can look like the desktop hit list. The return type
--      changes, so the old function is dropped first.
--
--   3. quran_bookmarks: a per-user, aya-addressed bookmark table. The
--      existing `bookmarks` table is book-addressed (book_id NOT NULL,
--      foreign key to books) and stays exactly as it is.
-- ============================================================================

-- ── 1. Stored tsvector column → expression index ────────────────────────────
drop index if exists public.quran_ayas_fts_idx;
alter table public.quran_ayas drop column if exists text_norm;

create index quran_ayas_fts_idx on public.quran_ayas
  using gin (to_tsvector('simple', public.ug_normalize(text_ar_simple || ' ' || text_ug)));

-- Verse text should be compressed and moved out of line when it is long
-- enough to warrant it. `extended` is the default for text, but set it
-- explicitly so it cannot drift.
alter table public.quran_ayas alter column text_ar set storage extended;
alter table public.quran_ayas alter column text_ar_simple set storage extended;
alter table public.quran_ayas alter column text_ug set storage extended;

-- ── 2. search_quran against the expression, with snippets ───────────────────
drop function if exists public.search_quran(text, int, int);

-- Ranked search over the Arabic (tashkil-stripped) and Uyghur columns
-- together. websearch_to_tsquery gives the same "quoted phrase" / OR /
-- -exclusion operators as the book search.
--
-- Snippets run over ug_normalize()d text on purpose: the index matched the
-- normalized form, so highlighting the raw text_ar (every word carries
-- tashkil) would find nothing and silently return an unhighlighted prefix.
-- The full, unmodified text_ar is returned alongside for callers that want
-- the mushaf spelling.
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
  snippet_ar text,
  snippet_ug text,
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
    ts_headline(
      'simple',
      public.ug_normalize(a.text_ar_simple),
      tsq.query,
      'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter= … '
    ) as snippet_ar,
    ts_headline(
      'simple',
      public.ug_normalize(a.text_ug),
      tsq.query,
      'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter= … '
    ) as snippet_ug,
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

-- Diagnostic: the query plan behind search_quran, so index usage can be
-- proven rather than assumed (same spirit as the db_*_stats helpers in 0005).
-- The SQL text is fixed and the term is bound as a parameter, so there is no
-- injection surface; still, only the service role may call it.
create or replace function public.explain_quran_search(q text)
returns setof text
language plpgsql
as $fn$
begin
  return query execute
    'explain (analyze, buffers) '
    'select a.sura, a.aya from public.quran_ayas a '
    'where to_tsvector(''simple'', public.ug_normalize(a.text_ar_simple || '' '' || a.text_ug)) '
    '     @@ websearch_to_tsquery(''simple'', public.ug_normalize($1))'
  using q;
end;
$fn$;

revoke execute on function public.explain_quran_search(text) from public, anon, authenticated;

-- ── 3. Quran bookmarks (per user, one row per aya) ──────────────────────────
create table public.quran_bookmarks (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sura int not null references public.quran_suras (number),
  aya int not null,
  created_at timestamptz not null default now(),
  unique (user_id, sura, aya)
);

create index quran_bookmarks_user_idx on public.quran_bookmarks (user_id, sura, aya);

alter table public.quran_bookmarks enable row level security;

create policy "quran_bookmarks_owner" on public.quran_bookmarks
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Refresh planner statistics for the new expression index.
analyze public.quran_ayas;

-- NOTE: as in 0006, no VACUUM here. Dropping text_norm frees its bytes only
-- when the table is rewritten, and VACUUM FULL cannot run inside the
-- transaction block a migration executes in. If quran_ayas already held rows
-- when this ran, reclaim the space separately, on its own:
--
--     vacuum full public.quran_ayas;
--
-- Autovacuum gets there eventually too, so this is optional.
