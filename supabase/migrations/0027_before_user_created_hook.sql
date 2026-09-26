-- ============================================================================
-- Guarding sign-up inside Supabase itself (PROMPT-39).
--
-- The project's URL and anon key are public — they are in every page's
-- JavaScript — so anyone can call Supabase Auth's /auth/v1/signup directly
-- and skip every check the site's Server Actions make. What must hold against
-- a determined attacker therefore has to live here, in the database Auth
-- consults before it creates a user: the Before User Created hook
-- (https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook,
-- available on the Free plan). Enable it after running this file: Supabase →
-- Authentication → Hooks → Before User Created → Postgres →
-- public.hook_before_user_created.
--
-- The hook refuses a new user when:
--   1. the owner paused registration from /admin (settings.registration_paused)
--   2. the automatic brake is engaged: 30 or more unconfirmed accounts were
--      created in the last hour (auth_signup_brake_limit, below)
--        → both answer 'bh:registration_paused', so an attacker cannot tell
--          the brake from the switch;
--   3. the address's domain, or any parent of it, is under Chinese (PRC)
--      jurisdiction by name → 'bh:blocked';
--   4. the domain, or any parent of it, is a disposable-mail service
--      → 'bh:disposable'.
-- The site maps these messages to its Uyghur texts (lib/auth/reasons.ts).
--
-- What it cannot do: the MX half of the Chinese-jurisdiction rule (a custom
-- domain whose mail is received by Tencent, NetEase, Alibaba…) needs a DNS
-- lookup, which Postgres cannot make; that half stays in the Server Actions
-- (lib/auth/email-dns.ts). Internationalised domains arrive only in their
-- punycode form — Auth refuses non-ASCII addresses before it calls any hook —
-- so the lists hold punycode only.
--
-- ── When Auth calls it (read in supabase/auth's source, 2026-09-26) ──────────
-- Only when a NEW user is about to be created by a public path: email sign-up
-- (for an address with no account yet), magic link, OAuth. Not for an address
-- that already has an account, and not for users created through the admin
-- API — which is how the Playwright suite makes its bh-e2e- accounts, so the
-- suite can never be refused by this hook.
--
-- ── The brake counts only UNCONFIRMED accounts ───────────────────────────────
-- A public sign-up with "Confirm email" on is unconfirmed until its link is
-- clicked; an account created through the admin API with email_confirm is
-- confirmed from its first moment. Counting unconfirmed accounts is what makes
-- sure the test suite — which creates confirmed accounts, often a dozen a run —
-- can never engage the brake, and it needs no bypass anybody could type: the
-- public endpoint cannot create a confirmed account.
--
-- ── Why SECURITY DEFINER ─────────────────────────────────────────────────────
-- Supabase's general hook advice is SECURITY INVOKER with grants, but an
-- invoker function running as supabase_auth_admin cannot see a row of a table
-- whose RLS has no policy for that role — and settings (RLS: public rows or
-- admin) and the two lists (RLS on, no policies at all) would all read as
-- empty. Definer functions owned by postgres read them as the owner. That is
-- safe here because they only read, run no dynamic SQL, pin search_path to ''
-- and are executable by supabase_auth_admin alone. (supabase/supabase PR
-- #40218, open on 2026-09-26, moves the documented hooks to the same pattern
-- for the same reason.)
--
-- ── Cost ─────────────────────────────────────────────────────────────────────
-- Postgres hooks must answer within 2 s. This one does one primary-key read of
-- settings, one count over auth.users created in the last hour (a sequential
-- scan of a table of a few thousand rows is well under a millisecond), and one
-- primary-key probe per label of the domain — `a.b.c.example.com` is five.
-- ============================================================================

-- ── The lists ────────────────────────────────────────────────────────────────
-- The TypeScript lists are the source (lib/auth/blocked-email-domains.ts,
-- lib/auth/disposable-domains.ts); scripts/sync-auth-domains.mjs copies them
-- here through auth_domains_replace() and writes the same data to
-- supabase/seed/auth_domains.sql, which tests/unit/auth-domains-sync.test.ts
-- compares against the TypeScript. Nothing personal is stored: domain names only.
create table if not exists public.auth_blocked_domains (
  domain text primary key check (domain <> '' and domain = lower(domain))
);

create table if not exists public.auth_disposable_domains (
  domain text primary key check (domain <> '' and domain = lower(domain))
);

alter table public.auth_blocked_domains enable row level security;
alter table public.auth_disposable_domains enable row level security;
revoke all on table public.auth_blocked_domains from public, anon, authenticated;
revoke all on table public.auth_disposable_domains from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_blocked_domains to service_role;
grant select, insert, update, delete on table public.auth_disposable_domains to service_role;
-- Every table the hook reads is granted to the role Auth runs it as, as
-- Supabase's hook documentation does. (The definer functions read as their
-- owner regardless; the grants keep the hook working should one ever become
-- an invoker function.)
grant select on table public.auth_blocked_domains to supabase_auth_admin;
grant select on table public.auth_disposable_domains to supabase_auth_admin;
grant select on table public.settings to supabase_auth_admin;

-- ── The owner's switches ─────────────────────────────────────────────────────
-- registration_paused is public: /register reads it to hide its form, and
-- "registration is paused right now" is no secret. The sweep switch is not.
insert into public.settings (key, value, is_public)
values
  ('registration_paused', 'false'::jsonb, true),
  ('unconfirmed_sweep_enabled', 'false'::jsonb, false)
on conflict (key) do nothing;

-- ── The automatic brake ──────────────────────────────────────────────────────
-- The one place the threshold lives; the admin card reads it back through
-- account_security_stats(). Why 30 when the email allowance is 20 an hour: a
-- normal day here is a handful of sign-ups, so 30 in an hour is already an
-- attack, and it sits above the allowance so the brake never closes the door
-- on a busy but honest hour. With "Confirm email" on, Auth rolls a sign-up
-- back when its email cannot be sent, so today the 20-an-hour allowance
-- already caps new unconfirmed rows; the brake is the backstop that still
-- holds if that allowance is ever raised, or a sign-up path appears that
-- creates rows without sending mail.
create or replace function public.auth_signup_brake_limit()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 30
$fn$;

create or replace function public.auth_recent_unconfirmed_signups()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer
    from auth.users u
   where u.created_at > now() - interval '1 hour'
     and u.email_confirmed_at is null
$fn$;

-- ── The hook ─────────────────────────────────────────────────────────────────
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(coalesce(event #>> '{user,email}', ''));
  v_domain text := substring(v_email from '@([^@]+)$');
  v_labels text[];
  v_suffixes text[] := '{}';
begin
  if coalesce((select s.value = 'true'::jsonb from public.settings s where s.key = 'registration_paused'), false)
     or public.auth_recent_unconfirmed_signups() >= public.auth_signup_brake_limit() then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'bh:registration_paused'));
  end if;

  -- No address (a phone or OAuth identity without one): nothing to judge.
  if v_domain is null or v_domain = '' then
    return '{}'::jsonb;
  end if;

  -- The domain and every parent of it: a.b.c → a.b.c, b.c, c.
  v_labels := string_to_array(v_domain, '.');
  for i in 1 .. coalesce(array_length(v_labels, 1), 0) loop
    v_suffixes := v_suffixes || array_to_string(v_labels[i:], '.');
  end loop;

  if exists (select 1 from public.auth_blocked_domains b where b.domain = any (v_suffixes)) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'bh:blocked'));
  end if;

  if exists (select 1 from public.auth_disposable_domains d where d.domain = any (v_suffixes)) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'bh:disposable'));
  end if;

  return '{}'::jsonb;
end;
$fn$;

-- ── For the admin card ───────────────────────────────────────────────────────
-- Unconfirmed accounts the daily sweep may delete: never confirmed, more than
-- 7 days old, an ordinary reader, and not the admin's address (compared with
-- both ADMIN_EMAIL, passed in, and the copy mirrored into settings). Deleting
-- the auth user cascades to profiles and every per-user table (0001, 0007).
create or replace function public.unconfirmed_accounts_to_sweep(p_admin_email text, p_limit integer)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select u.id
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.email_confirmed_at is null
     and u.email is not null
     and u.created_at < now() - interval '7 days'
     and coalesce(p.role, 'reader') = 'reader'
     and lower(u.email) <> lower(coalesce(nullif(p_admin_email, ''), '-'))
     and lower(u.email) <> lower(coalesce(
           nullif((select s.value #>> '{}' from public.settings s where s.key = 'admin_email'), ''), '-'))
   order by u.created_at
   limit greatest(0, least(coalesce(p_limit, 0), 1000))
$fn$;

create or replace function public.account_security_stats(p_admin_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'new_last_hour', (select count(*) from auth.users u where u.created_at > now() - interval '1 hour'),
    'new_last_day', (select count(*) from auth.users u where u.created_at > now() - interval '1 day'),
    'brake_count', public.auth_recent_unconfirmed_signups(),
    'brake_limit', public.auth_signup_brake_limit(),
    'unconfirmed', (select count(*) from auth.users u where u.email_confirmed_at is null and u.email is not null),
    'sweepable', (select count(*) from public.unconfirmed_accounts_to_sweep(p_admin_email, 1000)),
    'active_locks', (select count(*) from public.auth_attempts a where a.locked_until > now()),
    'blocked_domains', (select count(*) from public.auth_blocked_domains),
    'disposable_domains', (select count(*) from public.auth_disposable_domains)
  )
$fn$;

-- ── For scripts/sync-auth-domains.mjs ────────────────────────────────────────
-- Replaces both lists in one transaction. Refuses a nearly empty list, so a
-- broken run can never quietly switch the protection off.
create or replace function public.auth_domains_replace(p_blocked text[], p_disposable text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if coalesce(array_length(p_blocked, 1), 0) < 5 or coalesce(array_length(p_disposable, 1), 0) < 1000 then
    raise exception 'refusing to replace the auth domain lists with a nearly empty list';
  end if;

  delete from public.auth_blocked_domains where true;
  insert into public.auth_blocked_domains (domain)
  select distinct lower(trim(d)) from unnest(p_blocked) as d where trim(d) <> '';

  delete from public.auth_disposable_domains where true;
  insert into public.auth_disposable_domains (domain)
  select distinct lower(trim(d)) from unnest(p_disposable) as d where trim(d) <> '';

  return jsonb_build_object(
    'blocked', (select count(*) from public.auth_blocked_domains),
    'disposable', (select count(*) from public.auth_disposable_domains)
  );
end;
$fn$;

-- ── Who may call what ────────────────────────────────────────────────────────
-- Auth runs as supabase_auth_admin; Supabase's hook documentation grants it
-- the schema as well as the function, and so does this.
grant usage on schema public to supabase_auth_admin;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

revoke all on function public.auth_signup_brake_limit() from public, anon, authenticated;
revoke all on function public.auth_recent_unconfirmed_signups() from public, anon, authenticated;
revoke all on function public.unconfirmed_accounts_to_sweep(text, integer) from public, anon, authenticated;
revoke all on function public.account_security_stats(text) from public, anon, authenticated;
revoke all on function public.auth_domains_replace(text[], text[]) from public, anon, authenticated;

grant execute on function public.unconfirmed_accounts_to_sweep(text, integer) to service_role;
grant execute on function public.account_security_stats(text) to service_role;
grant execute on function public.auth_domains_replace(text[], text[]) to service_role;
