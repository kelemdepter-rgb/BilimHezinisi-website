import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The per-country tally behind «دۆلەتلەر بويىچە كىرىش» (migration 0033), run
 * against a real Postgres (PGlite — no Supabase project, never the live one).
 * The file under test is the migration exactly as it will be pasted into the
 * SQL Editor.
 *
 * Three things have to hold. Nobody but the server may read the table or call
 * the functions — with the public anon key anyone could inflate the numbers or
 * read them. The counting has to be exact and ignore bad input without losing
 * the good rows beside it. And the table must hold nothing but a tally.
 */
const MIGRATION = join(process.cwd(), "supabase", "migrations", "0033_country_visits.sql");

let db: PGlite;

async function add(countries: string[], counts: number[]): Promise<void> {
  await db.query("select public.country_visits_add($1, $2)", [countries, counts]);
}

type Row = { country: string; d7: number; d30: number; total: number };
async function stats(): Promise<{ since: string | null; rows: Row[] }> {
  const { rows } = await db.query<{ report: { since: string | null; rows: Row[] } }>(
    "select public.country_visit_stats() as report",
  );
  return rows[0].report;
}

/** Put a country's rows back in time — how "a month ago" is tested without waiting one. */
async function backdate(country: string, days: number): Promise<void> {
  await db.query("update public.country_visits set day = day - $2::integer where country = $1", [country, days]);
}

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
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(readFileSync(MIGRATION, "utf8"));
});

beforeEach(async () => {
  await db.exec("truncate public.country_visits");
});

afterAll(async () => {
  await db.close();
});

describe("adding openings", () => {
  it("adds up what each country sends, within a day and across batches", async () => {
    await add(["TR", "DE"], [3, 1]);
    await add(["TR"], [2]);
    const { rows } = await stats();
    expect(rows).toEqual([
      { country: "TR", d7: 5, d30: 5, total: 5 },
      { country: "DE", d7: 1, d30: 1, total: 1 },
    ]);
  });

  it("keeps one row per country per day", async () => {
    await add(["TR"], [1]);
    await add(["TR"], [1]);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.country_visits");
    expect(rows[0].n).toBe(1);
  });

  it("merges a country that appears twice in one batch", async () => {
    await add(["TR", "TR", "DE"], [2, 3, 1]);
    expect((await stats()).rows).toEqual([
      { country: "TR", d7: 5, d30: 5, total: 5 },
      { country: "DE", d7: 1, d30: 1, total: 1 },
    ]);
  });

  it("ignores what is not a country or a positive count, and still keeps the rest", async () => {
    await add(["TR", "tr", "T1", "XXX", "", "DE", "KZ", "SA"], [2, 9, 9, 9, 9, 0, -3, 4]);
    expect((await stats()).rows).toEqual([
      { country: "SA", d7: 4, d30: 4, total: 4 },
      { country: "TR", d7: 2, d30: 2, total: 2 },
    ]);
  });

  it("copes with arrays of different lengths and with nothing at all", async () => {
    await add(["TR", "DE"], [4]);
    await add([], []);
    expect((await stats()).rows).toEqual([{ country: "TR", d7: 4, d30: 4, total: 4 }]);
  });

  it("stores the day in UTC", async () => {
    await add(["TR"], [1]);
    const { rows } = await db.query<{ same: boolean }>(
      "select day = (now() at time zone 'UTC')::date as same from public.country_visits",
    );
    expect(rows[0].same).toBe(true);
  });

  it("stores nothing but a day, a country code and a number", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'country_visits' order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["day", "country", "visits"]);
  });

  it("refuses a malformed code even when written to directly", async () => {
    await expect(db.query("insert into public.country_visits (day, country, visits) values (current_date, 'tr', 1)")).rejects.toThrow();
    await expect(db.query("insert into public.country_visits (day, country, visits) values (current_date, 'TR', -1)")).rejects.toThrow();
  });
});

describe("what /admin reads", () => {
  it("is empty and dated null before anything is counted", async () => {
    expect(await stats()).toEqual({ since: null, rows: [] });
  });

  it("windows the last 7 and 30 days, today included, and keeps the total", async () => {
    await add(["TR"], [10]); // today
    await db.query("insert into public.country_visits values (current_date - 6, 'TR', 5)"); // inside 7
    await db.query("insert into public.country_visits values (current_date - 7, 'TR', 4)"); // outside 7, inside 30
    await db.query("insert into public.country_visits values (current_date - 29, 'TR', 3)"); // last day of 30
    await db.query("insert into public.country_visits values (current_date - 30, 'TR', 2)"); // outside 30
    const { rows } = await stats();
    expect(rows).toEqual([{ country: "TR", d7: 15, d30: 22, total: 24 }]);
  });

  it("puts the busiest country over 30 days first, and keeps one that only visited long ago", async () => {
    await add(["DE", "TR", "KZ"], [1, 9, 4]);
    await db.query("insert into public.country_visits values (current_date - 100, 'JP', 50)");
    const { rows } = await stats();
    expect(rows.map((r) => r.country)).toEqual(["TR", "KZ", "DE", "JP"]);
    expect(rows[3]).toEqual({ country: "JP", d7: 0, d30: 0, total: 50 });
  });

  it("says how far back the total reaches", async () => {
    await add(["TR"], [1]);
    await backdate("TR", 12);
    await add(["DE"], [1]);
    const { since } = await stats();
    const { rows } = await db.query<{ expected: string }>("select (current_date - 12)::text as expected");
    expect(since).toBe(rows[0].expected);
  });
});

describe("the daily sweep", () => {
  it("forgets days past the keep window and keeps the rest", async () => {
    await add(["TR"], [1]);
    await db.query("insert into public.country_visits values (current_date - 365, 'DE', 1)");
    await db.query("insert into public.country_visits values (current_date - 366, 'KZ', 1)");
    await db.query("insert into public.country_visits values (current_date - 900, 'SA', 1)");
    const { rows } = await db.query<{ removed: number }>("select public.country_visits_sweep(366) as removed");
    expect(rows[0].removed).toBe(2);
    expect((await stats()).rows.map((r) => r.country).sort()).toEqual(["DE", "TR"]);
  });
});

describe("who may touch it", () => {
  it("lets the service role use every function", async () => {
    await as("service_role", "select public.country_visits_add($1, $2)", [["TR"], [1]]);
    const report = await as<{ report: { rows: Row[] } }>("service_role", "select public.country_visit_stats() as report");
    expect(report[0].report.rows).toHaveLength(1);
    await as("service_role", "select public.country_visits_sweep(366)");
  });

  it.each(["anon", "authenticated"])("keeps %s away from the functions", async (role) => {
    await expect(as(role, "select public.country_visits_add($1, $2)", [["TR"], [1]])).rejects.toThrow(/permission denied/);
    await expect(as(role, "select public.country_visit_stats()")).rejects.toThrow(/permission denied/);
    await expect(as(role, "select public.country_visits_sweep(366)")).rejects.toThrow(/permission denied/);
  });

  it.each(["anon", "authenticated"])("keeps %s away from the table", async (role) => {
    await add(["TR"], [1]);
    await expect(as(role, "select * from public.country_visits")).rejects.toThrow(/permission denied/);
    await expect(as(role, "insert into public.country_visits values (current_date, 'DE', 1)")).rejects.toThrow(/permission denied/);
    await expect(as(role, "delete from public.country_visits")).rejects.toThrow(/permission denied/);
  });

  it("has row-level security on", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.country_visits'::regclass",
    );
    expect(rows[0].relrowsecurity).toBe(true);
  });
});
