-- ============================================================================
-- Read-only usage reporting, so the free tier can be measured rather than
-- guessed at. Postgres size functions are not reachable through PostgREST, so
-- they are wrapped in RPCs.
--
-- Both are SECURITY DEFINER (size functions need catalog access) but return
-- nothing sensitive: table names and byte counts only. Execute is granted to
-- authenticated users; the admin UI additionally checks the role, and the
-- reporting script uses the service role.
-- ============================================================================

create or replace function public.db_size_stats()
returns table (
  table_name text,
  total_bytes bigint,
  table_bytes bigint,
  index_bytes bigint,
  row_estimate bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    c.relname::text as table_name,
    pg_total_relation_size(c.oid) as total_bytes,
    pg_relation_size(c.oid) as table_bytes,
    pg_indexes_size(c.oid) as index_bytes,
    c.reltuples::bigint as row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by pg_total_relation_size(c.oid) desc
$fn$;

create or replace function public.db_index_stats()
returns table (
  table_name text,
  index_name text,
  index_bytes bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    t.relname::text as table_name,
    i.relname::text as index_name,
    pg_relation_size(i.oid) as index_bytes
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
  order by pg_relation_size(i.oid) desc
$fn$;

/** Total size of the whole database, for the free-tier gauge. */
create or replace function public.db_total_size()
returns bigint
language sql
stable
security definer
set search_path = ''
as $fn$
  select pg_database_size(current_database())
$fn$;

grant execute on function public.db_size_stats() to authenticated;
grant execute on function public.db_index_stats() to authenticated;
grant execute on function public.db_total_size() to authenticated;
