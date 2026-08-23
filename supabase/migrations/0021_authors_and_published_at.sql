-- ============================================================================
-- Two ways to find a book that did not exist before: by its author, and by
-- being new.
--
-- BY AUTHOR. `books.author` has been there since 0001 but nothing ever grouped
-- on it, and the real data is not tidy: the same person appears with padding,
-- with different spacing, and with the alif written three ways. Grouping is
-- therefore done on ug_normalize(author) — the same normalisation search uses —
-- while the reader is shown a real spelling from the shelf rather than the
-- normalized form, which is lower-cased and stripped of diacritics and would
-- look wrong on the page.
--
-- BY BEING NEW. The library had no idea when a book became visible. created_at
-- is when the row was inserted, which for the 21 books imported from the
-- desktop app is all the same afternoon, and says nothing about when a reader
-- could first see them. `books.date` is a different thing again: the year the
-- BOOK was published, sometimes centuries ago, and it is free text. So this
-- adds published_at — the moment a book became `published` on this site — and
-- a trigger that keeps it honest without anybody having to remember.
-- ============================================================================

-- ── 1. Sorting Uyghur names into Uyghur order ───────────────────────────────
-- Postgres sorts Arabic script by code point, and the Uyghur alphabet is not
-- in code-point order: ە (U+06D5) is the second letter but sorts after ي
-- (U+064A), the last. An author index in that order is not an index, it is a
-- shuffle. There is no ICU collation for Uyghur to lean on here, so the letters
-- are mapped to a run of ASCII that IS in alphabetical order, and the result is
-- sorted on that.
--
-- Also handled: ئ is a carrier for a word-initial vowel, not a letter of the
-- alphabet, so it is dropped rather than sorted; and the Arabic-only letters
-- that turn up in borrowed names (ث ح ذ ص ض ط ظ ع ه ة) are folded to the
-- Uyghur letter a reader would look them up under.
create or replace function public.ug_sort_key(input text)
returns text
language sql
immutable
parallel safe
as $fn$
  select translate(
    public.ug_normalize(input),
    -- ا ە ب پ ت ج چ خ د ر ز ژ س ش غ ف ق ك گ ڭ ل م ن ھ و ۇ ۆ ۈ ۋ ې ى ي
    'اەبپتجچخدرزژسشغفقكگڭلمنھوۇۆۈۋېىي' || 'ثحذصضطظعهة' || 'ئء',
    -- 32 targets in ascending ASCII order, then the folded Arabic letters.
    -- ئ and ء have no target, so translate() removes them.
    '0123456789ABCDEFGHIJKLMNOPQRSTUV' || 'CNACA4A0NN'
  )
$fn$;

grant execute on function public.ug_sort_key(text) to anon, authenticated;

-- ── 2. A grouping key on the row itself ─────────────────────────────────────
-- Stored and generated rather than computed per query, so /authors/[author]
-- is a plain indexed lookup through PostgREST and needs no function call.
alter table public.books
  add column if not exists author_key text
  generated always as (public.ug_normalize(author)) stored;

create index if not exists books_author_key_idx
  on public.books (author_key)
  where status = 'published';

-- ── 3. When a book became visible ───────────────────────────────────────────
alter table public.books
  add column if not exists published_at timestamptz;

-- Backfill. The truth is not recoverable for books published before this
-- migration, so the closest honest answer is used: the last time the row was
-- touched, never later than now. `least` guards against a clock-skewed
-- updated_at putting a book in the future and pinning it to the top of "new"
-- forever.
update public.books
   set published_at = least(updated_at, now())
 where status = 'published'
   and published_at is null;

-- From here on it looks after itself. Publishing stamps the moment; taking a
-- book back to draft clears it, so a book that is unpublished and published
-- again is genuinely new again rather than carrying an old date nobody
-- remembers setting.
create or replace function public.books_track_published_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  elsif new.status is distinct from 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists books_published_at on public.books;
create trigger books_published_at
  before insert or update of status on public.books
  for each row execute function public.books_track_published_at();

-- Newest first is the only order this column is ever read in.
create index if not exists books_published_at_idx
  on public.books (published_at desc)
  where status = 'published';

-- ── 4. The author index ─────────────────────────────────────────────────────
-- `security definer` for the same reason as search_books in 0019: under RLS the
-- planner cannot use the partial index, and this has to stay cheap as the shelf
-- grows. Nothing is exposed that RLS would have hidden — the filter is a
-- hard-coded `status = 'published'`, and an author's name and book count are
-- already on every book page.
--
-- The spelling shown is the one used on the most books, with the longest
-- winning a tie: given «ئابدۇللا» on four books and «ئابدۇللا » on one, the
-- reader sees the four.
create or replace function public.list_authors(lim int default 24, off int default 0)
returns table (author_key text, author text, book_count bigint, total_authors bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  with per_spelling as (
    select
      b.author_key as key,
      btrim(b.author) as spelling,
      count(*) as n
    from public.books b
    where b.status = 'published'
      and coalesce(b.author_key, '') <> ''
    group by 1, 2
  ),
  grouped as (
    select
      key,
      (array_agg(spelling order by n desc, length(spelling) desc, spelling))[1] as display,
      sum(n) as books,
      min(public.ug_sort_key(spelling)) as sort_key
    from per_spelling
    group by key
  )
  select
    key,
    display,
    books,
    count(*) over () as total
  from grouped
  order by sort_key, key
  limit greatest(1, least(coalesce(lim, 24), 100))
  offset greatest(0, least(coalesce(off, 0), 100000))
$fn$;

grant execute on function public.list_authors(int, int) to anon, authenticated;

-- How many authors there are, and how many books nobody is credited on — the
-- second number is the honest one, and the /authors page says it out loud
-- rather than quietly leaving those books out of the index.
create or replace function public.author_stats()
returns table (authors bigint, unattributed bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    count(distinct b.author_key) filter (where coalesce(b.author_key, '') <> ''),
    count(*) filter (where coalesce(b.author_key, '') = '')
  from public.books b
  where b.status = 'published'
$fn$;

grant execute on function public.author_stats() to anon, authenticated;
