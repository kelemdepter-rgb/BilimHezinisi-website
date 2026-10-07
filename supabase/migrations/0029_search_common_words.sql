-- ============================================================================
-- The most common words answer as fast as the rare ones (PROMPT-41).
--
-- On 2026-10-05 a whole-library search for «ئاللاھ» on bilimhezinisi.com ran
-- into the anonymous 3 s statement timeout twice in two tries, while «ناماز»
-- answered in 0.59 s and «پەيغەمبەر» in 1.23 s. In a religious library
-- «ئاللاھ» is among the first words a reader types, and each such search spent
-- the full 3 s of shared database CPU.
--
-- ── What was measured (docs/search-common-words.md) ─────────────────────────
-- A local copy holding exactly the live library — the 2026-09-16 backup, 59
-- books / 19,596 pages — on PostgreSQL 17.6 with every migration to 0028 and
-- the live planner settings. A search there takes about half its live time.
--
--   'ئاللاھ':* is on 3,613 pages; the index counts them in 6 ms.
--   search_books('ئاللاھ', null)        57014 timeout (5.2 s left to run)
--
--   Limit (rows=301) (actual time=219..5181)
--     -> Nested Loop
--          -> Seq Scan on books b                          (18 books visited)
--          -> Index Scan using book_pages_pkey on book_pages p
--               Filter: to_tsvector('simple', <ug_normalize>) @@ '''ئاللاھ'':*'
--               Rows Removed by Filter: 436 per book
--
-- The cost is NOT a bitmap over every matching page, as PROMPT-41 guessed. The
-- planner does not read the index at all: it walks the books in key order and
-- runs ug_normalize() and to_tsvector() on every page until 301 match. It
-- believes that is cheap for two reasons: it expects 7,488 matches (there are
-- 3,613, gathered in a few books), and ug_normalize is a LANGUAGE sql function
-- the planner inlines into a handful of builtins it costs at a fraction of a
-- unit — when it really costs ~0.40 ms a page, and the vector ~0.23 ms more.
-- So the walk's cost follows how far into the library the 301st match sits,
-- which is worst for a word that is common but clustered, exactly «ئاللاھ».
-- The reader's navigator did the same inside one book: «ئاللاھ» is on 8 of
-- the 2,966 pages of the largest book, and book_match_pages took 1.85 s to
-- find them (≈3.9 s live — a timeout).
--
-- A phrase has a cost of its own. The index cannot check adjacency, so every
-- page holding all the words is opened and checked: «پەيغەمبەر ئاللاھ» — both
-- words on 2,396 pages, the phrase on 4 — took 1.43 s here (≈3 s live) on any
-- plan.
--
-- ── What this file does ─────────────────────────────────────────────────────
-- 1. Pages are found ONLY through book_pages_fts_idx. A small function,
--    private.matching_pages, asks the index for the pages of the given books
--    that match, with the planner's three ways of walking pages instead —
--    seqscan, indexscan in key order, nested loop one book at a time — turned
--    off for its one statement. What is left is the bitmap of the GIN index,
--    which returns exactly the matching pages at microseconds each and needs
--    no per-page text work for a word: «ئاللاھ»'s first 601 pages in 19 ms,
--    every one of «ب»'s 19,566 pages in 35 ms. Measured with the index forced
--    it was never slower than the walk for any word tried, single letters
--    included.
-- 2. A phrase asks the index for the pages that hold ALL its words (each from
--    its start, joined with & — exact in the index, nothing to recheck) and
--    then opens at most 1,000 of them, in the order the index gave: each page
--    is normalized once, the literal phrase looked for, a vector built only
--    for a page that has it, the word-start and adjacency rule checked on that
--    vector and the page ranked from the same vector. The work stops at the
--    301st match, as before, or after the 1,000th page opened. 1,000 and not
--    600: «ناماز ئوقۇش» — an ordinary phrase, 254 matches in one category —
--    shares more than 600 pages with its own words there.
-- 3. When the 1,000 pages ran out before 301 matches and more pages hold the
--    words, the answer says so — a new `partial` column — and when nothing was
--    found in the part searched, one row with no book carries the flags, so
--    the results page can tell the reader why rather than say "nothing". So a
--    search never ends in a 3 s wait and «بەك ئۇزۇن ۋاقىت ئالدى».
--
-- Considered and not built:
--   - A table of lexeme frequencies (PROMPT-41's option a). The index already
--     says how common a word is, exactly and in milliseconds, and the cost was
--     never in not knowing it; a table would need ts_stat over every page
--     (~12 s of CPU per refresh on this library) and triggers on every
--     publish, edit and removal, for nothing the plan below needs.
--   - Precomputed first pages for common words (option c): not needed once
--     every word answers inside the budget.
--   - Telling the planner what ug_normalize really costs (PL/pgSQL, COST
--     10000). It fixed search_books for «ئاللاھ» (247 ms) but not the
--     navigator, whose ORDER BY page_no LIMIT 500 still made the ordered walk
--     look cheaper («پەيغەمبەر» 979 ms), it would have re-planned every other
--     query that touches ug_normalize, and it did nothing for phrases.
--   - The `rum` extension, which keeps word positions in the index, so a
--     phrase could be checked without opening pages. Supabase offers it (its
--     extension guide, read 2026-10-07: "bigger due to the additional
--     attributes stored in the index", slower to build and insert). Measured
--     on the local copy: 52 MB against book_pages_fts_idx's 31 MB, 19 s to
--     build. Replacing the GIN index would take 21 MB of a 500 MB plan that is
--     permanent, slow every upload's page inserts and add an extension, for
--     one rare shape — a phrase of two very common words — that the bound
--     below already answers honestly and fast. Left for the owner to weigh.
--
-- Local copy, anonymous role, median of five, before → after this file
-- (scripts/search-timing.mjs; the full tables in docs/search-common-words.md):
--
--   «ئاللاھ», whole library        57014 (the walk) on 10-06; 252 ms on 10-07,
--                                  when the same statistics tipped the plan the
--                                  other way → 266 ms whichever way they tip
--   «پەيغەمبەر», whole library     480 → 271 ms
--   «ئاللاھ تائالا»                 423 → 264 ms
--   «پەيغەمبەر ئاللاھ»            1,434 → 322 ms, partial (1 of its 4 pages)
--   navigator, «ئاللاھ», book 1308  1,834 → 20 ms
--   navigator, «پەيغەمبەر»           952 → 234 ms
--
-- That the plan flipped on an unchanged copy is the point: the walk and the
-- index were costed 375 against 298, and live, «ئاللاھ» sat on the losing
-- side. With this file there is no side to sit on.
--
-- ── What did not change ─────────────────────────────────────────────────────
-- What a search matches: one literal phrase, the words adjacent and in order,
-- each matched from its start, the same ug_normalize, no operators. For every
-- query that matches at most 300 pages and whose words share at most 1,000
-- pages, the rows, the ranks, the order and the snippets are exactly what
-- 0028 returned (tests/unit/search-common-words-sql.test.ts holds them to it
-- on a seeded library; scripts/search-parity.mjs on the real one). The title
-- boost, the 301-match cap and its `capped` flag, paging, the snippet and the
-- search slots in front of the work (0028: a slot is taken before anything
-- else) are as they were. ug_normalize, ug_tsquery, ug_snippet and
-- book_pages_fts_idx are untouched, so nothing is rebuilt.
--
-- What does change: a query matching more than 300 pages ranks a different
-- 301 — the first the index gives rather than the first a walk met, which was
-- always plan-dependent (0014) — and a phrase whose words share more than
-- 1,000 pages may now answer `partial` with what it found, where it used to search
-- them all or, live, time out.
--
-- search_books gains the `partial` column, so it is dropped and created; its
-- grants are given again. Safe to run twice.
-- ============================================================================

-- ── 1. The pages that match, from the index and nothing else ────────────────
-- Owned by the migration's role and executable by it alone: search_books and
-- book_match_pages run as their owner (security definer), and nothing else
-- needs it. `private` is not an exposed schema (0028), so the API offers no
-- /rpc for it either way.
create or replace function private.matching_pages(p_query tsquery, p_books bigint[], p_limit int)
returns table (book_id bigint, page_no int)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = force_custom_plan
-- The walks: the whole table, the primary key in order, and one book at a
-- time through a nested loop. With all three off, the one way left to the
-- pages is the bitmap of book_pages_fts_idx, hash-joined to the books asked
-- for — which cannot walk, because a hash join gives the page scan no book to
-- look up. These hold for this function's statement only.
set enable_seqscan = off
set enable_indexscan = off
set enable_nestloop = off
as $fn$
#variable_conflict use_column
begin
  return query
  select p.book_id, p.page_no
  from public.book_pages p
  join unnest(p_books) as scope(id) on scope.id = p.book_id
  where to_tsvector('simple', public.ug_normalize(p.content)) @@ p_query
  limit p_limit;
end
$fn$;

revoke all on function private.matching_pages(tsquery, bigint[], int) from public;

-- ── 2. Every word of the query, anywhere on the page ────────────────────────
-- ug_tsquery (0017) word for word, with & where it has <->: the same words,
-- each from its start, without the adjacency the index cannot check. Every
-- page that has the phrase has all its words, so this finds a superset of the
-- phrase's pages, and the index answers it exactly.
create or replace function private.ug_tsquery_all_words(q text)
returns tsquery
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(
    (
      select to_tsquery(
        'simple',
        string_agg(quote_literal(word) || ':*', ' & ' order by ord)
      )
      from unnest(
        (select array_agg(w) from regexp_split_to_table(public.ug_normalize(q), '\s+') as w where w <> '')
      ) with ordinality as t(word, ord)
    ),
    plainto_tsquery('simple', '')
  )
$fn$;

revoke all on function private.ug_tsquery_all_words(text) from public;

-- ── 3. search_books — the index first, a bound on pages opened ──────────────
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
  capped boolean,
  partial boolean
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $fn$
-- Output columns and the parameter category_id share names with columns read
-- below; every column reference is qualified, and this resolves the rest to
-- the column (0025).
#variable_conflict use_column
declare
  -- How many matching pages are ranked (0014), and how many pages a phrase
  -- may open while looking for them. 1,000 pages cost ~0.4 s here (≈0.9 s live)
  -- even when the phrase is on none of them.
  c_rank   constant int := 301;
  c_open   constant int := 1000;
  v_query  tsquery  := public.ug_tsquery(q);
  v_reach  tsquery  := private.ug_tsquery_all_words(q);
  v_needle text     := public.ug_normalize(q);
  v_limit  int      := greatest(coalesce(lim, 20), 0);
  v_offset int      := greatest(coalesce(off, 0), 0);
  v_root   bigint   := search_books.category_id;
  v_ids    bigint[];
  v_books  bigint[];
  v_found_books bigint[];
  v_found_pages int[];
  v_more   boolean;
begin
  if v_root is null then
    -- The whole library: pool 1 (0028). Busy ends the call here (PT429).
    perform private.take_search_slot(1, 2);

    select coalesce(array_agg(b.id), '{}'::bigint[])
      into v_books
    from public.books b
    where b.status = 'published';
  else
    -- One category: pool 2, so a whole-library flood cannot starve it.
    perform private.take_search_slot(2, 3);

    -- The category, meaning itself and everything beneath it (0023). `path`
    -- is the cycle guard: a tree that became a ring would recurse for ever.
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

    select coalesce(array_agg(b.id), '{}'::bigint[])
      into v_books
    from public.books b
    where b.status = 'published'
      and b.category_id = any (v_ids);
  end if;

  -- The pages that hold every word, in the order the index gives them: one
  -- more than may be opened, to know whether any were left unopened.
  select coalesce(array_agg(m.book_id order by m.ord), '{}'::bigint[]),
         coalesce(array_agg(m.page_no order by m.ord), '{}'::int[])
    into v_found_books, v_found_pages
  from private.matching_pages(v_reach, v_books, c_open + 1) with ordinality as m(book_id, page_no, ord);
  v_more := cardinality(v_found_books) > c_open;

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
    where b.id = any (v_books)
      and to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)) @@ v_query
      and position(v_needle in public.ug_normalize(b.title || ' ' || b.author)) > 0
  ),
  -- The pages to open, at most c_open, their text read by key. `offset 0` on
  -- this and the next two keeps each a step of its own, so every expression
  -- is computed once per page, and only for the pages the work reaches: rows
  -- flow one at a time up to the limit below, which stops them.
  opened as (
    select c.ord, c.book_id, c.page_no, p.content
    from unnest(v_found_books[1:c_open], v_found_pages[1:c_open]) with ordinality as c(book_id, page_no, ord)
    join public.book_pages p on p.book_id = c.book_id and p.page_no = c.page_no
    order by c.ord
    offset 0
  ),
  -- Normalized once; the literal check, the vector and the rank all read it.
  normalized as (
    select o.ord, o.book_id, o.page_no, o.content, public.ug_normalize(o.content) as norm
    from opened o
    offset 0
  ),
  -- The literal phrase first — a page that cannot be highlighted is not
  -- returned (0019) — and a vector only for the pages that have it.
  vectors as (
    select n.ord, n.book_id, n.page_no, n.content, n.norm, to_tsvector('simple', n.norm) as vec
    from normalized n
    where v_needle <> ''
      and position(v_needle in n.norm) > 0
    offset 0
  ),
  -- Each word from its start, adjacent and in order: the rule the index used
  -- to recheck, asked of the page's own vector, which also ranks it. The
  -- 301st match ends the work, as 0014's candidate cap did.
  page_matches as materialized (
    select v.book_id, v.page_no, v.content, ts_rank(v.vec, v_query) as rank
    from vectors v
    where v.vec @@ v_query
    limit c_rank
  ),
  page_hits as (
    select
      pm.book_id,
      b.title,
      b.author,
      b.cover_path,
      pm.page_no,
      null::text as ready_snippet,
      pm.content,
      pm.rank
    from page_matches pm
    join public.books b on b.id = pm.book_id
  ),
  -- capped: more than 300 pages match — the best of the first 301 are shown.
  -- partial: the pages to open ran out first, and more hold the words.
  overflow as (
    select count(*) > c_rank - 1 as capped,
           (count(*) <= c_rank - 1 and v_more) as partial
    from page_matches
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
    overflow.capped,
    overflow.partial
  from top_hits t
  cross join overflow
  union all
  -- Nothing found in the part searched: one row with no book, so the reader
  -- is told why instead of "nothing found".
  select null::bigint, null::text, null::text, null::text, null::int, null::text, null::real,
         overflow.capped, overflow.partial
  from overflow
  where overflow.partial
    and not exists (select 1 from top_hits)
  order by 7 desc, 1, 5;
end
$fn$;

-- The grants 0025 and 0028 gave (PUBLIC keeps its default too).
grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;

-- ── 4. book_match_pages — the index first ───────────────────────────────────
-- The first `lim` pages of one book that carry the phrase, in page order, with
-- how often each carries it — 0028's answer row for row. The pages come from
-- the index; a single word's are its answer as they stand, and a phrase's
-- pages are each checked on their own vector, in page order, until `lim`
-- carry it.
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
  v_reach  tsquery := private.ug_tsquery_all_words(q);
  v_needle text    := public.ug_normalize(q);
  v_limit  int     := greatest(coalesce(lim, 500), 0);
  -- One word: the index's pages are exactly the word's pages, so no page needs
  -- a vector of its own.
  v_exact  boolean := v_reach = v_query;
  v_pages  int[];
begin
  perform private.take_search_slot(3, 2);

  if not exists (select 1 from public.books b where b.id = v_book and b.status = 'published') then
    return;
  end if;

  select coalesce(array_agg(m.page_no order by m.page_no), '{}'::int[])
    into v_pages
  from private.matching_pages(v_reach, array[v_book], null) as m;

  return query
  with opened as (
    select c.ord, c.page_no, p.content
    from unnest(v_pages) with ordinality as c(page_no, ord)
    join public.book_pages p on p.book_id = v_book and p.page_no = c.page_no
    order by c.ord
    offset 0
  ),
  normalized as (
    select o.page_no, public.ug_normalize(o.content) as norm
    from opened o
    offset 0
  ),
  candidates as (
    select n.page_no, n.norm
    from normalized n
    where v_exact
       or to_tsvector('simple', n.norm) @@ v_query
    limit v_limit
  ),
  counted as (
    select
      cand.page_no,
      ((length(cand.norm) - length(replace(cand.norm, v_needle, ''))) / nullif(length(v_needle), 0))::int as hits
    from candidates cand
    where v_needle <> ''
  )
  select counted.page_no, counted.hits
  from counted
  where counted.hits > 0
  order by counted.page_no;
end
$fn$;

grant execute on function public.book_match_pages(bigint, text, int) to anon, authenticated;

-- PostgREST learns the new column at once (Supabase also reloads on DDL).
notify pgrst, 'reload schema';
