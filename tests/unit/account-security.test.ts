import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installAccountSchema } from "../fixtures/pglite-auth";

/**
 * The site's side of the account rules (lib/auth/account-security.ts): the
 * pause read, the /admin card's report and the daily sweep of accounts never
 * confirmed (PROMPT-39 D–F).
 *
 * The service-role client here is a fake that answers from PGlite running
 * migration 0027, so the sweep deletes exactly what the real SQL picks — and,
 * above all, nothing at all until the owner has switched it on.
 */

const state = vi.hoisted(() => ({ admin: null as unknown, anon: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => state.admin }));
vi.mock("@/lib/cache", () => ({ cachedClient: () => state.anon }));

import {
  REGISTRATION_PAUSED_KEY,
  SWEEP_CAP,
  SWEEP_ENABLED_KEY,
  getAccountSecurityReport,
  isRegistrationPaused,
  sweepUnconfirmedAccounts,
  writeSwitch,
} from "@/lib/auth/account-security";

const ADMIN_EMAIL = "owner@example.com";

let db: PGlite;
let failDeletes: Set<string>;
let logged: string[];

/** The corner of supabase-js the module uses, answered from PGlite as the service role. */
function serviceClient() {
  return {
    from(table: string) {
      if (table !== "settings") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_column: string, key: string) => ({
            maybeSingle: async () => {
              const { rows } = await db.query("select value from public.settings where key = $1", [key]);
              return { data: rows[0] ?? null, error: null };
            },
          }),
          in: async (_column: string, keys: string[]) => {
            const { rows } = await db.query("select key, value from public.settings where key = any($1)", [keys]);
            return { data: rows, error: null };
          },
        }),
        upsert: async (row: { key: string; value: unknown; is_public: boolean }) => {
          await db.query(
            `insert into public.settings (key, value, is_public) values ($1, $2::jsonb, $3)
             on conflict (key) do update set value = excluded.value, is_public = excluded.is_public`,
            [row.key, JSON.stringify(row.value), row.is_public],
          );
          return { error: null };
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      try {
        const rows = await db.transaction(async (tx) => {
          await tx.exec("set local role service_role");
          const call = `public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(", ")})`;
          return (await tx.query<{ result: unknown }>(`select result from ${call} as result`, names.map((name) => args[name]))).rows;
        });
        // PostgREST answers a set-returning function with an array, a scalar one with its value.
        return { data: fn === "unconfirmed_accounts_to_sweep" ? rows.map((row) => row.result) : rows[0]?.result, error: null };
      } catch (error) {
        return { data: null, error: { code: "42883", message: String(error) } };
      }
    },
    auth: {
      admin: {
        async deleteUser(id: string) {
          if (failDeletes.has(id)) return { data: null, error: { message: "Database error deleting user" } };
          await db.query("delete from auth.users where id = $1", [id]);
          return { data: { user: null }, error: null };
        },
      },
    },
  };
}

/** An account in auth.users with its profile, as Supabase's trigger would make it. */
async function account(
  email: string,
  { ageDays = 0, confirmed = false, role = "reader" }: { ageDays?: number; confirmed?: boolean; role?: string } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, created_at, email_confirmed_at)
     values ($1, now() - make_interval(days => $2), case when $3 then now() end)
     returning id`,
    [email, ageDays, confirmed],
  );
  await db.query("insert into public.profiles (id, role) values ($1, $2)", [rows[0].id, role]);
  return rows[0].id;
}

async function emails(): Promise<string[]> {
  const { rows } = await db.query<{ email: string }>("select email from auth.users order by email");
  return rows.map((row) => row.email);
}

async function setting(key: string): Promise<{ value: unknown; is_public: boolean } | undefined> {
  const { rows } = await db.query<{ value: unknown; is_public: boolean }>(
    "select value, is_public from public.settings where key = $1",
    [key],
  );
  return rows[0];
}

beforeAll(async () => {
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  db = await new PGlite();
  await installAccountSchema(db);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(
    "delete from auth.users; delete from public.settings where key like 'unconfirmed_sweep%'; update public.settings set value = 'false' where key = 'registration_paused';",
  );
  state.admin = serviceClient();
  state.anon = serviceClient();
  failDeletes = new Set();
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void logged.push(parts.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => void logged.push(parts.join(" ")));
});

describe("the daily sweep of accounts never confirmed", () => {
  it("does nothing at all until the owner switches it on", async () => {
    await account("stale@gmail.com", { ageDays: 30 });
    expect(await sweepUnconfirmedAccounts()).toBeNull();
    expect(await emails()).toEqual(["stale@gmail.com"]);
    expect(await setting("unconfirmed_sweep_last")).toBeUndefined();
    expect(logged).toEqual([]);
  });

  it("switched on, deletes only stale unconfirmed readers — never the admin, an uploader or a confirmed reader", async () => {
    await account("stale-1@gmail.com", { ageDays: 8 });
    await account("stale-2@yahoo.com", { ageDays: 40 });
    await account("fresh@gmail.com", { ageDays: 6 });
    await account("confirmed@gmail.com", { ageDays: 90, confirmed: true });
    await account("uploader@gmail.com", { ageDays: 90, role: "uploader" });
    await account("admin-by-role@gmail.com", { ageDays: 90, role: "admin" });
    await account(ADMIN_EMAIL, { ageDays: 90 });

    await writeSwitch(SWEEP_ENABLED_KEY, true);
    expect(await sweepUnconfirmedAccounts()).toBe(2);

    expect(await emails()).toEqual([
      "admin-by-role@gmail.com",
      "confirmed@gmail.com",
      "fresh@gmail.com",
      ADMIN_EMAIL,
      "uploader@gmail.com",
    ]);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.profiles");
    expect(rows[0].n, "the deleted accounts' profiles went with them").toBe(5);
    expect((await setting("unconfirmed_sweep_last"))?.value).toMatchObject({ deleted: 2 });
  });

  it("logs the count and nothing else", async () => {
    await account("stale@gmail.com", { ageDays: 8 });
    await writeSwitch(SWEEP_ENABLED_KEY, true);
    await sweepUnconfirmedAccounts();
    expect(logged).toEqual(["[auth] unconfirmed sweep deleted 1 account(s)"]);
  });

  it("does not count a deletion that failed, and takes it the next day", async () => {
    const stuck = await account("stuck@gmail.com", { ageDays: 8 });
    await account("stale@gmail.com", { ageDays: 8 });
    await writeSwitch(SWEEP_ENABLED_KEY, true);

    failDeletes.add(stuck);
    expect(await sweepUnconfirmedAccounts()).toBe(1);
    expect(await emails()).toEqual(["stuck@gmail.com"]);

    failDeletes.clear();
    expect(await sweepUnconfirmedAccounts()).toBe(1);
    expect(await emails()).toEqual([]);
  });

  it(`stops at ${SWEEP_CAP} a day and leaves the rest for tomorrow`, async () => {
    await db.query(
      `insert into auth.users (email, created_at)
       select 'stale-' || n || '@gmail.com', now() - interval '10 days' from generate_series(1, $1::int) as n`,
      [SWEEP_CAP + 3],
    );
    await writeSwitch(SWEEP_ENABLED_KEY, true);
    expect(await sweepUnconfirmedAccounts()).toBe(SWEEP_CAP);
    expect(await sweepUnconfirmedAccounts()).toBe(3);
  });

  it("switched off again, stops", async () => {
    await account("stale@gmail.com", { ageDays: 8 });
    await writeSwitch(SWEEP_ENABLED_KEY, true);
    await writeSwitch(SWEEP_ENABLED_KEY, false);
    expect(await sweepUnconfirmedAccounts()).toBeNull();
    expect(await emails()).toEqual(["stale@gmail.com"]);
  });

  it("gives up quietly, with a code in the log, when the list cannot be read", async () => {
    await writeSwitch(SWEEP_ENABLED_KEY, true);
    await db.exec("alter function public.unconfirmed_accounts_to_sweep(text, integer) rename to gone");
    try {
      expect(await sweepUnconfirmedAccounts()).toBeNull();
      expect(logged).toEqual(["[auth] unconfirmed sweep could not list accounts: code=42883"]);
    } finally {
      await db.exec("alter function public.gone(text, integer) rename to unconfirmed_accounts_to_sweep");
    }
  });
});

describe("the switches", () => {
  it("the pause is a public setting — /register reads it anonymously — and the sweep's is not", async () => {
    await writeSwitch(REGISTRATION_PAUSED_KEY, true);
    await writeSwitch(SWEEP_ENABLED_KEY, true);
    expect(await setting(REGISTRATION_PAUSED_KEY)).toEqual({ value: true, is_public: true });
    expect(await setting(SWEEP_ENABLED_KEY)).toEqual({ value: true, is_public: false });
  });

  it("the pause is read afresh on every request", async () => {
    expect(await isRegistrationPaused()).toBe(false);
    await writeSwitch(REGISTRATION_PAUSED_KEY, true);
    expect(await isRegistrationPaused()).toBe(true);
    await writeSwitch(REGISTRATION_PAUSED_KEY, false);
    expect(await isRegistrationPaused()).toBe(false);
  });

  it("an unreadable pause leaves the form open — the hook still refuses while it is on", async () => {
    state.anon = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "offline" } }) }) }),
      }),
    };
    expect(await isRegistrationPaused()).toBe(false);
    state.anon = null;
    expect(await isRegistrationPaused()).toBe(false);
  });
});

describe("the /admin card's report", () => {
  it("counts new accounts, the brake, the unconfirmed and what the sweep would take", async () => {
    await account("new-1@gmail.com");
    await account("new-2@gmail.com", { confirmed: true });
    await account("stale@gmail.com", { ageDays: 9 });
    await account(ADMIN_EMAIL, { ageDays: 9 });

    const report = await getAccountSecurityReport();
    expect(report).toEqual({
      available: true,
      registrationPaused: false,
      brakeEngaged: false,
      brakeCount: 1,
      brakeLimit: 30,
      newLastHour: 2,
      newLastDay: 2,
      activeLocks: 0,
      unconfirmed: 3,
      sweepable: 1,
      sweepEnabled: false,
      lastSweep: null,
      listsInSync: true,
    });
  });

  it("shows the brake engaged at 30 unconfirmed accounts in the hour, and the pause and last sweep", async () => {
    await db.query(
      `insert into auth.users (email, created_at)
       select 'burst-' || n || '@gmail.com', now() - interval '5 minutes' from generate_series(1, 30) as n`,
    );
    await writeSwitch(REGISTRATION_PAUSED_KEY, true);
    await writeSwitch(SWEEP_ENABLED_KEY, true);
    await sweepUnconfirmedAccounts();

    const report = await getAccountSecurityReport();
    expect(report).toMatchObject({
      available: true,
      registrationPaused: true,
      brakeEngaged: true,
      brakeCount: 30,
      sweepEnabled: true,
      lastSweep: { deleted: 0 },
    });
  });

  it("notices when the database's lists differ from the site's", async () => {
    await db.exec("delete from public.auth_disposable_domains where domain = 'mailinator.com'");
    try {
      expect(await getAccountSecurityReport()).toMatchObject({ available: true, listsInSync: false });
    } finally {
      await db.exec("insert into public.auth_disposable_domains (domain) values ('mailinator.com')");
    }
  });

  it("is unavailable before migration 0027, or without the service role", async () => {
    await db.exec("alter function public.account_security_stats(text) rename to gone_stats");
    try {
      expect(await getAccountSecurityReport()).toEqual({ available: false });
    } finally {
      await db.exec("alter function public.gone_stats(text) rename to account_security_stats");
    }
    state.admin = null;
    expect(await getAccountSecurityReport()).toEqual({ available: false });
  });
});
