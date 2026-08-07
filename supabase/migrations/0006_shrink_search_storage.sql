-- ============================================================================
-- Shrink the search footprint so the library lasts on Supabase Free (500 MB).
--
-- Two changes, both about storing the same text fewer times:
--
--   1. Drop the pg_trgm index over page content. A GIN trigram index holds
--      every 3-character sequence of every page and typically costs 1–3× the
--      text itself — the single largest consumer in this schema. Page search
--      continues through the FTS index, which is what search_books uses.
--      The trigram index on books.title||author is KEPT: it is tiny and it is
--      what makes partial-title lookup work.
--
--   2. Replace the STORED content_norm tsvector with an expression index.
--      The stored column is a second full copy of the search data; an
--      expression index keeps the lookup without keeping the copy.
--
-- search_books is rewritten to use the identical expression, so the planner
-- still picks the index (verify with explain analyze: expect a Bitmap Index
-- Scan on book_pages_fts_idx, never a Seq Scan).
-- ============================================================================

-- ── 1. Drop the trigram index on page content ───────────────────────────────
drop index if exists public.book_pages_trgm_idx;

-- ── 2. Stored tsvector column → expression index ────────────────────────────
drop index if exists public.book_pages_fts_idx;
alter table public.book_pages drop column if exists content_norm;

create index book_pages_fts_idx on public.book_pages
  using gin (to_tsvector('simple', public.ug_normalize(content)));

-- Long text should be compressed and moved out of line. `extended` is the
-- default for text, but set it explicitly so it cannot drift.
alter table public.book_pages alter column content set storage extended;

-- ── 3. search_books against the expression ──────────────────────────────────
-- Behaviour is unchanged: same ranking, same snippets, same title boost. Only
-- the source of the tsvector differs.
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
      -- Computed only for rows the index already matched.
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

-- Refresh planner statistics for the new expression index.
analyze public.book_pages;

-- NOTE: no VACUUM here on purpose.
-- Dropping the index frees its space immediately, but the dropped column's
-- bytes stay in the existing rows until the table is rewritten. VACUUM FULL
-- does that — and it CANNOT run inside a transaction block, which is how
-- migration tools (and the Supabase SQL Editor) execute a script. Run it
-- separately, on its own, when convenient:
--
--     vacuum full public.book_pages;
--
-- Autovacuum also reclaims the space over time, so this is optional.
