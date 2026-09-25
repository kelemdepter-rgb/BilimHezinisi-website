import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_POLICY,
  createAttempts,
  deriveAttemptKeys,
  type AttemptScope,
  type AttemptStore,
} from "@/lib/auth/attempts";
import { LOCKED_MESSAGE } from "@/lib/auth/messages";
import { SIGN_IN_RULE, SIGN_UP_RULE, isRateLimited, resetRateLimits } from "@/lib/rate-limit";

/**
 * «Three chances, then an hour's lock» (PROMPT-38 B2), as lib/auth/attempts.ts
 * applies it. The store is PGlite running the real migration 0026 — not the
 * production database, and not a hand-written imitation of the SQL either —
 * with "an hour later" made by moving the rows back in time.
 */

const SECRET = "unit-test-secret";
let db: PGlite;

function pgliteStore(): AttemptStore {
  return {
    async lockedUntil(keys) {
      const { rows } = await db.query<{ until: Date | null }>(
        "select public.auth_attempt_status($1, $2) as until",
        [keys, ATTEMPT_POLICY.windowSeconds],
      );
      return rows[0].until;
    },
    async recordFailure(key, scope, limit) {
      const { rows } = await db.query<{ until: Date | null }>(
        "select public.auth_attempt_fail($1, $2, $3, $4, $5) as until",
        [key, scope, limit, ATTEMPT_POLICY.windowSeconds, ATTEMPT_POLICY.lockSeconds],
      );
      return rows[0].until;
    },
    async clear(keys) {
      await db.query("select public.auth_attempt_clear($1)", [keys]);
    },
  };
}

function person(scope: AttemptScope, ip: string, device: string) {
  return createAttempts(pgliteStore(), deriveAttemptKeys(scope, ip, device, SECRET));
}

/** Everything in the counter happened `seconds` earlier. */
async function later(seconds: number) {
  await db.query(
    `update public.auth_attempts
        set window_started_at = window_started_at - make_interval(secs => $1),
            locked_until = locked_until - make_interval(secs => $1),
            updated_at = updated_at - make_interval(secs => $1)`,
    [seconds],
  );
}

beforeAll(async () => {
  db = await new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(readFileSync(join(process.cwd(), "supabase", "migrations", "0026_auth_attempts.sql"), "utf8"));
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from public.auth_attempts");
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

describe("three chances", () => {
  it("the third failure locks, and says so in the owner's words", async () => {
    const reader = person("login", "203.0.113.7", "device-a");
    expect(await reader.fail()).toBe(false);
    expect(await reader.fail()).toBe(false);
    expect(await reader.locked()).toBe(false);
    expect(await reader.fail(), "the third failure is the one that locks").toBe(true);
    expect(await reader.locked()).toBe(true);
    expect(LOCKED_MESSAGE).toBe("email نى كىرگۈزۈش چېكى توشۇپ قالدى. بىر سائەتتىن كېيىن قايتا سىناڭ.");
  });

  it("the lock lifts after an hour, with three fresh chances", async () => {
    const reader = person("register", "203.0.113.7", "device-a");
    for (let i = 0; i < 3; i += 1) await reader.fail();
    await later(ATTEMPT_POLICY.lockSeconds - 60);
    expect(await reader.locked(), "59 minutes on, still locked").toBe(true);
    await later(61);
    expect(await reader.locked(), "an hour on, open again").toBe(false);
    expect(await reader.fail()).toBe(false);
    expect(await reader.fail()).toBe(false);
    expect(await reader.fail()).toBe(true);
  });

  it("two devices on one address each get their own three", async () => {
    const first = person("login", "198.51.100.20", "phone-1");
    const second = person("login", "198.51.100.20", "phone-2");
    for (let i = 0; i < 3; i += 1) await first.fail();
    expect(await first.locked()).toBe(true);
    expect(await second.locked(), "a stranger behind the same NAT is untouched").toBe(false);
    expect(await second.fail()).toBe(false);
    expect(await second.fail()).toBe(false);
    expect(await second.fail()).toBe(true);
  });

  it("the address-wide backstop stops a script that throws its cookie away", async () => {
    for (let device = 1; device <= ATTEMPT_POLICY.networkLimit; device += 1) {
      const locked = await person("login", "192.0.2.50", `throwaway-${device}`).fail();
      expect(locked, `failure ${device}`).toBe(device === ATTEMPT_POLICY.networkLimit);
    }
    expect(await person("login", "192.0.2.50", "brand-new-device").locked()).toBe(true);
    expect(await person("login", "192.0.2.51", "brand-new-device").locked(), "another address").toBe(false);
  });

  it("the two forms keep separate counts", async () => {
    const onLogin = person("login", "203.0.113.9", "device");
    for (let i = 0; i < 3; i += 1) await onLogin.fail();
    expect(await person("register", "203.0.113.9", "device").locked()).toBe(false);
  });

  it("a success clears that person's count, and only theirs", async () => {
    const reader = person("login", "203.0.113.10", "device");
    await reader.fail();
    await reader.fail();
    await reader.clear();
    expect(await reader.fail()).toBe(false);
    expect(await reader.fail()).toBe(false);
    const { rows } = await db.query<{ failures: number }>(
      "select failures from public.auth_attempts order by failures desc",
    );
    // The address-wide row still remembers all four failures.
    expect(rows.map((row) => row.failures)).toEqual([4, 2]);
  });

  it("a password change clears both forms for that person", async () => {
    const login = person("login", "203.0.113.11", "device");
    const register = person("register", "203.0.113.11", "device");
    for (let i = 0; i < 3; i += 1) {
      await login.fail();
      await register.fail();
    }
    // What updatePasswordAction does, through the same objects it builds.
    await Promise.all([login.clear(), register.clear()]);
    expect(await login.locked()).toBe(false);
    expect(await register.locked()).toBe(false);
  });
});

describe("keys", () => {
  it("are digests: nothing readable of the address or the device goes in", () => {
    const keys = deriveAttemptKeys("login", "203.0.113.7", "Zm9vYmFyYmF6cXV4MTIzNDU2", SECRET);
    for (const key of [keys.person, keys.network]) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("203");
    }
  });

  it("differ by form, by device and by address", () => {
    const base = deriveAttemptKeys("login", "1.1.1.1", "device", SECRET);
    expect(deriveAttemptKeys("register", "1.1.1.1", "device", SECRET).person).not.toBe(base.person);
    expect(deriveAttemptKeys("login", "1.1.1.1", "other", SECRET).person).not.toBe(base.person);
    expect(deriveAttemptKeys("login", "1.1.1.1", "other", SECRET).network).toBe(base.network);
    expect(deriveAttemptKeys("login", "2.2.2.2", "device", SECRET).network).not.toBe(base.network);
    expect(deriveAttemptKeys("login", "1.1.1.1", "device", "another secret").person).not.toBe(base.person);
  });
});

describe("failing open", () => {
  it("lets every attempt through when the counter cannot be reached, and logs it once", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const down: AttemptStore = {
      lockedUntil: () => Promise.reject(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })),
      recordFailure: () => Promise.reject(new Error("fetch failed")),
      clear: () => Promise.reject(new Error("fetch failed")),
    };
    const reader = createAttempts(down, deriveAttemptKeys("login", "203.0.113.12", "device", SECRET));
    for (let i = 0; i < 5; i += 1) {
      expect(await reader.locked()).toBe(false);
      expect(await reader.fail()).toBe(false);
    }
    await expect(reader.clear()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[auth] attempt counter unreachable");
  });

  it("with no store at all — the service key missing — nobody is ever locked", async () => {
    const reader = createAttempts(null, null);
    for (let i = 0; i < 5; i += 1) await reader.fail();
    expect(await reader.locked()).toBe(false);
  });
});

describe("the in-process burst brake never trips first", () => {
  it("sign-in allows three failures and the attempts that show the lock", () => {
    expect(SIGN_IN_RULE.limit).toBeGreaterThan(ATTEMPT_POLICY.personLimit);
    for (let i = 0; i < ATTEMPT_POLICY.personLimit + 1; i += 1) {
      expect(isRateLimited("signin:203.0.113.1", SIGN_IN_RULE)).toBe(false);
    }
  });

  it("sign-up allows a success, a no-JavaScript suggestion and three failures", () => {
    expect(SIGN_UP_RULE.limit).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 1 + 1 + ATTEMPT_POLICY.personLimit; i += 1) {
      expect(isRateLimited("signup:203.0.113.1", SIGN_UP_RULE)).toBe(false);
    }
  });
});
