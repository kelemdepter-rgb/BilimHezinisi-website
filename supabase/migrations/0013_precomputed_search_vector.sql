-- ============================================================================
-- Make ranking a lookup instead of a computation.
--
-- This partially reverses 0006, on evidence 0006 could not have had. That
-- migration dropped book_pages.content_norm — a stored tsvector — in favour of
-- an expression index, and measured a 68% storage saving against a library of
-- FOUR pages. The search cost of the trade was invisible at that size. With
-- 4,153 real pages it is the dominant cost in the system:
--
--   GIN answers "does this page match". It cannot hand back the tsvector it
--   matched on, so ts_rank had to rebuild one — two regexp_replace passes, a
--   translate and a tokenization over ~2,175 characters of Uyghur text, per
--   candidate row. Measured: 0.9 ms per row, ~900 ms for the 1,000-row cap
--   0012 imposed. Headlining, by comparison, costs 0.37 ms per row, and 0012
--   already reduced that to the twenty rows actually shown.
--
-- Storing the vector makes ranking a column read: the work moves to write
-- time, where it happens once per page, instead of query time, where it
-- happened once per page per search.
--
-- The price, measured rather than guessed. 4,153 pages hold 9,037,638
-- characters (15.65 MB of UTF-8, 7.38 MB stored after compression). The Quran
-- tables give a calibration for this exact database — removing their stored
-- tsvector in 0007 freed 2.69 MB for 2.22 M characters, so 1.21 bytes per
-- character — which puts this column at about 4.9 MB compressed, against a
-- 36 MB database. Roughly 13% more space for roughly 45× cheaper ranking, and
-- it stays proportional as the library grows.
--
-- The candidate cap stays, because scale-independence is the point: with the
-- vector precomputed, 5,000 rows now cost less than 1,000 did before, so the
-- cap rises fivefold while the worst case still cannot grow with the library.
-- ============================================================================

-- ── 1. Precompute the search vector ─────────────────────────────────────────
-- GENERATED ALWAYS means it can never drift from the content it describes:
-- Postgres recomputes it on every insert and update, and nothing can write it
-- directly. This rewrites the table, which takes a moment and briefly locks it.
alter table public.book_pages
  add column if not exists content_norm tsvector
  generated always as (to_tsvector('simple', public.ug_normalize(content))) stored;

-- ── 2. Index the column rather than the expression ──────────────────────────
-- Same contents, same size; the planner can now also read the value back.
drop index if exists public.book_pages_fts_idx;
create index book_pages_fts_idx on public.book_pages using gin (content_norm);

analyze public.book_pages;

-- ── 3. Rank from the stored vector ──────────────────────────────────────────
-- Structure is 0012's — bounded candidates, snippets only for the rows
-- returned — with ts_rank and the match test now reading content_norm.
create or replace function public.search_books(
  q text,
  category_id bigint default null,
  lim int default 20,
  off int default 0
)
returns table (
  book_id bigint,
  title text,
  author text,
  cover_path text,
  page_no int,
  snippet text,
  rank real
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with tsq as (
    select websearch_to_tsquery('simple', public.ug_normalize(q)) as query
  ),
  title_hits as (
    select
      b.id as book_id,
      b.title,
      b.author,
      b.cover_path,
      0 as page_no,
      b.title as ready_snippet,
      null::text as content,
      (32.0 + ts_rank(to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)), tsq.query))::real as rank
    from public.books b
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)) @@ tsq.query
  ),
  page_candidates as (
    select b.id as book_id, b.title, b.author, b.cover_path, p.page_no, p.content, p.content_norm
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and p.content_norm @@ tsq.query
    limit 5000
  ),
  page_hits as (
    select
      c.book_id,
      c.title,
      c.author,
      c.cover_path,
      c.page_no,
      null::text as ready_snippet,
      c.content,
      ts_rank(c.content_norm, tsq.query) as rank
    from page_candidates c
    cross join tsq
  ),
  top_hits as (
    select *
    from (
      select * from title_hits
      union all
      select * from page_hits
    ) hits
    order by hits.rank desc, hits.book_id, hits.page_no
    limit greatest(coalesce(lim, 20), 0)
    offset greatest(coalesce(off, 0), 0)
  )
  select
    t.book_id,
    t.title,
    t.author,
    t.cover_path,
    t.page_no,
    coalesce(
      t.ready_snippet,
      ts_headline(
        'simple',
        t.content,
        tsq.query,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter= … '
      )
    ) as snippet,
    t.rank
  from top_hits t
  cross join tsq
  order by t.rank desc, t.book_id, t.page_no
$fn$;

grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;
