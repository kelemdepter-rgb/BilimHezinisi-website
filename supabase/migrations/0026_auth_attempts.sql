-- ============================================================================
-- Three failed attempts, then an hour's lock, on /login and /register.
--
-- The owner's rule (PROMPT-38): each person gets three failed attempts on the
-- sign-in form and three on the registration form; the third failure locks
-- that form for one hour. The counter has to live here, not in the server's
-- memory: Vercel runs several instances of the site at once, and an
-- in-process counter would silently turn "three" into "three per instance".
-- lib/rate-limit.ts stays in front as the per-instance burst brake.
--
-- ── What is stored ───────────────────────────────────────────────────────────
-- One row per KEY, never one per attempt. A key is an HMAC-SHA-256 the server
-- computes (lib/auth/attempts.ts) over
--
--   · the form, the caller's IP address and a random device cookie — "a
--     person", so two readers behind one mobile carrier's shared address do
--     not use up each other's chances; and
--   · the form and the IP address alone — the backstop that stops a script
--     which clears its cookies, at ten failures an hour;
--
-- with a secret derived from the service-role key. No readable IP address,
-- cookie value or email address ever reaches this table, and a copy of it
-- cannot be turned back into any of them. An email address is deliberately
-- NOT a key: anyone could otherwise lock a stranger out of their own account
-- by typing that stranger's address three times.
--
-- The numbers (three, ten, an hour) are the caller's, passed in on every
-- call, so the policy lives in one place — lib/auth/attempts.ts — beside its
-- explanation. This file is the mechanism.
--
-- ── Who can touch it ─────────────────────────────────────────────────────────
-- Only the server. RLS is on with no policies, every privilege is revoked
-- from anon and authenticated, and the four functions are SECURITY DEFINER
-- with EXECUTE granted to service_role alone; the Server Actions reach them
-- through lib/supabase/admin.ts. Were they callable with the public anon key,
-- anyone could lock a stranger out or unlock themselves.
--
-- ── Size ─────────────────────────────────────────────────────────────────────
-- A row: tuple header 24 B + key 33 B (32-byte digest, stored as bytea rather
-- than 64 hex characters) + scope ≤ 9 B + failures 4 B + three timestamps
-- 24 B, with alignment 96 B, plus a 4 B line pointer = 100 B; its primary-key
-- entry 52 B. About 150 B a row.
--
-- A row is written only on a FAILED attempt, and swept a day after its window
-- and lock have both run out (auth_attempt_sweep, from the daily /api/health
-- cron — Vercel Hobby allows no second one), so it lives a little over a day.
-- A normal day is a handful of rows: well under 1 MB. The ceiling is set by
-- the backstop — once an address is locked nothing more is written for it —
-- at most 11 rows per form per hour per attacking IP address, about 550 rows
-- (≈ 80 KB) per address kept busy all day. Even a thousand addresses doing
-- that without pause stay near 80 MB, inside the 500 MB free tier.
--
-- ── Concurrency ──────────────────────────────────────────────────────────────
-- auth_attempt_fail is ONE INSERT … ON CONFLICT DO UPDATE statement. Postgres
-- guarantees that statement an atomic insert-or-update outcome: two failures
-- arriving together on one key serialise on that row's lock, the second sees
-- the first one's count, and neither is lost.
-- ============================================================================

create table if not exists public.auth_attempts (
  key_hash bytea primary key check (octet_length(key_hash) = 32),
  scope text not null check (scope in ('login', 'register')),
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.auth_attempts is
  'Failed sign-in/registration attempts per hashed key (PROMPT-38). Server-only: written through the auth_attempt_* functions.';

alter table public.auth_attempts enable row level security;
revoke all on table public.auth_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_attempts to service_role;

-- ── Is any of these keys locked? ─────────────────────────────────────────────
-- Returns the latest moment one of them is locked until, or null. A key whose
-- window and lock are both over is deleted on the way — "a key's own expired
-- row goes when it is next touched" — so the daily sweep is only the backstop.
create or replace function public.auth_attempt_status(p_keys text[], p_window_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_keys bytea[] := array(select decode(k, 'hex') from unnest(p_keys) as k);
  v_until timestamptz;
begin
  delete from public.auth_attempts a
   where a.key_hash = any (v_keys)
     and a.window_started_at <= now() - make_interval(secs => p_window_seconds)
     and (a.locked_until is null or a.locked_until <= now());

  select max(a.locked_until)
    into v_until
    from public.auth_attempts a
   where a.key_hash = any (v_keys)
     and a.locked_until > now();

  return v_until;
end;
$fn$;

-- ── Count one failure ────────────────────────────────────────────────────────
-- The window starts at a key's first failure and lasts p_window_seconds; a
-- failure after it has ended starts a new one at 1. The failure that brings
-- the count to p_limit locks the key for p_lock_seconds from that moment.
-- Returns the lock's end when the key is now locked, otherwise null.
create or replace function public.auth_attempt_fail(
  p_key text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer,
  p_lock_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_window interval := make_interval(secs => p_window_seconds);
  v_lock interval := make_interval(secs => p_lock_seconds);
  v_until timestamptz;
begin
  insert into public.auth_attempts as a
         (key_hash, scope, failures, window_started_at, locked_until, updated_at)
  values (decode(p_key, 'hex'), p_scope, 1, now(),
          case when p_limit <= 1 then now() + v_lock end, now())
  on conflict (key_hash) do update
     set failures = case when a.window_started_at <= now() - v_window then 1
                         else a.failures + 1 end,
         window_started_at = case when a.window_started_at <= now() - v_window then now()
                                  else a.window_started_at end,
         locked_until = case
           when (case when a.window_started_at <= now() - v_window then 1
                      else a.failures + 1 end) >= p_limit
             then now() + v_lock
           else a.locked_until
         end,
         updated_at = now()
  returning a.locked_until into v_until;

  return case when v_until > now() then v_until end;
end;
$fn$;

-- ── Forget these keys ────────────────────────────────────────────────────────
-- After a successful sign-in, and after a password is changed through the
-- recovery link.
create or replace function public.auth_attempt_clear(p_keys text[])
returns void
language sql
security definer
set search_path = ''
as $fn$
  delete from public.auth_attempts
   where key_hash = any (array(select decode(k, 'hex') from unnest(p_keys) as k));
$fn$;

-- ── Daily housekeeping ───────────────────────────────────────────────────────
-- Rows whose window and lock both ended more than a day ago. Called by the
-- daily /api/health cron; returns how many went.
create or replace function public.auth_attempt_sweep(p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_removed integer;
begin
  delete from public.auth_attempts a
   where a.window_started_at + make_interval(secs => p_window_seconds) < now() - interval '1 day'
     and (a.locked_until is null or a.locked_until < now() - interval '1 day');
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$fn$;

revoke all on function public.auth_attempt_status(text[], integer) from public, anon, authenticated;
revoke all on function public.auth_attempt_fail(text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.auth_attempt_clear(text[]) from public, anon, authenticated;
revoke all on function public.auth_attempt_sweep(integer) from public, anon, authenticated;

grant execute on function public.auth_attempt_status(text[], integer) to service_role;
grant execute on function public.auth_attempt_fail(text, text, integer, integer, integer) to service_role;
grant execute on function public.auth_attempt_clear(text[]) to service_role;
grant execute on function public.auth_attempt_sweep(integer) to service_role;
