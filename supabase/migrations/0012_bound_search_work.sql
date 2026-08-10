-- ============================================================================
-- Make search cost depend on the answer, not on the library.
--
-- 0011 got the index used again — a query matching nothing now returns in
-- 85 ms instead of timing out. What is left is the opposite case: a word that
-- matches almost everything.
--
--   "پەيغەمبەر" matches 3,756 of the library's 4,153 pages, and took 4,757 ms
--   even with RLS bypassed. "ھەدىس", far more selective, took 304 ms.
--
-- To return twenty rows the old query did two expensive things to all 3,756:
--
--   * ts_headline() built a highlighted snippet for every match, when only the
--     twenty rows actually shown need one. Headlining is the most expensive
--     operation in the query — it re-tokenizes the page and searches for the
--     best fragment.
--   * ts_rank() re-derived to_tsvector(ug_normalize(content)) per row, because
--     0006 traded the stored tsvector column for an expression index. The
--     index answers "does this page match", but its tsvector cannot be read
--     back out, so ranking rebuilds it from ~2,500 characters of Uyghur text.
--
-- Both are now bounded:
--
--   1. Ranking considers at most CANDIDATE_CAP matching pages. Below that —
--      every query narrow enough to be worth ranking — the ordering is exactly
--      as before. Above it, the cap decides which matches get ranked; when a
--      word appears on nine pages in ten, which twenty come back matters far
--      less than getting an answer at all.
--   2. Snippets are built only for the page of results being returned.
--
-- The cap is 1,000, which matches the offset ceiling the app already enforces
-- in lib/search.ts, so paging cannot walk off the end of the ranked set.
-- ============================================================================

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
  -- Bounded by the cap: the scan stops here rather than dragging every match
  -- through ranking. No ORDER BY on purpose — ordering would defeat the point.
  page_candidates as (
    select b.id as book_id, b.title, b.author, b.cover_path, p.page_no, p.content
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ tsq.query
    limit 1000
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
  -- One page of results, chosen before any snippet is built.
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
