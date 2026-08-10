-- ============================================================================
-- Book search times out for anonymous visitors once the library holds real
-- books. Measured on this project with 5 books / 2,751 pages:
--
--   service role (RLS bypassed):  "ھەدىس" → 5 hits in 445 ms
--   anon key     (RLS applied):   "ھەدىس" → statement timeout at 3 s
--   anon key, a query matching NOTHING:      statement timeout at 3 s
--
-- The last line is the tell. A query with no matches should return instantly
-- off the index; it only takes seconds if the index is not being used at all.
--
-- Two things go wrong under RLS, and both are fixed here.
--
--   1. search_books ran as SECURITY INVOKER, so the planner had to combine the
--      row-security predicate with the FTS condition. ug_normalize() is not
--      leakproof — it is a user-defined function — so Postgres may not push the
--      indexable @@ test below the security barrier, and falls back to scanning
--      every page and normalizing its text.
--
--      The function is now SECURITY DEFINER. That is safe here because the
--      function's own WHERE clause is stricter than the policy it replaces: it
--      has always returned `b.status = 'published'` rows only, for every
--      caller, staff included. Nothing becomes visible that was not visible
--      before — see the search_books body, unchanged from 0006 apart from this.
--
--   2. The book_pages read policy called is_uploader_or_admin() INSIDE a
--      correlated EXISTS, so the role lookup ran once per candidate row —
--      thousands of queries against `profiles` for one search. Wrapping it in a
--      scalar subquery makes Postgres evaluate it once for the whole statement
--      (the same trick the per-user policies already use with auth.uid()), and
--      leaves a primary-key lookup as the only per-row work. That is the
--      reader's page-fetch path too, not just search.
-- ============================================================================

-- ── 1. Search runs as its owner, bounded by its own published-only filter ───
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
      b.title as snippet,
      (32.0 + ts_rank(to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)), tsq.query))::real as rank
    from public.books b
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)) @@ tsq.query
  ),
  page_hits as (
    select
      b.id as book_id,
      b.title,
      b.author,
      b.cover_path,
      p.page_no,
      ts_headline(
        'simple',
        p.content,
        tsq.query,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter= … '
      ) as snippet,
      ts_rank(to_tsvector('simple', public.ug_normalize(p.content)), tsq.query) as rank
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ tsq.query
  )
  select *
  from (
    select * from title_hits
    union all
    select * from page_hits
  ) hits
  order by hits.rank desc, hits.book_id, hits.page_no
  limit greatest(coalesce(lim, 20), 0)
  offset greatest(coalesce(off, 0), 0)
$fn$;

grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;

-- ── 2. Evaluate the staff check once per statement, not once per row ────────
drop policy if exists "book_pages_select_published_or_staff" on public.book_pages;
create policy "book_pages_select_published_or_staff" on public.book_pages
  for select using (
    (select public.is_uploader_or_admin())
    or exists (
      select 1 from public.books b
      where b.id = book_id and b.status = 'published'
    )
  );

drop policy if exists "books_select_published_or_staff" on public.books;
create policy "books_select_published_or_staff" on public.books
  for select using (
    status = 'published' or (select public.is_uploader_or_admin())
  );

-- ── 3. The planner has stale numbers after the import and the deletions ─────
analyze public.books;
analyze public.book_pages;
