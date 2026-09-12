-- ============================================================================
-- Every search path uses the full-text index, whatever the planner thinks.
--
-- On 2026-09-11, with the search box's scope left at «بارلىق كىتابلار» — the
-- default on every page — every search on the live site answered «ئىزدەشتە
-- خاتالىق كۆرۈلدى». Measured as an anonymous visitor (the site's own public
-- key through PostgREST, so the 3 s statement timeout every reader without an
-- account gets), on 50 published books / 17,601 pages:
--
--   search_books('ناماز', null)                        57014 statement timeout, 3.1–3.4 s
--   search_books(<a word found nowhere>, null)         57014 after 3.2 s
--   … the nowhere-word, category 447 (15 pages)         104–160 ms
--   … category 17 (119 pages)                            194–220 ms
--   … category 402 (551 pages)                           531–555 ms
--   … category 21 (1,123 pages)                          995–1,084 ms
--   … category 15 (7,642 pages)                        57014 after 3.1 s
--   book_match_pages(1308 [2,966 pages], 'ناماز')        2,747 ms — 250 ms from the wall
--
-- A word found nowhere should cost the same few milliseconds in any scope:
-- the index answers "nothing" at once — 0011 calls that the tell. Here it
-- cost ~0.85 ms PER PAGE IN SCOPE, linearly, until the wall: ug_normalize()
-- and to_tsvector() were being run on every page in scope instead of the
-- index book_pages_fts_idx (0014) being read. On 2026-09-02 the same calls
-- took 104 ms (nowhere-phrase) and 474 ms («ناماز»): a regression.
--
-- ── What the live database said (PROMPT-32, Part 0, 2026-09-12) ─────────────
-- The owner ran the read-only diagnostic in the SQL Editor:
--
--   PostgreSQL 17.6 (aarch64)   plan_cache_mode=auto  random_page_cost=1.1
--                               work_mem=2184 kB  effective_cache_size=49152 pages
--   index: book_pages_fts_idx   valid=t ready=t size=31 MB
--     def=CREATE INDEX book_pages_fts_idx ON public.book_pages USING gin
--         (to_tsvector('simple'::regconfig, ug_normalize(content)))
--   ug_normalize(text)          one overload, volatile=i, config=-
--   search_books is 0023        true
--   book_pages                  live=18,936 rows (drafts included), analyzed
--                               2026-08-10 (0014), autoanalyzed since
--
-- and EXPLAIN (ANALYZE, BUFFERS) of the bare predicate with the nowhere-word:
--
--   Limit  (cost=11.27..139.33 rows=95)  (actual time=3.876..3.877 rows=0)
--     -> Bitmap Heap Scan on book_pages p
--          Recheck Cond: (to_tsvector('simple', lower(TRIM(BOTH FROM regexp_… @@ …
--          -> Bitmap Index Scan on book_pages_fts_idx  (cost=0.00..11.24 rows=95)
--   Buffers: shared hit=5   Execution Time: 3.923 ms
--
-- So this is cause (B). The index is valid, ready and used the moment the
-- planner can see the word — the bare predicate answers in 4 ms, reading five
-- buffers of a 31 MB index — and the functions' own plans, made with the word
-- unknown, were the only thing not using it. (rows=95 is the planner's default
-- 0.005 guess for a lexeme it has no number for; even on that guess the index
-- plan costs 139 against thousands for a walk of every page, which is the
-- choice a generic plan inside the functions failed to make.) Nothing about
-- ug_normalize needed changing, and section 1 below finds this index healthy
-- and leaves it alone.
--
-- ── Why the language changes ────────────────────────────────────────────────
-- Both functions were LANGUAGE sql. Below Postgres 18 such a function plans
-- each statement once per call with its parameters UNKNOWN: the tsquery is a
-- Param, so `@@` gets the default selectivity guess — 0.005, 88 rows of
-- 17,601 whatever the word — and ug_normalize is inlined into a handful of
-- builtins the planner costs at a fraction of a millisecond when it really
-- costs ~0.9 ms a page. On those numbers walking every page in scope looks as
-- cheap as the index, and the planner is free to choose it. 0023 then added a
-- recursive CTE and the catch-all `(category_id is null or b.category_id =
-- any (scope.ids))`: the textbook shape that tips a generic plan the wrong way.
--
-- So both functions become PL/pgSQL with `plan_cache_mode = force_custom_plan`.
-- PL/pgSQL runs its statements through the plan cache, and force_custom_plan
-- makes EVERY execution planned with the actual values: the planner sees the
-- literal tsquery, estimates its rows from the index's own statistics (on the
-- audit's replica 4,284 for «ناماز», 496 for «زاكات», one for a word found
-- nowhere — the actual counts, where the guess for an unknown query is 88),
-- and a whole-library search carries no category predicate at all. A LANGUAGE
-- sql function cannot be told this on Postgres ≤ 17: it never touches the plan
-- cache, so plan_cache_mode does not apply to it.
--
-- ── What deliberately did not change ────────────────────────────────────────
-- What a search MATCHES. The ranking, the title boost, the 301-row candidate
-- cap and its `capped` flag, normalizing each candidate once (`as
-- materialized`, 0020), the literal position() check (0019), the order, the
-- limit/offset and the snippet are 0023's and 0020's line for line; only the
-- category predicate is split into two statements, whole library or scoped,
-- so neither carries a condition it does not need. ug_normalize, ug_tsquery,
-- ug_phrase_regex, ug_snippet and search_quran are untouched — changing
-- ug_normalize would rebuild the index and change every match.
-- tests/unit/sql-parity.test.ts applies this file and holds the new bodies to
-- 0023's and 0020's row for row; tests/unit/search-index.test.ts fails the
-- moment any path stops touching the index.
--
-- ── The index guard, and why this file is safe to run twice ─────────────────
-- Section 1 recreates book_pages_fts_idx ONLY when it is missing, invalid,
-- not ready, or defined on anything other than the expression the functions
-- use; otherwise it does nothing. A rebuild costs about 0.9 ms per page (the
-- audit's local build of 17,601 pages took 18 s) and blocks WRITES to
-- book_pages while it runs — reads carry on. It is a plain `create index`:
-- `concurrently` is not allowed inside a DO block or a transaction, and the
-- SQL Editor runs this whole file as one.
-- ============================================================================

-- ── 1. The index, guaranteed ────────────────────────────────────────────────
do $$
declare
  v_def   text;
  v_valid boolean;
  v_ready boolean;
begin
  select pg_get_indexdef(i.indexrelid), i.indisvalid, i.indisready
    into v_def, v_valid, v_ready
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'book_pages_fts_idx'
    and i.indrelid = 'public.book_pages'::regclass;

  -- The definition the functions below rely on, as pg_get_indexdef prints it.
  -- The schema prefix on ug_normalize depends on the caller's search_path,
  -- so both spellings pass.
  if v_def is null
     or not v_valid
     or not v_ready
     or v_def !~ 'USING gin \(to_tsvector\(''simple''::regconfig, (public\.)?ug_normalize\(content\)\)\)$'
  then
    drop index if exists public.book_pages_fts_idx;
    create index book_pages_fts_idx on public.book_pages
      using gin (to_tsvector('simple', public.ug_normalize(content)));
  end if;
end
$$;

-- Fresh statistics for the expression, so the custom plans below estimate a
-- word's rows from the index rather than from a guess.
analyze public.book_pages;

-- ── 2. search_books — planned with the real word, every time ────────────────
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
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $fn$
-- The output columns (book_id, title, page_no, rank, capped …) and the
-- parameter category_id are variables in PL/pgSQL, and the queries below read
-- columns of the same names. Every column reference is table-qualified; this
-- directive makes anything left over resolve to the column instead of failing
-- as ambiguous — an error that would only show at call time.
#variable_conflict use_column
declare
  v_query  tsquery  := public.ug_tsquery(q);
  v_needle text     := public.ug_normalize(q);
  v_limit  int      := greatest(coalesce(lim, 20), 0);
  v_offset int      := greatest(coalesce(off, 0), 0);
  v_root   bigint   := search_books.category_id;
  v_ids    bigint[];
begin
  if v_root is null then
    -- ── The whole library: no category predicate at all ───────────────────
    return query
    with title_hits as (
      select
        b.id as book_id,
        b.title,
        b.author,
        b.cover_path,
        0 as page_no,
        b.title as ready_snippet,
        null::text as content,
        (32.0 + ts_rank(to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)), v_query))::real as rank
      from public.books b
      where b.status = 'published'
        and to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)) @@ v_query
        and position(v_needle in public.ug_normalize(b.title || ' ' || b.author)) > 0
    ),
    -- 301, not 300: the extra row tells "exactly 300 matches" from "more than
    -- we are willing to rank". The bound is on the INDEX scan, so the literal
    -- check below can never make Postgres read more rows than this.
    raw_candidates as (
      select b.id as book_id, b.title, b.author, b.cover_path, p.page_no, p.content
      from public.book_pages p
      join public.books b on b.id = p.book_id
      where b.status = 'published'
        and to_tsvector('simple', public.ug_normalize(p.content)) @@ v_query
      limit 301
    ),
    -- Normalized ONCE. Both the literal check and the ranking read this
    -- column; inlining it would restore the double cost 0020 removed.
    normalized as materialized (
      select c.*, public.ug_normalize(c.content) as norm
      from raw_candidates c
    ),
    -- The index answers "these lexemes, adjacent". Punctuation between the
    -- words satisfies that and is not the phrase, so a row that cannot be
    -- highlighted is not returned.
    page_hits as (
      select
        n.book_id,
        n.title,
        n.author,
        n.cover_path,
        n.page_no,
        null::text as ready_snippet,
        n.content,
        ts_rank(to_tsvector('simple', n.norm), v_query) as rank
      from normalized n
      where v_needle <> ''
        and position(v_needle in n.norm) > 0
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
      limit v_limit
      offset v_offset
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
    order by t.rank desc, t.book_id, t.page_no;
  else
    -- ── One category, meaning itself and everything beneath it (0023) ─────
    -- The walk runs once, on its own, and collapses to an array; the search
    -- statement then tests membership in a constant. `path` is the cycle
    -- guard: categories.parent_id is a self reference, and a tree that became
    -- a ring would otherwise recurse for ever.
    with recursive scope_tree as (
        select c.id, array[c.id] as path
        from public.categories c
        where c.id = v_root
      union all
        select child.id, parent.path || child.id
        from public.categories child
        join scope_tree parent on child.parent_id = parent.id
        where not child.id = any (parent.path)
    )
    select coalesce(array_agg(scope_tree.id), '{}'::bigint[])
      into v_ids
    from scope_tree;

    return query
    with title_hits as (
      select
        b.id as book_id,
        b.title,
        b.author,
        b.cover_path,
        0 as page_no,
        b.title as ready_snippet,
        null::text as content,
        (32.0 + ts_rank(to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)), v_query))::real as rank
      from public.books b
      where b.status = 'published'
        and b.category_id = any (v_ids)
        and to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)) @@ v_query
        and position(v_needle in public.ug_normalize(b.title || ' ' || b.author)) > 0
    ),
    raw_candidates as (
      select b.id as book_id, b.title, b.author, b.cover_path, p.page_no, p.content
      from public.book_pages p
      join public.books b on b.id = p.book_id
      where b.status = 'published'
        and b.category_id = any (v_ids)
        and to_tsvector('simple', public.ug_normalize(p.content)) @@ v_query
      limit 301
    ),
    normalized as materialized (
      select c.*, public.ug_normalize(c.content) as norm
      from raw_candidates c
    ),
    page_hits as (
      select
        n.book_id,
        n.title,
        n.author,
        n.cover_path,
        n.page_no,
        null::text as ready_snippet,
        n.content,
        ts_rank(to_tsvector('simple', n.norm), v_query) as rank
      from normalized n
      where v_needle <> ''
        and position(v_needle in n.norm) > 0
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
      limit v_limit
      offset v_offset
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
    order by t.rank desc, t.book_id, t.page_no;
  end if;
end
$fn$;

grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;

-- ── 3. book_match_pages — the reader's navigator, the same treatment ────────
-- 0020's body line for line: the index pre-filter, the `lim` cap, one
-- normalization per candidate, the same counting expression, page order —
-- planned with the real word so the index is read on one book as it is on
-- the whole library. book_id is both the parameter and a column here.
create or replace function public.book_match_pages(
  book_id bigint,
  q text,
  lim int default 500
)
returns table (
  page_no int,
  hits int
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $fn$
#variable_conflict use_column
declare
  v_book   bigint  := book_match_pages.book_id;
  v_query  tsquery := public.ug_tsquery(q);
  v_needle text    := public.ug_normalize(q);
  v_limit  int     := greatest(coalesce(lim, 500), 0);
begin
  return query
  with candidates as (
    select p.page_no, p.content
    from public.book_pages p
    join public.books b on b.id = p.book_id
    where p.book_id = v_book
      and b.status = 'published'
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ v_query
    order by p.page_no
    limit v_limit
  ),
  normalized as materialized (
    select c.page_no, public.ug_normalize(c.content) as norm
    from candidates c
  ),
  counted as (
    select
      n.page_no,
      ((length(n.norm) - length(replace(n.norm, v_needle, ''))) / nullif(length(v_needle), 0))::int as hits
    from normalized n
    where v_needle <> ''
  )
  select counted.page_no, counted.hits
  from counted
  where counted.hits > 0
  order by counted.page_no;
end
$fn$;

grant execute on function public.book_match_pages(bigint, text, int) to anon, authenticated;
