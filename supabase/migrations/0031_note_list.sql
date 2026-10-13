-- ============================================================================
-- The notebook's list: pin, trash, preview and search (PROMPT-47, stage 6).
--
-- /notes listed titles and nothing else. A writer with a hundred notes could
-- not find one by what it said, could not keep the important ones on top, and
-- deleting was permanent behind one tap and a browser dialog. This adds:
--
--   · pinned_at  — set while a note is pinned to the top of the list;
--   · deleted_at — set while a note is in the trash. It stays there for
--     note_trash_days() (30) days, can be put back at any time until then,
--     and is deleted for good by the daily /api/health run
--     (purge_note_trash), by the writer in the trash, or when the writer
--     opens the trash after it expired;
--   · preview    — the first 160 characters of the plain text, whitespace
--     collapsed, so the list shows each note's opening without downloading
--     a single note body (the reason content_length exists, 0018);
--   · search_my_notes — one literal phrase, matched in the title and the text
--     through ug_normalize, like the library's search (no operators);
--   · discard_note_if_empty — «يېڭى خاتىرە» makes a row before anything is
--     typed; a note left untouched is removed when the writer leaves it.
--
-- ── The trash still counts against the quota ─────────────────────────────────
-- note_quota_guard (0030) counts EVERY row of the account, and that is not
-- changed here: a note in the trash keeps counting — notes and bytes — until
-- it is gone for good. Otherwise "move to trash, write another" would be a way
-- round 200 notes and 5 MB. The quota's messages say so (lib/notes/
-- save-protocol.ts), and tests/unit/note-list-sql.test.ts proves it.
--
-- ── Pinning and the trash are not edits ──────────────────────────────────────
-- 0001's trigger moved updated_at on EVERY update. Pinning a note would then
-- have made it «the newest edit», and an editor open in another tab would
-- have taken it for a change made elsewhere — a conflict over nothing (the
-- save only writes over the version it was made on, PROMPT-43). The trigger
-- now fires on the three columns a writer actually writes, exactly the ones
-- saveNoteAction sets on every save. updated_at = created_at therefore still
-- means "never saved since it was made", which discard_note_if_empty relies on.
--
-- ── Immutable, as a generated column must be ────────────────────────────────
-- left(), btrim() and regexp_replace(text, text, text, text) are all IMMUTABLE
-- in Postgres, so preview is a stored generated column like content_length
-- and content_bytes. btrim() is the one addition to the plain "collapse and
-- cut" — without it a note that starts with an empty line would preview with
-- a leading space.
-- ============================================================================

-- ── The columns ──────────────────────────────────────────────────────────────
alter table public.note_documents
  add column if not exists pinned_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.note_documents
  add column if not exists preview text
  generated always as (left(btrim(regexp_replace(content_text, '\s+', ' ', 'g')), 160)) stored;

-- The daily purge looks for expired trash across every account; the trash is
-- a sliver of the table, so the index holds only those rows. A writer's own
-- list and trash are read through note_documents_user_updated_idx (0001).
create index if not exists note_documents_trash_idx
  on public.note_documents (deleted_at)
  where deleted_at is not null;

-- ── updated_at moves on an edit, and only on an edit ─────────────────────────
drop trigger if exists note_documents_set_updated_at on public.note_documents;
create trigger note_documents_set_updated_at
  before update of title, content_html, content_text on public.note_documents
  for each row execute function public.set_updated_at();

-- ── How long the trash keeps a note ──────────────────────────────────────────
-- lib/notes/limits.ts holds the same number for the page («N كۈندىن كېيىن
-- مەڭگۈلۈك ئۆچىدۇ»); the PGlite test fails if the two ever differ.
create or replace function public.note_trash_days()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 30
$fn$;

-- ── Searching one's own notes ────────────────────────────────────────────────
-- SECURITY INVOKER: it runs with the caller's rights, so RLS
-- ("note_documents_owner") applies on top of the explicit filter on
-- auth.uid() — one guard is the database's and one is this function's.
--
-- One literal phrase, as the library search treats whatever is typed: no
-- operators. A note is found when ug_normalize(title || E'\n' || text)
-- contains ug_normalize(query) — so hamza forms, tashkil, tatweel, runs of
-- whitespace and letter case never decide whether a note is found. The
-- trimmed query must be 2–100 characters, and must still say something once
-- normalized (a query of tashkil alone would otherwise match every note);
-- anything else finds nothing. At most 50 rows, pinned first, then the newest
-- edit.
--
-- ── How, and why not plain strpos ────────────────────────────────────────────
-- The obvious way — strpos over ug_normalize of every note — normalizes the
-- writer's whole notebook on every search. Measured on a local copy at the
-- size the task named (200 notes × 60,000 characters): 2.0 s, nine tenths of
-- it ug_normalize's whitespace and alif steps (docs/notes-search.md).
--
-- So the NOTES are left as they are and the QUERY is turned round instead:
-- the normalized phrase becomes a pattern that accepts exactly what
-- ug_normalize would have folded into it —
--   · ا also as ٱ آ أ إ (the alif forms ug_normalize unifies);
--   · any run of tashkil and tatweel between two letters (ug_normalize
--     deletes them);
--   · a space as any run of whitespace, marks among it (ug_normalize
--     collapses it to one space);
--   · upper or lower case (ug_normalize lower-cases; ~* ignores case);
--   · every other character literally — anything that is not a letter or a
--     digit is escaped, so nothing typed is ever read as an operator.
-- Same notes found, measured at 0.07–0.1 s on the same copy. The class of
-- marks below is ug_normalize's own (0002), character for character, and
-- tests/unit/note-list-sql.test.ts compares the two ways on thousands of
-- generated texts, so they cannot drift apart unnoticed.
--
-- What was typed is a parameter and nothing else: it is not stored, and it
-- is never written to a log by this site.
create or replace function public.search_my_notes(p_query text, p_limit integer default 50)
returns table (
  id bigint,
  title text,
  preview text,
  created_at timestamptz,
  updated_at timestamptz,
  pinned_at timestamptz,
  content_length integer,
  content_bytes integer
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with typed as (
    select public.ug_normalize(p_query) as needle
     where char_length(regexp_replace(coalesce(p_query, ''), '^\s+|\s+$', '', 'g')) between 2 and 100
  ),
  q as (
    select (select string_agg(
                     case
                       when t.c = ' ' then '\s[\sً-ٰۖ-ۭ࣓-ࣿـ]*'
                       when t.c = 'ا' then '[اٱآأإ]'
                       when t.c ~ '^[[:alnum:]]$' then t.c
                       else '\' || t.c
                     end,
                     '[ً-ٰۖ-ۭ࣓-ࣿـ]*' order by t.i)
              from unnest(regexp_split_to_array(typed.needle, '')) with ordinality as t(c, i)) as pattern
      from typed
     where typed.needle <> ''
  )
  select d.id, d.title, d.preview, d.created_at, d.updated_at, d.pinned_at, d.content_length, d.content_bytes
    from public.note_documents d, q
   where d.user_id = (select auth.uid())
     and d.deleted_at is null
     and (d.title || E'\n' || d.content_text) ~* q.pattern
   order by (d.pinned_at is null), d.updated_at desc
   limit least(greatest(coalesce(p_limit, 50), 0), 50)
$fn$;

-- ── Emptying the trash, for everyone, once a day ─────────────────────────────
-- Called by /api/health on the production deployment with the service-role
-- key, never by a reader: SECURITY DEFINER so it may delete any account's
-- expired notes, and EXECUTE for service_role alone. At most p_limit notes a
-- call, oldest first; a second run the next day takes the rest. Returns how
-- many went — the only thing the caller logs.
create or replace function public.purge_note_trash(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  with doomed as (
    select d.id
      from public.note_documents d
     where d.deleted_at is not null
       and d.deleted_at < now() - make_interval(days => public.note_trash_days())
     order by d.deleted_at
     limit greatest(coalesce(p_limit, 0), 0)
       for update skip locked
  )
  delete from public.note_documents d
   using doomed
   where d.id = doomed.id;
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

-- ── A note nobody wrote in ───────────────────────────────────────────────────
-- «يېڭى خاتىرە» creates the row at once, so a writer who opens a new note and
-- leaves it would otherwise leave an empty «يېڭى خاتىرە» behind — and since
-- 0030, one that counts against the 200. The editor asks for it to go when it
-- is left untouched, and the list asks again for one still untouched a day
-- later (a tab closed on it); THIS decides. Only the caller's own note (SECURITY
-- INVOKER, RLS and the explicit filter), only outside the trash, only with
-- the default title and no text, and only if it was never saved after it was
-- made (updated_at moves on every save — see the trigger above). One
-- statement, so a save landing at the same moment either commits first and
-- keeps the note, or finds it gone and is told so (not_found, the text kept
-- on the writer's device).
create or replace function public.discard_note_if_empty(p_id bigint)
returns boolean
language sql
security invoker
set search_path = ''
as $fn$
  with gone as (
    delete from public.note_documents d
     where d.id = p_id
       and d.user_id = (select auth.uid())
       and d.deleted_at is null
       and d.title = 'يېڭى خاتىرە'
       and d.content_text = ''
       and d.updated_at = d.created_at
    returning d.id
  )
  select exists (select 1 from gone)
$fn$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke all on function public.note_trash_days() from public, anon, authenticated;
revoke all on function public.search_my_notes(text, integer) from public, anon;
grant execute on function public.search_my_notes(text, integer) to authenticated;
revoke all on function public.purge_note_trash(integer) from public, anon, authenticated;
grant execute on function public.purge_note_trash(integer) to service_role;
revoke all on function public.discard_note_if_empty(bigint) from public, anon;
grant execute on function public.discard_note_if_empty(bigint) to authenticated;

-- PostgREST learns the new columns and functions at once.
notify pgrst, 'reload schema';
