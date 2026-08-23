-- ============================================================================
-- «بۇ كىتابنى قوشۇپ بېرەلەمسىلەر؟» — an inbox, not a forum.
--
-- A reader can ask for a book without an account. Nothing they write is ever
-- shown to anybody but the admin, which is what keeps this from becoming a
-- moderation problem: there is no public surface to spam.
--
-- Three things have to be true of this table and none of them can live only in
-- the form, because the anon key is public and anyone can POST straight to
-- PostgREST:
--
--   1. only an admin can READ it. anon and authenticated may insert, full stop.
--   2. every column has a length the database enforces.
--   3. it cannot grow into the 500 MB budget. A hard daily cap and a hard total
--      cap are enforced by a trigger, so bypassing the form gains nothing.
--
-- At the caps below the table can never exceed roughly 5 MB: 5,000 rows of at
-- most ~1 KB. The admin empties it by deleting what they have handled.
-- ============================================================================

create table if not exists public.book_requests (
  id bigint generated always as identity primary key,
  -- Lengths are the database's business, not the form's: a bot never sees the
  -- form. These are generous for a real request and useless for a payload.
  title text not null check (char_length(title) between 1 and 200),
  author text not null default '' check (char_length(author) <= 120),
  note text not null default '' check (char_length(note) <= 500),
  -- Optional, and only ever read by the admin, so the reader can be told the
  -- book arrived. Never displayed anywhere.
  contact text not null default '' check (char_length(contact) <= 160),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

-- The inbox is read newest first, and the daily cap counts a time range.
create index if not exists book_requests_created_idx
  on public.book_requests (created_at desc);
-- Unhandled first is the working order, and the dashboard counts them.
create index if not exists book_requests_unhandled_idx
  on public.book_requests (created_at desc)
  where handled = false;

-- ── The caps, enforced in the database ──────────────────────────────────────
-- security definer because the row being counted is one anon cannot select:
-- the read policy below allows the admin and nobody else. Counting is not
-- disclosure — the number never leaves this function.
create or replace function public.book_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  today_count bigint;
  total_count bigint;
begin
  select count(*) into today_count
    from public.book_requests
   where created_at >= date_trunc('day', now());
  if today_count >= 100 then
    -- The message is matched by the route, which turns it into an Uyghur
    -- sentence. It must not change without changing that route.
    raise exception 'book_requests_daily_cap' using errcode = 'check_violation';
  end if;

  select count(*) into total_count from public.book_requests;
  if total_count >= 5000 then
    raise exception 'book_requests_total_cap' using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists book_requests_cap on public.book_requests;
create trigger book_requests_cap
  before insert on public.book_requests
  for each row execute function public.book_requests_guard();

-- ── Row level security ──────────────────────────────────────────────────────
alter table public.book_requests enable row level security;

-- Anyone may ask for a book. Asking does not require an account, because
-- reading this library does not require an account either.
create policy "book_requests_insert_anyone" on public.book_requests
  for insert with check (true);

-- And nobody may read one back except an admin. Not the person who wrote it,
-- not a signed-in reader, not the anon role: there is no public view of this
-- table at all.
create policy "book_requests_select_admin" on public.book_requests
  for select using (public.is_admin());
create policy "book_requests_update_admin" on public.book_requests
  for update using (public.is_admin()) with check (public.is_admin());
create policy "book_requests_delete_admin" on public.book_requests
  for delete using (public.is_admin());
