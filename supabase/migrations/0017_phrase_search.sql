-- ============================================================================
-- Several words mean a phrase, not "all of these words somewhere".
--
-- Searching «قىيامەت كۈنى پىلسىرات» returned a hit on page 492 with only
-- «قىيامەت» and «كۈنى» highlighted — «پىلسىرات» was nowhere in the marked text.
-- The phrase occurs on exactly 0 pages of the library. The site was reporting
-- a find it had not made, and the reader is left assuming they mistyped.
--
-- The cause: ug_tsquery ANDed the words, so any page carrying all three
-- anywhere matched, and ts_headline then highlighted whichever of them it
-- liked. The desktop app never had this problem because it searches the book
-- text with a plain indexOf — several words are a phrase there by nature.
--
-- So the words are joined with the phrase operator instead of AND. The last
-- word keeps its prefix, which is what makes «نامازغا چا» find
-- «نامازغا چاقىرىش» — the same thing indexOf does for free, and the reason
-- prefix matching went in to begin with (0015).
--
--   before:  'قىيامەت':* & 'كۈنى':* & 'پىلسىرات':*     → matches, highlights 2 of 3
--   after:   'قىيامەت' <-> 'كۈنى' <-> 'پىلسىرات':*     → no match, and says so
--
-- ts_headline receives the same phrase query, so a snippet now marks the whole
-- phrase rather than scattered words. Adjacency is checked by the index, so
-- there is no per-row text scan and no trigram index: the free tier is
-- untouched. A single word behaves exactly as before.
-- ============================================================================

create or replace function public.ug_tsquery(q text)
returns tsquery
language sql
immutable
as $fn$
  select coalesce(
    (
      -- Adjacent, in the order typed; the final word matches from its start.
      -- ordinality keeps the reader's own word order, which <-> depends on and
      -- a tsvector's alphabetical lexeme order would destroy.
      select to_tsquery(
        'simple',
        string_agg(quote_literal(word) || ':*', ' <-> ' order by ord)
      )
      from unnest(
        (select array_agg(w) from regexp_split_to_table(public.ug_normalize(q), '\s+') as w where w <> '')
      ) with ordinality as t(word, ord)
    ),
    plainto_tsquery('simple', '')
  )
$fn$;

grant execute on function public.ug_tsquery(text) to anon, authenticated;

-- ── Every page of one book that carries the phrase ──────────────────────────
-- Feeds the reader's «ئالدىنقى» / «كېيىنكى» navigator. Returns the count of
-- occurrences per page rather than the page text, so a 600-page book costs one
-- small response instead of megabytes — the client already knows how to find
-- the exact positions inside a page it has loaded.
--
-- SECURITY DEFINER for the same reason search_books is (0011): under RLS the
-- planner cannot push the indexable @@ below the security barrier. The
-- published-only filter here is the boundary, and it is stricter than the
-- policy it replaces.
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
  )
  select
    c.page_no,
    -- How many times the phrase occurs, counted the way the desktop counts:
    -- on the normalized text, so diacritics never split an occurrence.
    (
      (length(public.ug_normalize(c.content)) -
       length(replace(public.ug_normalize(c.content), tsq.needle, ''))) / nullif(length(tsq.needle), 0)
    )::int as hits
  from candidates c
  cross join tsq
  where tsq.needle <> ''
  order by c.page_no
$fn$;

grant execute on function public.book_match_pages(bigint, text, int) to anon, authenticated;
