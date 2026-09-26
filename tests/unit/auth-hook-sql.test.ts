import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hookEvent, installAccountSchema } from "../fixtures/pglite-auth";

/**
 * The Before User Created hook, the automatic brake and the admin card's SQL
 * (migration 0027), run in PGlite against the migration file itself and the
 * generated domain seed — never against the production database.
 */

let db: PGlite;

type HookAnswer = { error?: { http_code: number; message: string } };

/** Call the hook the way Supabase Auth does: as supabase_auth_admin. */
async function hook(email: string): Promise<HookAnswer> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role supabase_auth_admin");
    const { rows } = await tx.query<{ out: HookAnswer }>(
      "select public.hook_before_user_created($1::jsonb) as out",
      [hookEvent(email)],
    );
    return rows[0].out;
  });
}

async function as<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** An account in auth.users (and its profile, as Supabase's trigger would make). */
async function account(
  email: string,
  { ageMinutes = 0, confirmed = false, role = "reader" }: { ageMinutes?: number; confirmed?: boolean; role?: string } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, created_at, email_confirmed_at)
     values ($1, now() - make_interval(mins => $2), case when $3 then now() end)
     returning id`,
    [email, ageMinutes, confirmed],
  );
  await db.query("insert into public.profiles (id, role) values ($1, $2)", [rows[0].id, role]);
  return rows[0].id;
}

async function setting(key: string, value: unknown) {
  await db.query(
    `insert into public.settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

beforeAll(async () => {
  db = await new PGlite();
  await installAccountSchema(db);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from auth.users; delete from public.auth_attempts;");
  await setting("registration_paused", false);
  await setting("admin_email", "");
});

describe("the hook", () => {
  it("lets an ordinary address through with an empty object", async () => {
    for (const email of [
      "reader@gmail.com",
      "reader@outlook.com",
      "t@school.edu.tw",
      "someone@my-own-family-domain.org",
    ]) {
      expect(await hook(email), email).toEqual({});
    }
  });

  it("refuses an address under Chinese jurisdiction, in the documented error shape", async () => {
    expect(await hook("a@qq.com")).toEqual({ error: { http_code: 400, message: "bh:blocked" } });
    for (const email of ["a@x.com.cn", "a@x.hk", "a@x.mo", "a@vip.qq.com", "a@xn--fsqu00a.xn--fiqs8s"]) {
      expect((await hook(email)).error?.message, email).toBe("bh:blocked");
    }
  });

  it("refuses a disposable address, and any sub-domain of one", async () => {
    expect(await hook("a@guerrillamail.com")).toEqual({ error: { http_code: 400, message: "bh:disposable" } });
    expect((await hook("a@inbox.mailinator.com")).error?.message).toBe("bh:disposable");
    expect((await hook("a@yopmail.com")).error?.message).toBe("bh:disposable");
  });

  it("does not mistake a lookalike for a listed domain", async () => {
    expect(await hook("a@cnn.com")).toEqual({});
    expect(await hook("a@mailinator-books.org")).toEqual({});
    // A listed name under a different parent is a different domain.
    expect(await hook("a@guerrillamail.com.tr")).toEqual({});
    expect(await hook("a@qqq-books.org")).toEqual({});
  });

  it("refuses everything while registration is paused — with the brake's message", async () => {
    await setting("registration_paused", true);
    expect(await hook("reader@gmail.com")).toEqual({
      error: { http_code: 400, message: "bh:registration_paused" },
    });
  });

  it("answers an address with no email at all (a phone or OAuth identity) without judging it", async () => {
    expect(await hook("")).toEqual({});
  });
});

describe("the automatic brake", () => {
  it("engages at exactly 30 unconfirmed accounts in the last hour, not at 29", async () => {
    for (let i = 0; i < 29; i += 1) await account(`bot${i}@gmail.com`, { ageMinutes: 5 });
    expect(await hook("honest@gmail.com"), "29 in the hour").toEqual({});
    await account("bot29@gmail.com", { ageMinutes: 5 });
    expect(await hook("honest@gmail.com"), "30 in the hour").toEqual({
      error: { http_code: 400, message: "bh:registration_paused" },
    });
  });

  it("releases on its own once the hour has passed", async () => {
    for (let i = 0; i < 30; i += 1) await account(`bot${i}@gmail.com`, { ageMinutes: 61 });
    expect(await hook("honest@gmail.com")).toEqual({});
  });

  it("never counts confirmed accounts — the test suite's, made through the admin API", async () => {
    for (let i = 0; i < 40; i += 1) {
      await account(`bh-e2e-${i}@example.com`, { ageMinutes: 1, confirmed: true });
    }
    expect(await hook("honest@gmail.com")).toEqual({});
  });

  it("never writes the paused switch — the brake is computed, the switch is manual", async () => {
    for (let i = 0; i < 30; i += 1) await account(`bot${i}@gmail.com`);
    await hook("honest@gmail.com");
    const { rows } = await db.query<{ value: boolean }>(
      "select value from public.settings where key = 'registration_paused'",
    );
    expect(rows[0].value).toBe(false);
  });
});

describe("who may run what", () => {
  it("only supabase_auth_admin can execute the hook", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await expect(
        as(role, "select public.hook_before_user_created($1::jsonb)", [hookEvent("a@gmail.com")]),
        role,
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      as("supabase_auth_admin", "select public.hook_before_user_created($1::jsonb)", [hookEvent("a@gmail.com")]),
    ).resolves.toBeDefined();
  });

  it("nobody but the server reads the lists or calls the card's and the sweep's functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const sql of [
        "select * from public.auth_blocked_domains",
        "select * from public.auth_disposable_domains",
        "select public.account_security_stats(null)",
        "select * from public.unconfirmed_accounts_to_sweep(null, 10)",
        "select public.auth_domains_replace(array['a','b','c','d','e'], array['x'])",
      ]) {
        await expect(as(role, sql), `${role}: ${sql}`).rejects.toMatchObject({ code: "42501" });
      }
    }
    await expect(as("service_role", "select public.account_security_stats(null)")).resolves.toBeDefined();
  });

  it("refuses to replace the lists with a nearly empty one", async () => {
    await expect(
      db.query("select public.auth_domains_replace(array['cn'], array['mailinator.com'])"),
    ).rejects.toThrow(/nearly empty/);
    // …and the lists are still there.
    expect((await hook("a@guerrillamail.com")).error?.message).toBe("bh:disposable");
  });
});

describe("the unconfirmed-account sweep", () => {
  async function candidates(adminEmail: string | null = null, limit = 200): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.unconfirmed_accounts_to_sweep($1, $2) as id",
      [adminEmail, limit],
    );
    return rows.map((row) => row.id);
  }

  it("picks only unconfirmed readers more than 7 days old", async () => {
    const stale = await account("stale@gmail.com", { ageMinutes: 8 * 24 * 60 });
    await account("young@gmail.com", { ageMinutes: 6 * 24 * 60 });
    await account("confirmed@gmail.com", { ageMinutes: 30 * 24 * 60, confirmed: true });
    await account("uploader@gmail.com", { ageMinutes: 30 * 24 * 60, role: "uploader" });
    await account("admin@gmail.com", { ageMinutes: 30 * 24 * 60, role: "admin" });
    expect(await candidates()).toEqual([stale]);
  });

  it("never the admin's address, whether passed in or mirrored into settings", async () => {
    await account("Owner@Gmail.com", { ageMinutes: 30 * 24 * 60 });
    await account("mirror@gmail.com", { ageMinutes: 30 * 24 * 60 });
    await setting("admin_email", "mirror@gmail.com");
    expect(await candidates("owner@gmail.com")).toEqual([]);
  });

  it("respects the cap it is given", async () => {
    for (let i = 0; i < 5; i += 1) await account(`old${i}@gmail.com`, { ageMinutes: 9 * 24 * 60 + i });
    expect(await candidates(null, 3)).toHaveLength(3);
  });
});

describe("the admin card's numbers", () => {
  it("counts new accounts, the brake, locks and the lists", async () => {
    await account("new1@gmail.com", { ageMinutes: 10 });
    await account("new2@gmail.com", { ageMinutes: 10, confirmed: true });
    await account("day@gmail.com", { ageMinutes: 5 * 60 });
    await account("stale@gmail.com", { ageMinutes: 8 * 24 * 60 });
    await db.query(
      `insert into public.auth_attempts (key_hash, scope, failures, locked_until)
       values (decode(repeat('ab', 32), 'hex'), 'login', 3, now() + interval '30 minutes')`,
    );
    const [stats] = await as<{ s: Record<string, number> }>(
      "service_role",
      "select public.account_security_stats(null) as s",
    );
    expect(stats.s).toMatchObject({
      new_last_hour: 2,
      new_last_day: 3,
      brake_count: 1,
      brake_limit: 30,
      unconfirmed: 3,
      sweepable: 1,
      active_locks: 1,
      blocked_domains: 29,
    });
    expect(stats.s.disposable_domains).toBeGreaterThan(1000);
  });
});
