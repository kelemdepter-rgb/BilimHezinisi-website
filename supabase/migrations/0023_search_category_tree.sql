-- ============================================================================
-- A category means the same thing to searching as it does to browsing.
--
-- Browsing already resolves a category through its descendants: listBooks in
-- lib/library.ts calls categoryWithDescendants, so opening «تارىخ» shows the
-- books filed under its children too. search_books did not — 0020 filtered
--
--     b.category_id = search_books.category_id
--
-- which is the exact category and nothing beneath it. The moment the owner
-- creates a subcategory, browsing «تارىخ» shows a book that searching «تارىخ»
-- cannot find. The tree is flat today (17 categories, no nesting), which is
-- the only reason nobody has met this yet; the search box's new scope picker
-- makes the disagreement something a reader would notice, so it is fixed here.
--
-- ── What changed, and what deliberately did not ─────────────────────────────
-- ONLY the two category predicates. The ranking, the title boost, the 301-row
-- candidate cap, the `capped` flag, the snippet and the literal phrase check
-- are byte-for-byte 0020's, and 0020's comments explain why two of them are
-- shaped the way they are: `as materialized` stops ug_normalize running twice
-- per candidate row (~270 ms), and matching the phrase alone before locating
-- it with strpos keeps the snippet regex from backtracking (~55 ms per call).
-- Neither is touched. tests/unit/sql-parity.test.ts applies this file too and
-- still holds the SQL to the client matcher, page by page.
--
-- ── Why a recursive CTE and not a subquery per row ──────────────────────────
-- The walk runs ONCE and collapses to a single row holding a single array,
-- which is cross-joined in beside `tsq` exactly as the query already does for
-- the normalized needle. The predicate is then `b.category_id = any (ids)` —
-- an ordinary array membership test Postgres can still answer through
-- books_category_idx, not a correlated subquery re-run per candidate row.
-- When category_id is null the walk starts from nothing, the array is empty
-- and the OR short-circuits before it is ever consulted, which is the path
-- almost every search on this site takes.
--
-- The `path` column is a cycle guard: categories.parent_id is a self
-- reference, so a tree that somehow became a ring would otherwise recurse for
-- ever. categoryWithDescendants guards the same way in JavaScript.
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
  rank real,
  capped boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with recursive scope_tree as (
      -- Empty when nothing was asked for: `c.id = null` is never true.
      select c.id, array[c.id] as path
      from public.categories c
      where c.id = search_books.category_id
    union all
      select child.id, parent.path || child.id
      from public.categories child
      join scope_tree parent on child.parent_id = parent.id
      where not child.id = any (parent.path)
  ),
  scope as (
    select coalesce(array_agg(scope_tree.id), '{}'::bigint[]) as ids from scope_tree
  ),
  tsq as (
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
    cross join scope
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = any (scope.ids))
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
    cross join scope
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = any (scope.ids))
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ tsq.query
    limit 301
  ),
  -- Normalized ONCE. Both the literal check and the ranking read this column;
  -- inlining it would restore the double cost migration 0020 exists to remove.
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
