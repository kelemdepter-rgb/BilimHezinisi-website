import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Devices and the 30-day series (migration 0034), on top of 0033, run against
 * a real Postgres (PGlite — never the live project). Both files exactly as
 * they will be pasted into the SQL Editor, in order.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

let db: PGlite;

type Row = { country: string; d7: number; d30: number; total: number; dev7: number; dev30: number; devtotal: number };
type Day = { day: string; visits: number; devices: number };
type Report = { since: string | null; rows: Row[]; days: Day[] };

async function stats(): Promise<Report> {
  const { rows } = await db.query<{ report: Report }>("select public.country_visit_stats() as report");
  return rows[0].report;
}

async function as<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

async function utcToday(offset = 0): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    "select ((now() at time zone 'UTC')::date + $1::integer)::text as d",
    [offset],
  );
  return rows[0].d;
}

beforeAll(async () => {
  db = await new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(readFileSync(join(MIGRATIONS, "0033_country_visits.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0034_country_devices.sql"), "utf8"));
});

beforeEach(async () => {
  await db.exec("truncate public.country_visits");
});

afterAll(async () => {
  await db.close();
});

describe("devices", () => {
  it("adds devices beside page openings, on the same row", async () => {
    await db.query("select public.country_visits_add($1, $2)", [["TR"], [5]]);
    await db.query("select public.country_devices_add($1, $2)", [["TR", "DE"], [2, 1]]);
    await db.query("select public.country_devices_add($1, $2)", [["TR"], [1]]);
    const { rows } = await stats();
    expect(rows).toEqual([
      { country: "TR", d7: 5, d30: 5, total: 5, dev7: 3, dev30: 3, devtotal: 3 },
      { country: "DE", d7: 0, d30: 0, total: 0, dev7: 1, dev30: 1, devtotal: 1 },
    ]);
    const { rows: n } = await db.query<{ n: number }>("select count(*)::int as n from public.country_visits");
    expect(n[0].n).toBe(2);
  });

  it("skips what is not a country or a positive count", async () => {
    await db.query("select public.country_devices_add($1, $2)", [["TR", "tr", "KZ", "XJ"], [1, 5, 0, 2]]);
    // Openings decide the order; with none, the code does.
    expect((await stats()).rows.map((r) => [r.country, r.devtotal])).toEqual([
      ["TR", 1],
      ["XJ", 2],
    ]);
  });

  it("leaves the rows 0033 already wrote intact, with no devices", async () => {
    await db.query("insert into public.country_visits (day, country, visits) values (current_date - 3, 'SA', 4)");
    const { rows } = await stats();
    expect(rows).toEqual([{ country: "SA", d7: 4, d30: 4, total: 4, dev7: 0, dev30: 0, devtotal: 0 }]);
  });

  it("refuses a negative device count written directly", async () => {
    await expect(
      db.query("insert into public.country_visits (day, country, visits, devices) values (current_date, 'TR', 0, -1)"),
    ).rejects.toThrow();
  });

  it("still holds nothing but a day, a code and two numbers", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'country_visits' order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["day", "country", "visits", "devices"]);
  });
});

describe("the 30-day series", () => {
  it("has exactly 30 days, oldest first, today last, empty days as 0", async () => {
    await db.query("select public.country_visits_add($1, $2)", [["TR", "DE"], [3, 2]]);
    await db.query("select public.country_devices_add($1, $2)", [["TR"], [1]]);
    await db.query("insert into public.country_visits values ((now() at time zone 'UTC')::date - 29, 'KZ', 7, 2)");
    await db.query("insert into public.country_visits values ((now() at time zone 'UTC')::date - 30, 'JP', 9, 9)");
    const { days } = await stats();
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: await utcToday(-29), visits: 7, devices: 2 });
    expect(days[29]).toEqual({ day: await utcToday(0), visits: 5, devices: 1 });
    expect(days.slice(1, 29).every((d) => d.visits === 0 && d.devices === 0)).toBe(true);
    const sorted = [...days].map((d) => d.day).sort();
    expect(days.map((d) => d.day)).toEqual(sorted);
  });

  it("is 30 zero days before anything is counted", async () => {
    const report = await stats();
    expect(report.since).toBeNull();
    expect(report.rows).toEqual([]);
    expect(report.days).toHaveLength(30);
    expect(report.days.every((d) => d.visits === 0 && d.devices === 0)).toBe(true);
  });
});

describe("who may touch it", () => {
  it("lets the service role add devices and read", async () => {
    await as("service_role", "select public.country_devices_add($1, $2)", [["TR"], [1]]);
    const report = await as<{ report: Report }>("service_role", "select public.country_visit_stats() as report");
    expect(report[0].report.rows[0].devtotal).toBe(1);
  });

  it.each(["anon", "authenticated"])("keeps %s away from the new function and the stats", async (role) => {
    await expect(as(role, "select public.country_devices_add($1, $2)", [["TR"], [1]])).rejects.toThrow(/permission denied/);
    await expect(as(role, "select public.country_visit_stats()")).rejects.toThrow(/permission denied/);
  });
});
