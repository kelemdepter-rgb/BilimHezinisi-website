-- ============================================================================
-- Fix ug_normalize() to match the desktop reference exactly.
--
-- 0001 folded alif maqsura (ى → ي) and ta marbuta (ة → ه). The desktop
-- normalizeArabicQuery in database.js deliberately does NEITHER — both lines
-- are commented out there with an explanation (keep index-time and query-time
-- normalization consistent with the Quran seed).
--
-- For Uyghur this matters: ى (U+0649) is the vowel "i" and a distinct letter
-- from ي (U+064A, "y") — «بىلىم» alone contains three of them. Folding them
-- merged two different Uyghur letters and lost search precision.
--
-- The generated columns store their values, so replacing the function alone
-- would leave stale data behind: the dependent columns and expression indexes
-- are dropped and rebuilt. Safe and instant while the library is empty.
-- ============================================================================

drop index if exists public.book_pages_trgm_idx;
drop index if exists public.books_title_fts_idx;
drop index if exists public.books_title_trgm_idx;

alter table public.book_pages drop column if exists content_norm;
alter table public.quran_ayas drop column if exists text_norm;

-- Now matches desktop normalizeArabicQuery():
--   * strips Arabic diacritics, marks and tatweel
--   * unifies alif variants (ٱ آ أ إ → ا)
--   * collapses whitespace, trims, lowercases Latin
-- Uyghur-specific letters (ئ ې ە ۆ ۇ ۈ ۋ ڭ گ پ چ ك ھ ى) are left untouched.
create or replace function public.ug_normalize(input text)
returns text
language sql
immutable
parallel safe
as $fn$
  select lower(trim(regexp_replace(
    translate(
      regexp_replace(coalesce(input, ''), '[ً-ٰۖ-ۭ࣓-ࣿـ]', '', 'g'),
      'ٱآأإ',
      'اااا'
    ),
    '\s+', ' ', 'g'
  )))
$fn$;

alter table public.book_pages
  add column content_norm tsvector generated always as (
    to_tsvector('simple', public.ug_normalize(content))
  ) stored;

alter table public.quran_ayas
  add column text_norm tsvector generated always as (
    to_tsvector('simple', public.ug_normalize(text_ar_simple || ' ' || text_ug))
  ) stored;

create index book_pages_fts_idx on public.book_pages using gin (content_norm);
create index book_pages_trgm_idx on public.book_pages
  using gin ((public.ug_normalize(content)) extensions.gin_trgm_ops);

create index books_title_fts_idx on public.books
  using gin ((to_tsvector('simple', public.ug_normalize(title || ' ' || author))));
create index books_title_trgm_idx on public.books
  using gin ((public.ug_normalize(title || ' ' || author)) extensions.gin_trgm_ops);

create index quran_ayas_fts_idx on public.quran_ayas using gin (text_norm);
