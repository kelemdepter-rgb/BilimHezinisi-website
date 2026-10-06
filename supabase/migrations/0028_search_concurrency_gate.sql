-- ============================================================================
-- A search flood may be told "busy". It may never take the library down.
--
-- On 2026-10-05, ~21:58 and again ~22:10 (Istanbul), bilimhezinisi.com stopped
-- answering for more than five minutes. A load-testing tool (`Grafana
-- k6/2.3.0`, its default user agent) fired about 30 whole-library searches in
-- 0.2 s, then about 40 more, at /search. Each one asked this database for the
-- better part of a second of CPU. Nothing anywhere bounded how many of them
-- could run at once, so they queued for PostgREST's connections, the
-- anonymous reads every other page makes queued behind them, the API gateway
-- gave up after ~90 s (`search_books error after 90050 ms … code=?` — a
-- gateway's non-JSON error, not a Postgres one), and every page of the site —
-- home, Qur'an, authors, /admin — hung until Vercel killed it at 300 s.
--
-- This file is the brake that holds against any number of senders: each
-- expensive anonymous search must hold one of a few SLOTS for as long as it
-- runs. When none is free the call ends at once with
--
--     SQLSTATE PT429, message 'bh:search_busy'
--
-- in milliseconds, instead of joining a queue. PostgREST turns a `PTxyz`
-- SQLSTATE into HTTP status xyz, so a refusal is an HTTP 429 in Supabase's API
-- logs and `{ code: 'PT429', message: 'bh:search_busy' }` to supabase-js; the
-- site shows «ھازىر ئىزدەۋاتقانلار كۆپ» and a retry button (lib/search/busy.ts).
--
-- ── How a slot works ────────────────────────────────────────────────────────
-- A slot is a transaction-scoped advisory lock: pg_try_advisory_xact_lock(
-- 20261005, <pool> * 100 + <n>). The first key is this file's namespace (the
-- date of the incident); the second names the pool and the slot in it.
--   - TRY, never the blocking variant: a full pool answers "busy" at once.
--   - Transaction-scoped: Postgres releases it at commit or rollback, so a
--     search that errors, hits the 3 s statement timeout, is cancelled, or
--     whose backend dies cannot keep a slot. Nothing has to clean up.
--   - No table, no write: counting searches in a table would make every
--     search heavier, which is the opposite of the point.
-- Advisory locks work in a READ ONLY transaction (they are not writes), which
-- is how PostgREST runs these STABLE functions; verified against PostgREST
-- 14.5 — the version the live project reports — before this was written.
--
-- ── The pools, and why these sizes ──────────────────────────────────────────
-- Separate pools, so a flood of one kind cannot starve another: hammering the
-- whole library leaves the one-category search, the reader's navigator and
-- the Qur'an search their own slots.
--
--   pool 1  search_books, whole library ........ 2 slots
--   pool 2  search_books, one category ......... 3 slots
--   pool 3  book_match_pages (navigator) ....... 2 slots
--   pool 4  search_quran ....................... 1 slot
--
-- Measured on the live site 2026-10-05 ~23:05, one request at a time, idle:
-- whole-library «تېخنىكا» 0.17 s, «مېۋە» 0.48, «ناماز» 0.59, «كىتاب» 0.64,
-- «ئىلىم» 0.72, «پەيغەمبەر» 1.23 s, and «ئاللاھ» runs into the 3 s statement
-- timeout every time (PROMPT-41 fixes that separately). So a slot is sized
-- for a 3 s holder, not a 0.5 s one: the slots exist to protect PostgREST's
-- connection pool (10) and the database's two shared cores. Eight slots in
-- all leave PostgREST two connections for reads and refusals even if every
-- slot is held by a 3 s search, and a flood of one kind — what happened —
-- leaves eight.
--
-- Measured against a local copy (PostgreSQL 17.6 + PostgREST 14.5 — the
-- live versions — with 57 books / 17,682 pages, the database container held
-- to 0.66 CPU so its total throughput is about the free tier's), 2026-10-06;
-- docs/search-flood.md has the full numbers and how to repeat them:
--   - 100 users flooding /search through `next start`, an address each, for
--     30 s: 1,470 answered "busy", 72 with results, none with anything else;
--     the home page, a book page and the reader, loaded meanwhile through a
--     second instance, max 196 ms. Without these slots (0025's functions,
--     same timeouts): 21 results, 341 timeouts/errors, reading pages 5–10 s.
--   - 100 callers skipping the site and calling all four functions straight
--     at PostgREST with the public key, 30 s. The pools were sized here.
--     Search holders that ran into the 3 s timeout while sharing the CPU:
--     2/3/2/2 → ~41, 2/2/2/1 → 32, 2/3/2/1 → 22, 2/2/1/1 → 13, 1/2/1/1 → 0;
--     reading pages under 160 ms in every case. 2/3/2/1 delivered the most
--     real results (369) with the fewest callers left waiting on PostgREST's
--     10 s queue (18). Category searches are cheap (a scoped candidate set),
--     so three slots cost little. The navigator keeps two because every
--     reader arriving from a search result calls it — with one, an ordinary
--     busy evening would start telling readers "busy". The Qur'an search
--     ranks every matching aya (no candidate cap; «ئاللاھ» ~0.3 s locally)
--     and is the least used, so one.
-- book_match_pages costs ~0.6 s locally for «پەيغەمبەر» on a 623-page book:
-- both it and search_quran are above the ~100 ms worth gating.
--
-- ── What did not change ─────────────────────────────────────────────────────
-- What any of these functions match, rank or return. search_books and
-- book_match_pages are 0025's bodies line for line with one PERFORM in front
-- of the work; arguments, result columns, `security definer`,
-- `search_path = ''`, `plan_cache_mode = force_custom_plan`, the 301-row
-- candidate bound and the grants are as they were. search_quran keeps 0015's
-- statement and stays SECURITY INVOKER (RLS answers it as the caller, as
-- before); it becomes PL/pgSQL only because a LANGUAGE sql function cannot run
-- a statement before its query. tests/unit/search-gate-sql.test.ts holds all
-- three to the earlier bodies row for row.
--
-- Independent of 0027: nothing here reads or writes anything 0026/0027 made,
-- so it applies the same whether or not those have been run. Safe to run
-- twice.
-- ============================================================================

-- ── 1. The slot taker, out of the API's reach ───────────────────────────────
-- `private` is not one of the exposed schemas (the project exposes public and
-- graphql_public), so PostgREST offers no /rpc for it. search_quran runs as
-- its caller, which is why anon and authenticated may use the schema and run
-- the function: holding a slot inside your own short transaction is all it
-- can do, and every search does exactly that anyway.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.take_search_slot(p_pool int, p_slots int)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_slot int;
begin
  for v_slot in 1 .. greatest(coalesce(p_slots, 0), 0) loop
    if pg_catalog.pg_try_advisory_xact_lock(20261005, p_pool * 100 + v_slot) then
      return;
    end if;
  end loop;
  -- No words in the error: what a reader typed is never logged (PROMPT-29),
  -- and this text reaches Supabase's API log.
  raise exception using
    errcode = 'PT429',
    message = 'bh:search_busy',
    detail = 'every slot in search pool ' || p_pool || ' is in use';
end
$fn$;

revoke all on function private.take_search_slot(int, int) from public;
grant execute on function private.take_search_slot(int, int) to anon, authenticated, service_role;

-- ── 2. search_books — 0025, with a slot taken before any work ───────────────
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
    -- The whole library: pool 1. Busy ends the call here (PT429).
    perform private.take_search_slot(1, 2);

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
    -- One category: pool 2, so a whole-library flood cannot starve it.
    perform private.take_search_slot(2, 3);

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

-- The grant 0025 gave, re-issued as it was (PUBLIC keeps its default too).
grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;

-- ── 3. book_match_pages — 0025, with a slot taken first (pool 3) ────────────
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
  perform private.take_search_slot(3, 2);

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

-- ── 4. search_quran — 0015's statement, with a slot taken first (pool 4) ────
-- Still SECURITY INVOKER with the caller's search_path, exactly as 0015 left
-- it: every reference below is schema-qualified or a built-in, as it was.
create or replace function public.search_quran(
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
  rank real
)
language plpgsql
stable
set plan_cache_mode = force_custom_plan
as $fn$
#variable_conflict use_column
begin
  perform private.take_search_slot(4, 1);

  return query
  with tsq as (
    select public.ug_tsquery(q) as query
  )
  select
    a.sura,
    a.aya,
    s.name_ar as sura_name_ar,
    s.name_ug as sura_name_ug,
    a.text_ar,
    a.text_ug,
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
  offset greatest(coalesce(off, 0), 0);
end
$fn$;

grant execute on function public.search_quran(text, int, int) to anon, authenticated;
