-- ============================================================================
-- Match the start of a word, the way the desktop does.
--
-- Typing «نامازغا چا» finds fifteen results in the desktop app and none on the
-- web. The desktop sends FTS5 a prefix query — its own comment says
-- "User types: مىسۋاك → FTS5 sends: مىسۋاك*" — so «چا» matches «چاقىرىش».
-- websearch_to_tsquery only ever matches whole lexemes, so the web found
-- nothing at all.
--
-- For Uyghur this is not a nicety. The language glues suffixes onto stems, so
-- the form a reader half-remembers is usually a prefix of the form on the
-- page: ناماز / نامازغا / نامازنى / نامازلارنى. Whole-lexeme matching makes the
-- reader guess the exact ending.
--
-- Operators still take the old path. A quoted "phrase", an OR, or a -excluded
-- word means the reader is being precise, and websearch_to_tsquery already
-- expresses that exactly; turning those into prefixes would widen a query
-- someone deliberately narrowed.
-- ============================================================================

create or replace function public.ug_tsquery(q text)
returns tsquery
language plpgsql
immutable
as $fn$
declare
  normalized text := public.ug_normalize(q);
  parts text;
begin
  -- Quoted phrase, OR, or -exclusion: the reader means it literally.
  if q like '%"%' or q ~ '\mOR\M' or q ~ '(^|\s)-\S' then
    return websearch_to_tsquery('simple', normalized);
  end if;

  -- Otherwise every word becomes a prefix: 'نامازغا':* & 'چا':*
  select string_agg(quote_literal(word) || ':*', ' & ')
    into parts
  from unnest(regexp_split_to_array(normalized, '\s+')) as word
  where btrim(word) <> '';

  if parts is null then
    return websearch_to_tsquery('simple', normalized);
  end if;

  return to_tsquery('simple', parts);
exception
  -- Punctuation-only input can leave to_tsquery with nothing to parse. Never
  -- let a search box raise; fall back to the strict reading.
  when others then
    return websearch_to_tsquery('simple', normalized);
end;
$fn$;

grant execute on function public.ug_tsquery(text) to anon, authenticated;

-- ── Book search ─────────────────────────────────────────────────────────────
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
    select public.ug_tsquery(q) as query
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
  page_candidates as (
    select b.id as book_id, b.title, b.author, b.cover_path, p.page_no, p.content
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(p.content)) @@ tsq.query
    limit 301
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
    select count(*) > 300 as capped from page_candidates
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
    coalesce(
      t.ready_snippet,
      ts_headline(
        'simple',
        t.content,
        tsq.query,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter= … '
      )
    ) as snippet,
    t.rank,
    overflow.capped
  from top_hits t
  cross join tsq
  cross join overflow
  order by t.rank desc, t.book_id, t.page_no
$fn$;

grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;

-- ── Quran search, same rule ─────────────────────────────────────────────────
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
language sql
stable
as $fn$
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
  offset greatest(coalesce(off, 0), 0)
$fn$;

grant execute on function public.search_quran(text, int, int) to anon, authenticated;
