-- ============================================================================
-- Bilim Hezinisi web edition — Phase 1 foundation schema
--
-- Contents:
--   1. Extensions
--   2. ug_normalize() — Uyghur/Arabic search normalization (ported from the
--      desktop app's normalizeArabicQuery in database.js)
--   3. Tables (profiles, categories, books, book_pages, quran, per-user
--      tables, note_documents, ai_usage, settings)
--   4. Role helper functions + triggers (new-user profile, admin bootstrap,
--      role protection, updated_at)
--   5. Full-text search indexes + search_books / search_quran RPCs
--   6. Row Level Security for EVERY table
--   7. Storage buckets (book-files, covers) + policies
--   8. Seed settings
-- ============================================================================

-- ── 1. Extensions ───────────────────────────────────────────────────────────

create extension if not exists pg_trgm with schema extensions;

-- ── 2. Normalization function ───────────────────────────────────────────────
-- Ported from desktop normalizeArabicQuery():
--   * strips Arabic diacritics/marks/tatweel  [ً-ٰۖ-ۭ࣓-ࣿـ]
--   * unifies alif variants (hamza forms)      ٱ آ أ إ → ا
--   * unifies alif maqsura → ya                ى → ي
--   * unifies ta marbuta → ha                  ة → ه
--   * collapses whitespace, trims, lowercases Latin
-- Applied at BOTH index time (generated columns) and query time (RPCs), so
-- normalization always stays consistent. Uyghur-specific letters (ئ ې ە ۆ ۇ
-- ۈ ۋ ڭ گ پ چ ك ھ) are intentionally untouched.

create or replace function public.ug_normalize(input text)
returns text
language sql
immutable
parallel safe
as $fn$
  select lower(trim(regexp_replace(
    translate(
      regexp_replace(coalesce(input, ''), '[ً-ٰۖ-ۭ࣓-ࣿـ]', '', 'g'),
      'ٱآأإىة',
      'اااايه'
    ),
    '\s+', ' ', 'g'
  )))
$fn$;

-- ── 3. Tables ───────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'reader' check (role in ('admin', 'uploader', 'reader')),
  display_name text,
  created_at timestamptz not null default now()
);

create table public.categories (
  id bigint generated always as identity primary key,
  parent_id bigint references public.categories (id) on delete cascade,
  name text not null unique,
  icon text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index categories_parent_idx on public.categories (parent_id);

create table public.books (
  id bigint generated always as identity primary key,
  title text not null,
  author text not null default '',
  category_id bigint references public.categories (id) on delete set null,
  format text not null default 'TXT',
  date text not null default '',
  description text not null default '',
  language text not null default 'ug',
  cover_path text,
  original_file_path text,
  file_hash text not null default '',
  page_count int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index books_category_idx on public.books (category_id);
create index books_status_idx on public.books (status);
-- Duplicate detection by content hash (mirrors desktop behaviour).
create unique index books_file_hash_idx on public.books (file_hash) where file_hash <> '';

-- Desktop stores one big text per book; the web chunks it into pages
-- (~2,000–3,000 chars) for lazy loading and search snippets.
create table public.book_pages (
  book_id bigint not null references public.books (id) on delete cascade,
  page_no int not null,
  content text not null default '',
  content_norm tsvector generated always as (
    to_tsvector('simple', public.ug_normalize(content))
  ) stored,
  primary key (book_id, page_no)
);

create table public.quran_suras (
  number int primary key,
  name_ar text not null,
  name_ug text not null,
  name_translit text not null default '',
  revelation text not null default 'meccan',
  aya_count int not null
);

create table public.quran_ayas (
  id bigint generated always as identity primary key,
  sura int not null references public.quran_suras (number),
  aya int not null,
  text_ar text not null,
  text_ar_simple text not null,
  text_ug text not null default '',
  text_norm tsvector generated always as (
    to_tsvector('simple', public.ug_normalize(text_ar_simple || ' ' || text_ug))
  ) stored,
  unique (sura, aya)
);

create index quran_ayas_sura_idx on public.quran_ayas (sura);

create table public.bookmarks (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id bigint not null references public.books (id) on delete cascade,
  name text not null default '',
  position double precision not null default 0,
  page_no int not null default 1,
  created_at timestamptz not null default now()
);

create index bookmarks_user_book_idx on public.bookmarks (user_id, book_id);

create table public.book_notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id bigint not null references public.books (id) on delete cascade,
  text text not null,
  position double precision not null default 0,
  page_no int not null default 1,
  created_at timestamptz not null default now()
);

create index book_notes_user_book_idx on public.book_notes (user_id, book_id);

create table public.reading_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id bigint not null references public.books (id) on delete cascade,
  position double precision not null default 0,
  page_no int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table public.recent_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id bigint not null references public.books (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index recent_reads_user_time_idx on public.recent_reads (user_id, read_at desc);

-- Notebook (rich-text documents, ported from desktop notes.js in Phase 5).
create table public.note_documents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'يېڭى خاتىرە',
  content_html text not null default '',
  content_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index note_documents_user_updated_idx on public.note_documents (user_id, updated_at desc);

-- Per-user daily AI quota accounting (Phase 7; written by server only).
create table public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  model text not null,
  requests int not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  primary key (user_id, day, model)
);

-- Admin-editable site settings. is_public marks rows anonymous visitors may read.
create table public.settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ── 4. Role helpers + triggers ──────────────────────────────────────────────
-- SECURITY DEFINER so policies on profiles can call them without recursion.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
$fn$;

create or replace function public.is_uploader_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'uploader')
  )
$fn$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end
$fn$;

create trigger books_set_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

create trigger note_documents_set_updated_at
  before update on public.note_documents
  for each row execute function public.set_updated_at();

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- Create a profile for every new auth user; auto-promote to admin when the
-- email matches the admin_email stored in settings (the app also promotes
-- via env ADMIN_EMAIL on first sign-in and mirrors it into settings).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  admin_email text;
begin
  select nullif(lower(s.value #>> '{}'), '')
    into admin_email
    from public.settings s
   where s.key = 'admin_email';

  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    case
      when admin_email is not null and lower(new.email) = admin_email then 'admin'
      else 'reader'
    end,
    nullif(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;

  return new;
end
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles. auth.uid() IS NULL covers the service-role
-- key and the SQL editor, which must stay able to manage roles.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'only an admin may change roles';
  end if;
  return new;
end
$fn$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ── 5. Search indexes + RPCs ────────────────────────────────────────────────

create index book_pages_fts_idx on public.book_pages using gin (content_norm);
create index book_pages_trgm_idx on public.book_pages
  using gin ((public.ug_normalize(content)) extensions.gin_trgm_ops);

create index books_title_fts_idx on public.books
  using gin ((to_tsvector('simple', public.ug_normalize(title || ' ' || author))));
create index books_title_trgm_idx on public.books
  using gin ((public.ug_normalize(title || ' ' || author)) extensions.gin_trgm_ops);

create index quran_ayas_fts_idx on public.quran_ayas using gin (text_norm);

-- Ranked full-text search over published books: title/author hits first
-- (rank-boosted), then page content hits with highlighted snippets.
-- websearch_to_tsquery supports "quoted phrases", OR and -exclusion, matching
-- the desktop search operators. Runs as INVOKER, so RLS still applies.
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
  rank real
)
language sql
stable
as $fn$
  with tsq as (
    select websearch_to_tsquery('simple', public.ug_normalize(q)) as query
  ),
  title_hits as (
    select
      b.id as book_id,
      b.title,
      b.author,
      b.cover_path,
      0 as page_no,
      b.title as snippet,
      (32.0 + ts_rank(to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)), tsq.query))::real as rank
    from public.books b
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and to_tsvector('simple', public.ug_normalize(b.title || ' ' || b.author)) @@ tsq.query
  ),
  page_hits as (
    select
      b.id as book_id,
      b.title,
      b.author,
      b.cover_path,
      p.page_no,
      ts_headline(
        'simple',
        p.content,
        tsq.query,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter= … '
      ) as snippet,
      ts_rank(p.content_norm, tsq.query) as rank
    from public.book_pages p
    join public.books b on b.id = p.book_id
    cross join tsq
    where b.status = 'published'
      and (search_books.category_id is null or b.category_id = search_books.category_id)
      and p.content_norm @@ tsq.query
  )
  select *
  from (
    select * from title_hits
    union all
    select * from page_hits
  ) hits
  order by hits.rank desc, hits.book_id, hits.page_no
  limit greatest(coalesce(lim, 20), 0)
  offset greatest(coalesce(off, 0), 0)
$fn$;

-- Quran search over the normalized Arabic (text_ar_simple) + Uyghur columns.
create or replace function public.search_quran(
  q text,
  lim int default 50,
  off int default 0
)
returns table (
  sura int,
  aya int,
  text_ar text,
  text_ug text,
  sura_name_ug text,
  rank real
)
language sql
stable
as $fn$
  with tsq as (
    select websearch_to_tsquery('simple', public.ug_normalize(q)) as query
  )
  select
    a.sura,
    a.aya,
    a.text_ar,
    a.text_ug,
    s.name_ug as sura_name_ug,
    ts_rank(a.text_norm, tsq.query) as rank
  from public.quran_ayas a
  join public.quran_suras s on s.number = a.sura
  cross join tsq
  where a.text_norm @@ tsq.query
  order by rank desc, a.sura, a.aya
  limit greatest(coalesce(lim, 50), 0)
  offset greatest(coalesce(off, 0), 0)
$fn$;

grant execute on function public.ug_normalize(text) to anon, authenticated;
grant execute on function public.search_books(text, bigint, int, int) to anon, authenticated;
grant execute on function public.search_quran(text, int, int) to anon, authenticated;

-- ── 6. Row Level Security ───────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.books enable row level security;
alter table public.book_pages enable row level security;
alter table public.quran_suras enable row level security;
alter table public.quran_ayas enable row level security;
alter table public.bookmarks enable row level security;
alter table public.book_notes enable row level security;
alter table public.reading_progress enable row level security;
alter table public.recent_reads enable row level security;
alter table public.note_documents enable row level security;
alter table public.ai_usage enable row level security;
alter table public.settings enable row level security;

-- profiles: read own (admin reads all); update own (role change blocked by
-- trigger for non-admins); inserts happen only via the auth trigger.
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = (select auth.uid()) or public.is_admin());
create policy "profiles_update_own" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- categories: public read; admin/uploader write.
create policy "categories_select_all" on public.categories
  for select using (true);
create policy "categories_insert_staff" on public.categories
  for insert with check (public.is_uploader_or_admin());
create policy "categories_update_staff" on public.categories
  for update using (public.is_uploader_or_admin()) with check (public.is_uploader_or_admin());
create policy "categories_delete_staff" on public.categories
  for delete using (public.is_uploader_or_admin());

-- books: anonymous readers see published only; staff see and manage all.
create policy "books_select_published_or_staff" on public.books
  for select using (status = 'published' or public.is_uploader_or_admin());
create policy "books_insert_staff" on public.books
  for insert with check (public.is_uploader_or_admin());
create policy "books_update_staff" on public.books
  for update using (public.is_uploader_or_admin()) with check (public.is_uploader_or_admin());
create policy "books_delete_staff" on public.books
  for delete using (public.is_uploader_or_admin());

-- book_pages: readable when the parent book is readable; staff write.
create policy "book_pages_select_published_or_staff" on public.book_pages
  for select using (
    exists (
      select 1 from public.books b
      where b.id = book_id
        and (b.status = 'published' or public.is_uploader_or_admin())
    )
  );
create policy "book_pages_insert_staff" on public.book_pages
  for insert with check (public.is_uploader_or_admin());
create policy "book_pages_update_staff" on public.book_pages
  for update using (public.is_uploader_or_admin()) with check (public.is_uploader_or_admin());
create policy "book_pages_delete_staff" on public.book_pages
  for delete using (public.is_uploader_or_admin());

-- quran: public read; admin manages (seeding runs with the service role).
create policy "quran_suras_select_all" on public.quran_suras
  for select using (true);
create policy "quran_suras_write_admin" on public.quran_suras
  for all using (public.is_admin()) with check (public.is_admin());
create policy "quran_ayas_select_all" on public.quran_ayas
  for select using (true);
create policy "quran_ayas_write_admin" on public.quran_ayas
  for all using (public.is_admin()) with check (public.is_admin());

-- per-user tables: owner-only, all operations.
create policy "bookmarks_owner" on public.bookmarks
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "book_notes_owner" on public.book_notes
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reading_progress_owner" on public.reading_progress
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "recent_reads_owner" on public.recent_reads
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "note_documents_owner" on public.note_documents
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ai_usage: users see their own usage, admin sees all; only the server
-- (service role) writes.
create policy "ai_usage_select_own_or_admin" on public.ai_usage
  for select using (user_id = (select auth.uid()) or public.is_admin());

-- settings: public rows for everyone, the rest admin-only; admin writes.
create policy "settings_select_public_or_admin" on public.settings
  for select using (is_public or public.is_admin());
create policy "settings_insert_admin" on public.settings
  for insert with check (public.is_admin());
create policy "settings_update_admin" on public.settings
  for update using (public.is_admin()) with check (public.is_admin());
create policy "settings_delete_admin" on public.settings
  for delete using (public.is_admin());

-- ── 7. Storage buckets + policies ───────────────────────────────────────────
-- Wrapped so the migration still succeeds on projects where SQL may not
-- manage storage; in that case create the buckets/policies in the dashboard.

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('covers', 'covers', true), ('book-files', 'book-files', true)
  on conflict (id) do nothing;
exception when insufficient_privilege then
  raise notice 'No privilege to create buckets — create public buckets "covers" and "book-files" in the dashboard.';
end $$;

do $$
begin
  create policy "storage_public_read_library" on storage.objects
    for select using (bucket_id in ('covers', 'book-files'));
  create policy "storage_staff_insert_library" on storage.objects
    for insert with check (bucket_id in ('covers', 'book-files') and public.is_uploader_or_admin());
  create policy "storage_staff_update_library" on storage.objects
    for update using (bucket_id in ('covers', 'book-files') and public.is_uploader_or_admin())
    with check (bucket_id in ('covers', 'book-files') and public.is_uploader_or_admin());
  create policy "storage_staff_delete_library" on storage.objects
    for delete using (bucket_id in ('covers', 'book-files') and public.is_uploader_or_admin());
exception when insufficient_privilege then
  raise notice 'No privilege to create storage policies — add public-read / staff-write policies for "covers" and "book-files" in the dashboard.';
end $$;

-- ── 8. Seed settings ────────────────────────────────────────────────────────

insert into public.settings (key, value, is_public)
values
  ('site_name', to_jsonb('بىلىم خەزىنىسى'::text), true),
  ('admin_email', to_jsonb(''::text), false)
on conflict (key) do nothing;
