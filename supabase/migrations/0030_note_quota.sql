-- ============================================================================
-- One account may not fill the database: a quota on the notebook (PROMPT-44).
--
-- Supabase's free plan puts the WHOLE project into read-only mode once the
-- database passes 500 MB. On 2026-10-05 it held 91 MB. A note may carry 60,000
-- characters of text plus up to ~900 KB of HTML (the editor's MAX_SAVE_BYTES;
-- Next refuses a Server Action body over 1 MB), and nothing limited how many
-- notes one account could make — so one signed-in account, scripted, could
-- have filled the remaining 400 MB with a few thousand requests and stopped
-- every reader's bookmarks, notes and sign-ups along with it. A rate limit in
-- the server's memory cannot prevent that: it counts per instance and forgets
-- on every deploy. The bound has to live here, where every write passes.
--
-- ── The numbers (decided by the owner, 2026-10-07) ───────────────────────────
--   · 200 notes per account;
--   · 5 MB per account — 5,242,880 bytes, counted as the UTF-8 bytes of the
--     title, the HTML and the plain text together (content_bytes, below).
-- At 5 MB an account is about 1 % of the database, and reaching it takes a
-- writer years. lib/notes/limits.ts holds the same two numbers for the page;
-- tests/unit/note-quota-sql.test.ts fails if the two ever differ.
--
-- Every row counts, whatever state it is in. When the notebook gets a trash
-- (soft delete, a later stage), a note in it still counts until it is gone
-- for good: otherwise "move to trash, write another" would be a way round.
--
-- ── Shrinking is always allowed ──────────────────────────────────────────────
-- A writer who is already over a limit — or who reaches it — keeps every note.
-- An update that makes a note no larger than it was always passes, and
-- deleting is never limited, so the way back below the line is always open;
-- only growing, and making new notes, is refused. A refusal is an exception
-- whose message is exactly `note_quota_count` or `note_quota_bytes`, which
-- lib/notes/save-protocol.ts turns into the Uyghur sentence that says what to
-- do. The text the writer typed stays in their browser (the editor's device
-- copy) until a save succeeds.
--
-- ── Who it applies to ────────────────────────────────────────────────────────
-- Every request that carries a signed-in user, the admin's included. A write
-- with no user — auth.uid() is null — is not limited: that is the service-role
-- key, used only by the owner's own maintenance scripts (a restore into a fresh
-- project must be able to put back every note it saved), and the SQL Editor.
-- Neither is reachable by a reader: with the public anon key and no session,
-- RLS ("note_documents_owner", 0001) refuses any write.
--
-- A row whose user_id is not the caller's is not counted either. Postgres
-- checks a policy's WITH CHECK after the BEFORE triggers, so RLS refuses that
-- row anyway — and counting first would have answered «that account is full»
-- to anyone who tried writing into a stranger's notebook.
--
-- ── Parallel requests ────────────────────────────────────────────────────────
-- Two saves of one account could each read the total before the other wrote
-- and both pass. A per-account transaction lock (advisory key 20261007 — 0028
-- uses 20261005 — with the account's hash) makes them take turns; the second
-- reads the first's row once it has committed. Different accounts never wait
-- for each other, except on the rare hash collision, which only costs a turn.
-- ============================================================================

-- ── Each note's size, kept by Postgres ───────────────────────────────────────
-- Stored and generated, like content_length (0018): 4 bytes a row, always
-- right, and the notes list reads the account's usage without downloading a
-- single note. Adding it rewrites the table once — a small one.
alter table public.note_documents
  add column if not exists content_bytes integer
  generated always as (octet_length(title) + octet_length(content_html) + octet_length(content_text)) stored;

-- ── The limits: one place each ───────────────────────────────────────────────
create or replace function public.note_quota_max_notes()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 200
$fn$;

create or replace function public.note_quota_max_bytes()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 5242880
$fn$;

-- ── The guard ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it counts every row of the account with the owner's
-- rights rather than through the caller's RLS, and calls the limit functions,
-- which nobody else may execute. It writes nothing, runs no dynamic SQL and
-- pins search_path to ''.
--
-- A BEFORE trigger cannot read new.content_bytes: Postgres computes stored
-- generated columns after the BEFORE triggers have run. The new size is
-- therefore computed here from the three columns, with the column's own
-- formula; the other rows' sizes are read from the stored column.
create or replace function public.note_quota_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_new_bytes bigint;
  v_old_bytes bigint;
  v_other_bytes bigint;
begin
  -- No user (the service role, the SQL Editor), or a row RLS is about to
  -- refuse: see "Who it applies to" above.
  if v_user is null or new.user_id is distinct from v_user then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(20261007, pg_catalog.hashtext(new.user_id::text));

  if tg_op = 'INSERT'
     and (select count(*) from public.note_documents d where d.user_id = new.user_id)
         >= public.note_quota_max_notes() then
    raise exception 'note_quota_count';
  end if;

  v_new_bytes := octet_length(new.title)::bigint + octet_length(new.content_html) + octet_length(new.content_text);

  if tg_op = 'UPDATE' then
    v_old_bytes := octet_length(old.title)::bigint + octet_length(old.content_html) + octet_length(old.content_text);
    -- No larger than it was: always allowed, even over the limit.
    if v_new_bytes <= v_old_bytes then
      return new;
    end if;
    select coalesce(sum(d.content_bytes), 0) into v_other_bytes
      from public.note_documents d
     where d.user_id = new.user_id
       and d.id <> old.id;
  else
    select coalesce(sum(d.content_bytes), 0) into v_other_bytes
      from public.note_documents d
     where d.user_id = new.user_id;
  end if;

  if v_other_bytes + v_new_bytes > public.note_quota_max_bytes() then
    raise exception 'note_quota_bytes';
  end if;

  return new;
end
$fn$;

drop trigger if exists note_documents_quota on public.note_documents;
create trigger note_documents_quota
  before insert or update of title, content_html, content_text on public.note_documents
  for each row execute function public.note_quota_guard();

-- ── Who may call what ────────────────────────────────────────────────────────
-- Nobody but their owner. A trigger function runs as part of the write
-- whatever its grants say, and a definer function calls the limits with its
-- owner's rights — so revoking EXECUTE takes nothing from the guard, and only
-- the owner may replace or alter any of the three (tested in PGlite).
revoke all on function public.note_quota_max_notes() from public, anon, authenticated;
revoke all on function public.note_quota_max_bytes() from public, anon, authenticated;
revoke all on function public.note_quota_guard() from public, anon, authenticated;

-- PostgREST learns the new column at once (Supabase also reloads on DDL).
notify pgrst, 'reload schema';
