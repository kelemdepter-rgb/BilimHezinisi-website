-- ============================================================================
-- 0019 was correct and slower. This is 0019, measured.
--
-- Against the live library, search went the wrong way:
--
--   «ناماز»       397 → 666 ms      «پەيغەمبەر»  382 → 649 ms
--   «نامازغا چا»  266 → 480 ms      «زاكات»      278 → 479 ms
--
-- Two separate costs, both mine, both avoidable.
--
-- ── 1. ug_normalize() ran twice per candidate row ───────────────────────────
-- The literal check normalized the page, and ts_rank then normalized the same
-- page again to build its tsvector. At roughly 0.9 ms per row over 301 rows
-- that is the ~270 ms the single-word queries lost. Normalizing once into a
-- materialized CTE and feeding both from it puts it back: 200 → 131 ms on a
-- 900-page corpus, against 123 ms for the pre-0019 function.
--
-- `as materialized` is load-bearing. Postgres inlines a CTE referenced once,
-- which would recompute the expression at each use and undo the whole point.
--
-- ── 2. The snippet regex backtracked over the page ──────────────────────────
-- ug_snippet asked for the phrase WITH its context baked into the pattern:
--
--     substring(doc from '(?i).{0,70}' || phrase_pattern || '.{0,70}')
--
-- A leading `.{0,70}` makes the engine retry the phrase from 70 different
-- starting points at every position in a 2 KB page, and the phrase pattern
-- itself is 20-odd alternating character classes. Measured per call:
--
--     with context in the pattern     56 ms
--     pattern alone, then strpos       1 ms
--
-- Only the ≤20 rows that are actually returned pay it, which is why the phrase
-- queries lost ~200 ms rather than ~2 s. Matching the phrase alone and locating
-- it with strpos afterwards gives the same window for a fiftieth of the cost.
--
-- Nothing about what matches changes here — only what it costs. The parity
-- test in tests/unit/sql-parity.test.ts applies this file too and still holds
-- SQL to the client matcher, page by page.
-- ============================================================================

-- ── The excerpt, without the backtracking ───────────────────────────────────
create or replace function public.ug_snippet(doc text, q text, ctx int default 70)
returns text
language sql
immutable
parallel safe
as $fn$
  with bounds as (
    select greatest(coalesce(ctx, 70), 0) as width
  ),
  hit as (
    -- The phrase alone. Context is cut afterwards, from real offsets, rather
    -- than asked of the regex engine.
    select case
             when public.ug_phrase_regex(q) is null then null
             else substring(doc from '(?i)' || public.ug_phrase_regex(q))
           end as text
  ),
  placed as (
    select hit.text, strpos(doc, hit.text) as at
    from hit
    where hit.text is not null and hit.text <> ''
  ),
  cut as (
    select
      greatest(1, placed.at - bounds.width) as from_at,
      substr(
        doc,
        greatest(1, placed.at - bounds.width),
        placed.at + length(placed.text) + bounds.width - greatest(1, placed.at - bounds.width)
      ) as text
    from placed
    cross join bounds
  )
  select coalesce(
    (
      select
        case when cut.from_at > 1 then '…' else '' end
        || btrim(regexp_replace(cut.text, '\s+', ' ', 'g'))
        || case when cut.from_at + length(cut.text) - 1 < length(doc) then '…' else '' end
      from cut
    ),
    -- The phrase is not literally present. search_books filters such rows out;
    -- this keeps the function total for any other caller.
    (
      select btrim(regexp_replace(left(coalesce(doc, ''), bounds.width * 2), '\s+', ' ', 'g'))
      from bounds
    )
  )
$fn$;

grant execute on function public.ug_snippet(text, text, int) to anon, authenticated;

-- ── Normalize each candidate page once, and use it twice ────────────────────
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
  rank real,
  capped boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with tsq as (
    select
      public.ug_tsquery(q) as query,
      public.ug_normalize(q) as needle
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
      and position(tsq.needle in public.ug_normalize(b.title || ' ' || b.author)) > 0
  ),
  -- 301, not 300: the extra row tells "exactly 300 matches" from "more than we
  -- are willing to rank". The bound is on the INDEX scan, so the literal check
  -- below can never make Postgres read more rows than this.
  raw_candidates as (
    select b.id as book_id, b.title, b.author, b.cover_path, p.page_no, p.content
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ tsq.query
    limit 301
  ),
  -- Normalized ONCE. Both the literal check and the ranking read this column;
  -- inlining it would restore the double cost this migration exists to remove.
  normalized as materialized (
    select c.*, public.ug_normalize(c.content) as norm
    from raw_candidates c
  ),
  -- The index answers "these lexemes, adjacent". Punctuation between the words
  -- satisfies that and is not the phrase, so a row that cannot be highlighted
  -- is not returned.
  page_hits as (
    select
      n.book_id,
      n.title,
      n.author,
      n.cover_path,
      n.page_no,
      null::text as ready_snippet,
      n.content,
      ts_rank(to_tsvector('simple', n.norm), tsq.query) as rank
    from normalized n
    cross join tsq
    where tsq.needle <> ''
      and position(tsq.needle in n.norm) > 0
  ),
  overflow as (
    select count(*) > 300 as capped from raw_candidates
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
    coalesce(t.ready_snippet, public.ug_snippet(t.content, q, 70)) as snippet,
    t.rank,
    overflow.capped
  from top_hits t
  cross join overflow
  order by t.rank desc, t.book_id, t.page_no
$fn$;

grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;

-- ── The reader's navigator, normalized once as well ─────────────────────────
-- 0017 wrote ug_normalize(content) three times in the counting expression, and
-- 0019 kept it. On the widest queries that is what made stepping through a book
-- cost 1.7 s.
create or replace function public.book_match_pages(
  book_id bigint,
  q text,
  lim int default 500
)
returns table (
  page_no int,
  hits int
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with tsq as (
    select public.ug_tsquery(q) as query, public.ug_normalize(q) as needle
  ),
  candidates as (
    select p.page_no, p.content
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where p.book_id = book_match_pages.book_id
      and b.status = 'published'
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ tsq.query
    order by p.page_no
    limit greatest(coalesce(lim, 500), 0)
  ),
  normalized as materialized (
    select c.page_no, public.ug_normalize(c.content) as norm
    from candidates c
  ),
  counted as (
    select
      n.page_no,
      ((length(n.norm) - length(replace(n.norm, tsq.needle, ''))) / nullif(length(tsq.needle), 0))::int as hits
    from normalized n
    cross join tsq
    where tsq.needle <> ''
  )
  select counted.page_no, counted.hits
  from counted
  where counted.hits > 0
  order by counted.page_no
$fn$;

grant execute on function public.book_match_pages(bigint, text, int) to anon, authenticated;
