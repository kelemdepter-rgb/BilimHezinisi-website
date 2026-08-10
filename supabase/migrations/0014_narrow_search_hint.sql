-- ============================================================================
-- Trade ranking depth for shelf space, and say so out loud.
--
-- 0013 precomputed a tsvector per page to make ranking a column read. It
-- worked — the worst case fell from ~1,000 ms to ~150 ms — but it cost 16.3 MB
-- on 4,153 pages, not the 4.9 MB estimated from the Quran tables. The estimate
-- was drawn from short verses, which stay inline and compress well; a 2,175-
-- character page produces a vector that is TOASTed out of line and compresses
-- poorly. Per book that is 4.12 MB with the column against 2.09 MB without.
--
-- The owner has no budget and no paid plan is possible, so 500 MB is a
-- permanent ceiling: the column would halve the library from roughly 230 books
-- to roughly 115. Space wins. The column goes.
--
-- Which brings back the real constraint: ranking recomputes a tsvector per
-- candidate row, at ~0.9 ms each, so the number of rows ranked is a time
-- budget. 300 rows ≈ 270 ms, and it stays 270 ms however large the library
-- grows — that bound is the point.
--
-- What changes is honesty about the bound. Until now a broad query silently
-- returned twenty rows out of an arbitrary sample, as if they were the best
-- matches. Measured against this library of 4,153 pages:
--
--   پەيغەمبەر  3,747 pages (90%)      رىۋايەت  3,008 (72%)
--   ناماز        891 (21%)            روزا       221        ھەج  208
--   ھەدىس        193                  ئىمان     138        زاكات 115
--
-- So the function now reports whether it hit the cap, and the page tells the
-- reader plainly that the word is too common and a second word would narrow
-- it. Results are still shown — a search that answers nothing is worse than
-- one that answers roughly and says so.
-- ============================================================================

-- ── 1. Give the space back ──────────────────────────────────────────────────
-- The expression index returns; it holds the same lexemes as the column did,
-- so search still matches exactly what it matched before.
alter table public.book_pages drop column if exists content_norm;

drop index if exists public.book_pages_fts_idx;
create index book_pages_fts_idx on public.book_pages
  using gin (to_tsvector('simple', public.ug_normalize(content)));

analyze public.book_pages;

-- ── 2. search_books reports when it could not rank everything ───────────────
-- The return type gains a column, so the old function has to go first.
drop function if exists public.search_books(text, bigint, int, int);

create function public.search_books(
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
  rank real,
  capped boolean
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
  -- 301, not 300: the extra row is how we tell "exactly 300 matches" from
  -- "more than we are willing to rank".
  page_candidates as (
    select b.id as book_id, b.title, b.author, b.cover_path, p.page_no, p.content
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ tsq.query
    limit 301
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
      ts_rank(to_tsvector('simple', public.ug_normalize(c.content)), tsq.query) as rank
    from page_candidates c
    cross join tsq
  ),
  overflow as (
    select count(*) > 300 as capped from page_candidates
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
    t.rank,
    overflow.capped
  from top_hits t
  cross join tsq
  cross join overflow
  order by t.rank desc, t.book_id, t.page_no
$fn$;

grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;

-- NOTE: dropping content_norm frees its bytes only when the table is
-- rewritten, and VACUUM FULL cannot run inside a migration's transaction.
-- Run it separately afterwards to actually get the 16 MB back:
--
--     vacuum full public.book_pages;
