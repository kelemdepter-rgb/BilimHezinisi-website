-- ============================================================================
-- Which countries the library is opened from: one daily count per country.
--
-- The owner asked to see where the site is used (2026-10-22). The answer has
-- to cost a reader nothing: no analytics script, no cookie, no IP address, no
-- page, no account, nothing that could point at one person. All that is kept
-- is a TALLY — "on this day, this country opened a page this many times".
--
-- ── What is stored ───────────────────────────────────────────────────────────
-- One row per (UTC day, ISO 3166-1 alpha-2 country code), e.g.
--   2026-10-22 | TR | 41
-- The code is the one Vercel itself puts on every request (x-vercel-ip-country);
-- proxy.ts (lib/visits/count.ts) reads that header, adds one to a counter and
-- throws the request's other details away. The count is of PAGE OPENINGS, not
-- of people: a reader who opens five pages is five, and the same reader on
-- another day is counted again. There is no way to tell two openings by the
-- same person apart, and none is needed.
--
-- ── Who can touch it ─────────────────────────────────────────────────────────
-- Only the server. RLS is on with no policies, every privilege is revoked from
-- anon and authenticated, and the three functions are SECURITY DEFINER with
-- EXECUTE granted to service_role alone. The anon key is public: were the
-- functions callable with it, anyone could inflate the numbers or read them.
-- /admin shows them to the admin only (lib/visits/data.ts).
--
-- ── Size ─────────────────────────────────────────────────────────────────────
-- A row: tuple header 24 B + date 4 B + a two-letter code 3 B + counter 4 B,
-- with alignment 40 B, plus a 4 B line pointer; its primary-key entry about
-- 32 B. About 80 B a row. At most ~250 countries a day, and rows older than a
-- year go (country_visits_sweep, from the daily /api/health cron — Vercel
-- Hobby allows no second one): never more than ~91,000 rows, about 7 MB, and
-- in practice a few thousand. The library's free 500 MB is not touched.
--
-- ── Writes ───────────────────────────────────────────────────────────────────
-- The site does not write once per page opening. Each server instance gathers
-- the openings of a few seconds and sends them in ONE call to
-- country_visits_add (lib/visits/count.ts), so a busy minute is a handful of
-- statements, not hundreds on one hot row. The statement is a single INSERT …
-- ON CONFLICT DO UPDATE with its rows in country order, so two instances
-- adding at once serialise on the row locks, in the same order, and neither
-- count is lost nor can they deadlock.
-- ============================================================================

create table if not exists public.country_visits (
  day date not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  visits integer not null default 0 check (visits >= 0),
  primary key (day, country)
);

comment on table public.country_visits is
  'Page openings per UTC day and country (2026-10-22). A tally only: no IP, cookie, page or account. Server-only: written through country_visits_add.';

alter table public.country_visits enable row level security;
revoke all on table public.country_visits from public, anon, authenticated;
grant select, insert, update, delete on table public.country_visits to service_role;

-- ── Add a batch of openings ──────────────────────────────────────────────────
-- p_countries[i] opened p_counts[i] pages. Anything that is not a two-letter
-- capital code, or has no positive count, is ignored rather than refused: a
-- bad entry must never cost the good ones in the same batch.
create or replace function public.country_visits_add(p_countries text[], p_counts integer[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.country_visits as v (day, country, visits)
  select (now() at time zone 'UTC')::date, c.country, sum(c.n)::integer
    from unnest(p_countries, p_counts) as c(country, n)
   where c.country ~ '^[A-Z]{2}$'
     and c.n > 0
   group by c.country
   order by c.country
  on conflict (day, country) do update
     set visits = v.visits + excluded.visits;
end;
$fn$;

-- ── What /admin shows ────────────────────────────────────────────────────────
-- ONE jsonb value, never a set of rows (PostgREST stops a set at 1,000):
--   {"since": "2026-10-22" | null,
--    "rows": [{"country": "TR", "d7": 41, "d30": 310, "total": 1200}, …]}
-- d7 and d30 are the last 7 and 30 UTC days, today included; total is
-- everything kept (a year at most). `since` is the first day with any count,
-- so the page can say how far back "total" really reaches. Busiest country
-- over 30 days first.
create or replace function public.country_visit_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with today as (
    select (now() at time zone 'UTC')::date as d
  ),
  per_country as (
    select v.country,
           coalesce(sum(v.visits) filter (where v.day > t.d - 7), 0)::bigint as d7,
           coalesce(sum(v.visits) filter (where v.day > t.d - 30), 0)::bigint as d30,
           sum(v.visits)::bigint as total
      from public.country_visits v
     cross join today t
     group by v.country
  )
  select jsonb_build_object(
    'since', (select min(day) from public.country_visits),
    'rows', coalesce(
      (select jsonb_agg(
                jsonb_build_object('country', p.country, 'd7', p.d7, 'd30', p.d30, 'total', p.total)
                order by p.d30 desc, p.total desc, p.country)
         from per_country p),
      '[]'::jsonb)
  );
$fn$;

-- ── Daily housekeeping ───────────────────────────────────────────────────────
-- Forget days older than p_keep_days. Called by the daily /api/health cron;
-- returns how many rows went.
create or replace function public.country_visits_sweep(p_keep_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_removed integer;
begin
  delete from public.country_visits v
   where v.day <= (now() at time zone 'UTC')::date - p_keep_days;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$fn$;

revoke all on function public.country_visits_add(text[], integer[]) from public, anon, authenticated;
revoke all on function public.country_visit_stats() from public, anon, authenticated;
revoke all on function public.country_visits_sweep(integer) from public, anon, authenticated;

grant execute on function public.country_visits_add(text[], integer[]) to service_role;
grant execute on function public.country_visit_stats() to service_role;
grant execute on function public.country_visits_sweep(integer) to service_role;
