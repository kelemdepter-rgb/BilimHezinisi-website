-- ============================================================================
-- One matcher, and the database agrees with it.
--
-- Searching «نامازغا چا» highlighted a bare «چالايلى» and a bare «چاقىر» —
-- words that merely START with «چا» and are nowhere near «نامازغا». The reader
-- typed one phrase and the page lit up with fragments of it.
--
-- The cause was ts_headline. It does not mark the string that was searched for;
-- it marks the LEXEMES of the tsquery, one word at a time, wherever they occur.
-- Against 'نامازغا' <-> 'چا':* on a real page of book 72 it produced:
--
--   <mark>نامازغا</mark> <mark>چاقىرىدىغان</mark> … داڭ <mark>چالايلى</mark> …
--   بۇرغا <mark>چالايلى</mark> … <mark>نامازغا</mark> <mark>چاقىر</mark>
--
-- Four of those marks are on words the reader never asked for. The desktop app
-- has never had this problem because getBookContentSnippets is a plain indexOf
-- over the book text: the whole string, or nothing.
--
-- So the RPC stops marking anything. It returns a PLAIN excerpt, and the one
-- matcher the site shares (lib/search/occurrences.ts) decides what is a match
-- and draws every <mark> on the page — results list, reader and counter alike.
-- Where SQL still has to agree (which pages match, how many times, where the
-- excerpt is cut) it is held to the same rule, and tests/unit/sql-parity
-- checks the two against each other on real pages.
--
-- What does NOT change: the FTS index stays the cheap pre-filter, the 301-row
-- candidate bound from 0014 stays, and no trigram index comes back. The literal
-- check runs only on candidate rows the index already found.
-- ============================================================================

-- ── 1. The query as a regex over the ORIGINAL text ──────────────────────────
-- ug_normalize() deletes characters (diacritics, tatweel) and folds alif
-- variants, so a position measured on the normalized string points at the wrong
-- character in the real one — and the more vocalised Arabic a page carries, the
-- further it drifts. Rather than measure on the normalized form and try to
-- correct, the phrase is expressed as a pattern that matches the ORIGINAL text
-- directly: diacritics allowed between letters, alif variants as a class,
-- whitespace as a run. Character for character, this is what the client's
-- findOccurrences does.
create or replace function public.ug_phrase_regex(q text)
returns text
language sql
immutable
parallel safe
as $fn$
  with chars as (
    select ch, ord
    from regexp_split_to_table(public.ug_normalize(left(coalesce(q, ''), 200)), '')
      with ordinality as t(ch, ord)
    where ch <> ''
  ),
  built as (
    select string_agg(
             case
               when ch ~ '\s'  then '[[:space:]]+'
               when ch = 'ا'   then '[اٱآأإ]'
               -- Everything else is a literal. Regex metacharacters are escaped
               -- rather than dropped: someone searching for «(1)» means those
               -- brackets, and an unescaped '(' would also turn the pattern
               -- into a capture group, which changes what substring() returns.
               else regexp_replace(ch, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
             end,
             -- Marks sitting between two letters are skipped, never matched.
             '[ً-ٰۖ-ۭ࣓-ࣿـ]*' order by ord
           ) as expr
    from chars
  )
  -- Trailing marks belong to the last letter: a highlight that stops before a
  -- verse's final kasra looks broken, and the client keeps them too.
  select case when expr is null or expr = '' then null else expr || '[ً-ٰۖ-ۭ࣓-ࣿـ]*' end
  from built
$fn$;

grant execute on function public.ug_phrase_regex(text) to anon, authenticated;

-- ── 2. A plain excerpt around the first occurrence ──────────────────────────
-- No <mark>: the client marks it, with the shared matcher, so results and
-- reader can never disagree again. The window is cut with the pattern itself,
-- which keeps it in original-text coordinates without any offset arithmetic.
create or replace function public.ug_snippet(doc text, q text, ctx int default 70)
returns text
language sql
immutable
parallel safe
as $fn$
  with pat as (
    select public.ug_phrase_regex(q) as expr
  ),
  win as (
    select case
             when pat.expr is null then null
             else substring(
               doc from '(?i).{0,' || greatest(coalesce(ctx, 70), 0) || '}'
                        || pat.expr
                        || '.{0,' || greatest(coalesce(ctx, 70), 0) || '}'
             )
           end as text
    from pat
  ),
  placed as (
    select win.text, strpos(doc, win.text) as at
    from win
    where win.text is not null and win.text <> ''
  )
  select coalesce(
    (
      select
        case when placed.at > 1 then '…' else '' end
        || btrim(regexp_replace(placed.text, '\s+', ' ', 'g'))
        || case when placed.at + length(placed.text) - 1 < length(doc) then '…' else '' end
      from placed
    ),
    -- The phrase is not literally present (the index matched it across
    -- punctuation, say). Such a row is filtered out of search_books below; this
    -- fallback exists so the function is total for any other caller.
    btrim(regexp_replace(left(coalesce(doc, ''), greatest(coalesce(ctx, 70), 0) * 2), '\s+', ' ', 'g'))
  )
$fn$;

grant execute on function public.ug_snippet(text, text, int) to anon, authenticated;

-- ── 3. search_books: index first, literal second, no marking ────────────────
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
      -- Same literal rule as the pages: a title result whose phrase cannot be
      -- highlighted is a result the reader cannot see the point of.
      and position(tsq.needle in public.ug_normalize(b.title || ' ' || b.author)) > 0
  ),
  -- 301, not 300: the extra row is how we tell "exactly 300 matches" from
  -- "more than we are willing to rank". The bound is on the INDEX scan, so the
  -- literal check below can never make Postgres read more rows than this.
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
  -- The index answers "these pages contain those lexemes, adjacent". That is
  -- not quite "these pages contain this phrase" — punctuation between the words
  -- satisfies the first and not the second. Checking the literal here is what
  -- makes every returned row a row the client can actually highlight.
  page_candidates as (
    select c.*
    from raw_candidates c
    cross join tsq
    where tsq.needle <> ''
      and position(tsq.needle in public.ug_normalize(c.content)) > 0
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

-- ── 4. book_match_pages: drop the pages that only the index liked ───────────
-- The count was already literal (0017). What is new is that a page whose count
-- comes out zero is no longer returned at all, so the «n/total» counter and the
-- client's own marks are counting the same occurrences.
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
  counted as (
    select
      c.page_no,
      (
        (length(public.ug_normalize(c.content)) -
         length(replace(public.ug_normalize(c.content), tsq.needle, ''))) / nullif(length(tsq.needle), 0)
      )::int as hits
    from candidates c
    cross join tsq
    where tsq.needle <> ''
  )
  select counted.page_no, counted.hits
  from counted
  where counted.hits > 0
  order by counted.page_no
$fn$;

grant execute on function public.book_match_pages(bigint, text, int) to anon, authenticated;
