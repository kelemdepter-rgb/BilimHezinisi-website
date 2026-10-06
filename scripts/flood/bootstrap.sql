-- ============================================================================
-- LOCAL FLOOD STACK ONLY (scripts/flood/stack.mjs). Never run against the
-- live project.
--
-- The supabase/postgres image brings the roles (anon, authenticated,
-- service_role, authenticator, supabase_auth_admin …), the role statement
-- timeouts (anon 3 s, authenticated 8 s) and a first auth schema. What it
-- leaves to the other Supabase services — GoTrue's later auth.users columns
-- and its JWT-claims helpers, storage-api's two tables — is stood in for here,
-- so every migration in supabase/migrations applies unchanged.
-- ============================================================================

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists is_anonymous boolean default false;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean default false,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to postgres, service_role;
grant select on storage.buckets, storage.objects to anon, authenticated;
grant references, select on auth.users to postgres;

-- PostgREST 10+ sets request.jwt.claims (JSON), not the old per-claim
-- settings the image's first helpers read; GoTrue's migrations make them read
-- both, and so does this.
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$fn$;
create or replace function auth.email() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text
$fn$;
