-- ============================================================================
-- Devices beside page openings, and the last 30 days day by day (2026-10-23).
--
-- The owner accepted three refinements to the per-country tally of 0033:
--   · a count closer to "how many people" than page openings are;
--   · his own and the uploaders' visits left out (done in the site, by a
--     staff-only flag cookie — nothing here);
--   · a 30-day line, to see whether use is growing.
--
-- ── What is added ────────────────────────────────────────────────────────────
-- ONE integer column, `devices`, on the same (day, country) rows: how many
-- browsers said «I came today» for the first time that UTC day
-- (components/visit-beacon.tsx). The browser remembers the date in its own
-- localStorage; the server keeps nothing about it. It is still a tally — no
-- IP, cookie, agent, page or account — and a device is counted once a day,
-- so a 7-day figure is a sum of daily counts, not a count of distinct
-- devices. One person with a phone and a computer is two.
--
-- Size: +4 B on a row of ~80 B; nothing new to sweep (the 0033 sweep removes
-- whole rows).
--
-- ── Who can touch it ─────────────────────────────────────────────────────────
-- As in 0033: the table is service-role only, and the new function is
-- SECURITY DEFINER with EXECUTE for service_role alone.
-- ============================================================================

alter table public.country_visits
  add column if not exists devices integer not null default 0 check (devices >= 0);

comment on table public.country_visits is
  'Page openings and first-of-the-day devices per UTC day and country (0033, 0034). A tally only: no IP, cookie, page or account. Server-only: written through country_visits_add / country_devices_add.';

-- ── Add a batch of devices ───────────────────────────────────────────────────
-- Same shape and the same rules as country_visits_add: bad entries are
-- skipped, rows go in country order so concurrent batches cannot deadlock.
create or replace function public.country_devices_add(p_countries text[], p_counts integer[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.country_visits as v (day, country, visits, devices)
  select (now() at time zone 'UTC')::date, c.country, 0, sum(c.n)::integer
    from unnest(p_countries, p_counts) as c(country, n)
   where c.country ~ '^[A-Z]{2}$'
     and c.n > 0
   group by c.country
   order by c.country
  on conflict (day, country) do update
     set devices = v.devices + excluded.devices;
end;
$fn$;

-- ── What /admin/visits shows ─────────────────────────────────────────────────
-- Replaces 0033's version; everything it returned is still there, unchanged:
--   {"since": "2026-10-22" | null,
--    "rows": [{"country": "TR", "d7": 41, "d30": 310, "total": 1200,
--              "dev7": 9, "dev30": 60, "devtotal": 200}, …],
--    "days": [{"day": "2026-09-24", "visits": 12, "devices": 4}, … 30 entries,
--             oldest first, today last, days with nothing included as 0]}
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
           sum(v.visits)::bigint as total,
           coalesce(sum(v.devices) filter (where v.day > t.d - 7), 0)::bigint as dev7,
           coalesce(sum(v.devices) filter (where v.day > t.d - 30), 0)::bigint as dev30,
           sum(v.devices)::bigint as devtotal
      from public.country_visits v
     cross join today t
     group by v.country
  ),
  per_day as (
    select v.day, sum(v.visits)::bigint as visits, sum(v.devices)::bigint as devices
      from public.country_visits v
     cross join today t
     where v.day > t.d - 30
     group by v.day
  )
  select jsonb_build_object(
    'since', (select min(day) from public.country_visits),
    'rows', coalesce(
      (select jsonb_agg(
                jsonb_build_object('country', p.country, 'd7', p.d7, 'd30', p.d30, 'total', p.total,
                                   'dev7', p.dev7, 'dev30', p.dev30, 'devtotal', p.devtotal)
                order by p.d30 desc, p.total desc, p.country)
         from per_country p),
      '[]'::jsonb),
    'days', (
      select jsonb_agg(
               jsonb_build_object('day', g.day, 'visits', coalesce(d.visits, 0), 'devices', coalesce(d.devices, 0))
               order by g.day)
        from (select t.d - k as day from today t, generate_series(0, 29) as k) g
        left join per_day d on d.day = g.day
    )
  );
$fn$;

revoke all on function public.country_devices_add(text[], integer[]) from public, anon, authenticated;
revoke all on function public.country_visit_stats() from public, anon, authenticated;

grant execute on function public.country_devices_add(text[], integer[]) to service_role;
grant execute on function public.country_visit_stats() to service_role;
