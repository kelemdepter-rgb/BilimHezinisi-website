-- ============================================================================
-- See the space that deleted rows are still holding.
--
-- Deleting a book removes its rows and its pages (ON DELETE CASCADE), but
-- Postgres does not hand the disk back: the rows become dead tuples, and the
-- GIN index over page content does not shrink at all until it is rebuilt. On a
-- 500 MB free tier that difference is the whole question of whether deleting a
-- book actually made room for another one.
--
-- Same shape and same guarantees as the reporting functions in 0005: read-only,
-- SECURITY DEFINER because the statistics views need catalog access, and
-- nothing sensitive in the output — table names, row counts and timestamps.
-- ============================================================================

create or replace function public.db_bloat_stats()
returns table (
  table_name text,
  live_rows bigint,
  dead_rows bigint,
  total_bytes bigint,
  table_bytes bigint,
  index_bytes bigint,
  last_vacuum timestamptz,
  last_autovacuum timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    s.relname::text as table_name,
    s.n_live_tup as live_rows,
    s.n_dead_tup as dead_rows,
    pg_total_relation_size(c.oid) as total_bytes,
    pg_relation_size(c.oid) as table_bytes,
    pg_indexes_size(c.oid) as index_bytes,
    s.last_vacuum,
    s.last_autovacuum
  from pg_stat_user_tables s
  join pg_class c on c.oid = s.relid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
  order by pg_total_relation_size(c.oid) desc
$fn$;

grant execute on function public.db_bloat_stats() to authenticated;
