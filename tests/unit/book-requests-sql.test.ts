import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Who can read a book request, and how big the table is allowed to get.
 *
 * These are the two claims the feature rests on, and neither can be checked by
 * looking at the form: the anon key is public, so anybody can POST straight to
 * PostgREST and try to SELECT the table back. So the policies and the caps are
 * exercised here against a real Postgres, as the roles themselves — `set role
 * anon` and `set role authenticated`, with a JWT subject, exactly as Supabase
 * runs a request.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function functionSql(file: string, name: string): string {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const end = sql.indexOf("$fn$;", start);
  return sql.slice(start, end + "$fn$;".length);
}

const ADMIN = "11111111-1111-1111-1111-111111111111";
const READER = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

beforeAll(async () => {
  db = await new PGlite();
  await db.exec(`create role anon; create role authenticated;`);

  // What Supabase provides and PGlite does not: the auth schema's uid(), read
  // from the request's JWT claims the way the platform sets them.
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.profiles (
      id uuid primary key,
      role text not null default 'reader'
    );
  `);
  await db.exec(functionSql("0001_init.sql", "is_admin"));
  await db.exec(readFileSync(join(MIGRATIONS, "0022_book_requests.sql"), "utf8"));

  // Supabase grants these by default privilege on every new public table;
  // PGlite does not, so without them the roles below would fail on the GRANT
  // rather than on the POLICY — and the test would prove nothing.
  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on public.book_requests to anon, authenticated;
    grant execute on function public.is_admin() to anon, authenticated;
  `);

  await db.query(`insert into public.profiles (id, role) values ($1, 'admin'), ($2, 'reader')`, [
    ADMIN,
    READER,
  ]);
});

afterAll(async () => {
  await db?.close();
});

/** Run one statement as a Supabase role, with an optional signed-in user. */
async function asRole<T>(role: "anon" | "authenticated", uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    await db.exec(`set local role ${role}`);
    const result = await db.query<Record<string, unknown>>(sql, params);
    await db.exec("commit");
    return result.rows as T[];
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function seed(count: number, prefix = "كىتاب") {
  await db.exec(`delete from public.book_requests`);
  for (let index = 0; index < count; index += 1) {
    await db.query(`insert into public.book_requests (title) values ($1)`, [`${prefix} ${index}`]);
  }
}

describe("who can read a book request", () => {
  beforeAll(async () => {
    await seed(0);
    await db.query(
      `insert into public.book_requests (title, author, note, contact) values ($1, $2, $3, $4)`,
      ["مەخپىي تەلەپ", "ئاپتور", "خەت", "someone@example.com"],
    );
  });

  it("lets a signed-out visitor write one", async () => {
    await asRole("anon", null, `insert into public.book_requests (title) values ('يېڭى تەلەپ')`);
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.book_requests`);
    expect(rows.rows[0].n).toBeGreaterThan(1);
  });

  it("gives a signed-out visitor nothing back", async () => {
    const rows = await asRole("anon", null, `select id, title from public.book_requests`);
    expect(rows, "anon must not be able to read the inbox").toHaveLength(0);
  });

  it("gives a plain reader nothing back either", async () => {
    const rows = await asRole("authenticated", READER, `select id, title from public.book_requests`);
    expect(rows, "a signed-in reader is not an admin").toHaveLength(0);
  });

  it("gives the admin everything", async () => {
    const rows = await asRole("authenticated", ADMIN, `select id, title from public.book_requests`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("does not let a reader mark a request handled or delete it", async () => {
    const before = await asRole<{ n: number }>(
      "authenticated",
      ADMIN,
      `select count(*)::int as n from public.book_requests`,
    );
    await asRole("authenticated", READER, `update public.book_requests set handled = true`);
    await asRole("authenticated", READER, `delete from public.book_requests`);
    const after = await asRole<{ n: number }>(
      "authenticated",
      ADMIN,
      `select count(*)::int as n from public.book_requests where handled = false`,
    );
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("what the database refuses to store", () => {
  it("refuses an empty title", async () => {
    await expect(
      db.query(`insert into public.book_requests (title) values ('')`),
    ).rejects.toThrow();
  });

  it("refuses a title, note or contact longer than its cap", async () => {
    await expect(
      db.query(`insert into public.book_requests (title) values ($1)`, ["ب".repeat(201)]),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into public.book_requests (title, note) values ('ماۋزۇ', $1)`, [
        "ب".repeat(501),
      ]),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into public.book_requests (title, contact) values ('ماۋزۇ', $1)`, [
        "b".repeat(161),
      ]),
    ).rejects.toThrow();
  });
});

describe("the caps that keep it out of the 500 MB budget", () => {
  it("stops accepting once the day's allowance is spent", async () => {
    await seed(100);
    await expect(
      db.query(`insert into public.book_requests (title) values ('بىر تەلەپ تولۇق')`),
    ).rejects.toThrow(/book_requests_daily_cap/);
  });

  it("applies the cap to anon too, not only to the form", async () => {
    await seed(100);
    await expect(
      asRole("anon", null, `insert into public.book_requests (title) values ('بوت')`),
    ).rejects.toThrow(/book_requests_daily_cap/);
  });

  it("lets the admin make room by deleting what they have handled", async () => {
    await seed(100);
    await db.exec(`delete from public.book_requests`);
    await expect(
      db.query(`insert into public.book_requests (title) values ('ئەمدى بولىدۇ')`),
    ).resolves.toBeTruthy();
  });
});
