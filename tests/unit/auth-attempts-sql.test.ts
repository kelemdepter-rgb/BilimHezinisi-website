import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The failed-attempt counter behind «email نى كىرگۈزۈش چېكى توشۇپ قالدى»,
 * run against a real Postgres (PGlite — the same engine compiled to
 * WebAssembly, no network, no Supabase project, and certainly never the
 * production one). The file under test is the migration exactly as it will be
 * pasted into the SQL Editor.
 *
 * Two things have to hold. Nobody but the server may read the table or call
 * the functions — with the public anon key, anyone could lock a stranger out
 * or unlock themselves. And the counting has to be exact: three is three.
 */
const MIGRATION = join(process.cwd(), "supabase", "migrations", "0026_auth_attempts.sql");

const HOUR = 3600;

let db: PGlite;

/** A key the way lib/auth/attempts.ts makes one: 32 bytes, as hex. */
function key(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

async function fail(k: string, limit = 3, scope = "login"): Promise<Date | null> {
  const { rows } = await db.query<{ until: Date | null }>(
    "select public.auth_attempt_fail($1, $2, $3, $4, $5) as until",
    [k, scope, limit, HOUR, HOUR],
  );
  return rows[0].until;
}

async function status(keys: string[]): Promise<Date | null> {
  const { rows } = await db.query<{ until: Date | null }>(
    "select public.auth_attempt_status($1, $2) as until",
    [keys, HOUR],
  );
  return rows[0].until;
}

async function failuresOf(k: string): Promise<number | null> {
  const { rows } = await db.query<{ failures: number }>(
    "select failures from public.auth_attempts where key_hash = decode($1, 'hex')",
    [k],
  );
  return rows[0]?.failures ?? null;
}

/** Move a key's row back in time — how "an hour later" is tested without waiting one. */
async function age(k: string, seconds: number): Promise<void> {
  await db.query(
    `update public.auth_attempts
        set window_started_at = window_started_at - make_interval(secs => $2),
            locked_until = locked_until - make_interval(secs => $2),
            updated_at = updated_at - make_interval(secs => $2)
      where key_hash = decode($1, 'hex')`,
    [k, seconds],
  );
}

/** Run one statement as a Supabase role, the way PostgREST would. */
async function as<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = await new PGlite();
  // Supabase's roles; PGlite starts with none of them.
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(readFileSync(MIGRATION, "utf8"));
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from public.auth_attempts");
});

describe("who may touch the counter", () => {
  const calls: Array<[string, unknown[]]> = [
    ["select public.auth_attempt_status($1, $2)", [[key("a")], HOUR]],
    ["select public.auth_attempt_fail($1, 'login', 3, $2, $2)", [key("a"), HOUR]],
    ["select public.auth_attempt_clear($1)", [[key("a")]]],
    ["select public.auth_attempt_sweep($1)", [HOUR]],
  ];

  for (const role of ["anon", "authenticated"]) {
    it(`${role} can neither read the table nor call any function`, async () => {
      await fail(key("someone"));
      await expect(as(role, "select * from public.auth_attempts")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        as(role, "delete from public.auth_attempts where true"),
      ).rejects.toMatchObject({ code: "42501" });
      for (const [sql, params] of calls) {
        await expect(as(role, sql, params), sql).rejects.toMatchObject({ code: "42501" });
      }
      // Nothing it tried changed anything.
      expect(await failuresOf(key("someone"))).toBe(1);
    });
  }

  it("service_role can read the table and call every function", async () => {
    for (const [sql, params] of calls) {
      await expect(as("service_role", sql, params), sql).resolves.toBeDefined();
    }
    const rows = await as<{ count: number }>("service_role", "select count(*)::int as count from public.auth_attempts");
    expect(rows[0].count).toBe(0);
  });

  it("stores no readable key — only the 32-byte digest", async () => {
    await expect(fail("not-a-digest")).rejects.toThrow();
    await expect(fail(key("short").slice(0, 40))).rejects.toThrow();
  });
});

describe("three chances", () => {
  it("the third failure locks for an hour, and says until when", async () => {
    const person = key("person");
    expect(await fail(person)).toBeNull();
    expect(await fail(person)).toBeNull();
    const until = await fail(person);
    expect(until).toBeInstanceOf(Date);
    const lockMinutes = (until!.getTime() - Date.now()) / 60_000;
    expect(lockMinutes).toBeGreaterThan(59);
    expect(lockMinutes).toBeLessThanOrEqual(60.1);
    expect(await status([person])).toEqual(until);
  });

  it("a lock on either key answers for both", async () => {
    const person = key("person");
    const network = key("network");
    for (let i = 0; i < 10; i += 1) await fail(network, 10);
    expect(await status([person, network])).toBeInstanceOf(Date);
    expect(await status([person])).toBeNull();
  });

  it("the lock lifts an hour later, and the row goes with it", async () => {
    const person = key("person");
    await fail(person);
    await fail(person);
    await fail(person);
    await age(person, HOUR + 1);
    expect(await status([person])).toBeNull();
    expect(await failuresOf(person), "an expired row is removed when it is next touched").toBeNull();
    // And the person starts again with three.
    expect(await fail(person)).toBeNull();
    expect(await failuresOf(person)).toBe(1);
  });

  it("failures more than an hour apart never add up to a lock", async () => {
    const person = key("person");
    await fail(person);
    await fail(person);
    await age(person, HOUR + 1);
    expect(await fail(person), "a new window starts at 1").toBeNull();
    expect(await failuresOf(person)).toBe(1);
  });

  it("a lock outlives the window it was earned in", async () => {
    const person = key("person");
    await fail(person);
    await age(person, 50 * 60); // first failure 50 minutes ago
    await fail(person);
    await fail(person); // locked now, for an hour from now
    await age(person, 20 * 60); // the window has ended, the lock has not
    expect(await status([person])).toBeInstanceOf(Date);
  });

  it("clearing forgets the key", async () => {
    const person = key("person");
    await fail(person);
    await fail(person);
    await db.query("select public.auth_attempt_clear($1)", [[person]]);
    expect(await failuresOf(person)).toBeNull();
    expect(await fail(person)).toBeNull();
  });

  it("keys never share a count", async () => {
    await fail(key("one"));
    await fail(key("one"));
    await fail(key("two"));
    expect(await failuresOf(key("one"))).toBe(2);
    expect(await failuresOf(key("two"))).toBe(1);
  });

  /**
   * What this does and does not prove. PGlite runs one statement at a time,
   * so these ten calls are queued, not truly simultaneous: the test proves
   * the count survives being fired all at once from the application side, not
   * a race inside Postgres. The race is closed by construction — one
   * INSERT … ON CONFLICT DO UPDATE per failure, which Postgres guarantees an
   * atomic outcome on the row's lock — and that is written down in the
   * migration, next to the statement.
   */
  it("failures fired together on one key are all counted", async () => {
    const person = key("burst");
    const results = await Promise.all(Array.from({ length: 10 }, () => fail(person)));
    expect(await failuresOf(person)).toBe(10);
    expect(results.filter((until) => until === null)).toHaveLength(2);
    expect(await status([person])).toBeInstanceOf(Date);
  });
});

describe("housekeeping", () => {
  it("the sweep removes rows whose window and lock ended more than a day ago", async () => {
    const old = key("old");
    const recent = key("recent");
    const stillLocked = key("locked");
    await fail(old);
    await fail(recent);
    for (let i = 0; i < 3; i += 1) await fail(stillLocked);

    await age(old, 26 * HOUR);
    await age(recent, 2 * HOUR);

    const { rows } = await db.query<{ removed: number }>(
      "select public.auth_attempt_sweep($1) as removed",
      [HOUR],
    );
    expect(rows[0].removed).toBe(1);
    expect(await failuresOf(old)).toBeNull();
    expect(await failuresOf(recent)).toBe(1);
    expect(await failuresOf(stillLocked)).toBe(3);
  });
});
