import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";

/**
 * The corner of a Supabase database the account rules run against, built in
 * PGlite from the real migration files — shared by the SQL unit tests and the
 * fake Supabase the auth-flow specs run on (tests/fixtures/supabase-mock.ts).
 *
 * Supabase's own parts are stubbed as little as they can be: its four roles,
 * and an auth.users with just the columns the hook, the brake, the admin card
 * and the sweep read. Everything of ours — profiles, settings, 0026, 0027 and
 * the domain seed — is the SQL that ships.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
export const AUTH_DOMAINS_SEED = join(process.cwd(), "supabase", "seed", "auth_domains.sql");

/** One `create table public.<name> (…);` statement, cut out of a migration. */
export function tableSql(file: string, name: string): string {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`create table public.${name} (`);
  if (start < 0) throw new Error(`public.${name} not found in ${file}`);
  const end = sql.indexOf("\n);", start);
  if (end < 0) throw new Error(`unterminated public.${name} in ${file}`);
  return sql.slice(start, end + "\n);".length);
}

export function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/**
 * Supabase's roles, and auth.users as far as the account rules read it.
 *
 * The public schema is granted role by role, as strictly as a Supabase
 * project may have it, rather than to everyone as a bare Postgres does — so a
 * migration that forgets to grant supabase_auth_admin the schema its hook
 * lives in fails here, not on the day the owner switches the hook on.
 */
export async function installAuthStubs(db: PGlite): Promise<void> {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role supabase_auth_admin;
    revoke all on schema public from public;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      created_at timestamptz not null default now(),
      email_confirmed_at timestamptz
    );
    grant usage on schema auth to supabase_auth_admin;
    grant select on auth.users to supabase_auth_admin;
  `);
}

/** Stubs, profiles and settings from 0001, then 0026, 0027 and — by default — the lists. */
export async function installAccountSchema(db: PGlite, { seedDomains = true } = {}): Promise<void> {
  await installAuthStubs(db);
  await db.exec(tableSql("0001_init.sql", "profiles"));
  await db.exec(tableSql("0001_init.sql", "settings"));
  await db.exec(migrationSql("0026_auth_attempts.sql"));
  await db.exec(migrationSql("0027_before_user_created_hook.sql"));
  if (seedDomains) await db.exec(readFileSync(AUTH_DOMAINS_SEED, "utf8"));
}

/** The event Auth hands the hook for a new user (shape per Supabase's docs). */
export function hookEvent(email: string): string {
  return JSON.stringify({
    metadata: {
      uuid: "8b34dcdd-9df1-4c10-850a-b3277c653040",
      time: new Date().toISOString(),
      name: "before-user-created",
      ip_address: "127.0.0.1",
    },
    user: {
      id: "ff7fc9ae-3b1b-4642-9241-64adb9848a03",
      aud: "authenticated",
      role: "",
      email,
      phone: "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "0001-01-01T00:00:00Z",
      updated_at: "0001-01-01T00:00:00Z",
      is_anonymous: false,
    },
  });
}
