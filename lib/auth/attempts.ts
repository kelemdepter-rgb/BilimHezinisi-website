import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { callerKey } from "@/lib/rate-limit";

/**
 * Three chances, then an hour's lock, on /login and /register — the owner's
 * rule (PROMPT-38), counted in Postgres (migration 0026) so that it holds
 * across every Vercel instance at once.
 *
 * WHO "A PERSON" IS. The caller's IP address together with a random device
 * cookie. Many readers of this library share one address behind a mobile
 * carrier's NAT; keyed on the address alone they would use up each other's
 * chances. Keyed on the device alone, a script would simply drop the cookie.
 * So both, plus a backstop on the address alone at ten failures an hour —
 * which a crowd behind one NAT could in principle reach together; that is the
 * price of stopping the script, and it only ever closes these two forms,
 * never reading.
 *
 * NEVER BY EMAIL ADDRESS. Otherwise anyone could lock a stranger out of their
 * own account by typing the stranger's address three times.
 *
 * FAILING OPEN. When the counter cannot be reached the attempt goes ahead and
 * the outage is logged once: a database hiccup must never lock anyone out.
 * lib/rate-limit.ts still stands in front of every action as the
 * per-instance burst brake, and is set so that it can never trip first.
 *
 * Password recovery (/forgot-password, /reset-password) is never counted and
 * never locked — a reader locked out of /login can reset their password and
 * be signed in within the same hour.
 */

export type AttemptScope = "login" | "register";

export const ATTEMPT_POLICY = {
  /** Failed attempts a person gets on one form within the window. */
  personLimit: 3,
  /** Failed attempts one IP address gets on one form, all its devices together. */
  networkLimit: 10,
  /** The window opens at the first failure and lasts an hour. */
  windowSeconds: 60 * 60,
  /** The failure that reaches a limit locks the form for an hour from then. */
  lockSeconds: 60 * 60,
} as const;

/** The two hashed keys one submission is counted under. */
export type AttemptKeys = { scope: AttemptScope; person: string; network: string };

/** Where the counts live. Supabase in production; PGlite or a fake in tests. */
export interface AttemptStore {
  /** The latest moment any of these keys is locked until, or null. */
  lockedUntil(keys: string[]): Promise<Date | null>;
  /** Count one failure; the lock's end when the key is now locked, or null. */
  recordFailure(key: string, scope: AttemptScope, limit: number): Promise<Date | null>;
  clear(keys: string[]): Promise<void>;
}

/** What an action does with the counter for one form. */
export type Attempts = {
  /** Whether this person (or their address) is locked out of this form. */
  locked(): Promise<boolean>;
  /** Count a failed attempt; true when this very failure locked them. */
  fail(): Promise<boolean>;
  /** Forget this person's failures on this form. */
  clear(): Promise<void>;
};

/**
 * HMAC-SHA-256 over the scope and the caller's details. What reaches the
 * database is the digest: no IP address or cookie value can be read back out
 * of it. The IP and device id are joined with a separator neither contains.
 */
export function deriveAttemptKeys(
  scope: AttemptScope,
  ip: string,
  deviceId: string,
  secret: string,
): AttemptKeys {
  const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  return {
    scope,
    person: digest(`person\n${scope}\n${ip}\n${deviceId}`),
    network: digest(`network\n${scope}\n${ip}`),
  };
}

let reportedTrouble = false;

/** One log line per outage, not one per request. */
function troubled(error: unknown): void {
  if (reportedTrouble) return;
  reportedTrouble = true;
  const detail =
    error && typeof error === "object"
      ? `code=${String((error as { code?: unknown }).code ?? "?")} ${String(
          (error as { message?: unknown }).message ?? "",
        ).slice(0, 200)}`
      : String(error).slice(0, 200);
  console.error(`[auth] attempt counter unreachable — allowing attempts until it answers: ${detail}`);
}

function recovered(): void {
  reportedTrouble = false;
}

/** The counter for one form and one person, failing open throughout. */
export function createAttempts(store: AttemptStore | null, keys: AttemptKeys | null): Attempts {
  if (!store || !keys) {
    return { locked: async () => false, fail: async () => false, clear: async () => {} };
  }
  return {
    async locked() {
      try {
        const until = await store.lockedUntil([keys.person, keys.network]);
        recovered();
        return until !== null;
      } catch (error) {
        troubled(error);
        return false;
      }
    },
    async fail() {
      try {
        const [person, network] = await Promise.all([
          store.recordFailure(keys.person, keys.scope, ATTEMPT_POLICY.personLimit),
          store.recordFailure(keys.network, keys.scope, ATTEMPT_POLICY.networkLimit),
        ]);
        recovered();
        return person !== null || network !== null;
      } catch (error) {
        troubled(error);
        return false;
      }
    },
    async clear() {
      try {
        // The person's own count only: one reader proving who they are says
        // nothing about everyone else behind the same address.
        await store.clear([keys.person]);
        recovered();
      } catch (error) {
        troubled(error);
      }
    },
  };
}

/** The counter in Postgres, through the service-role client. */
export function supabaseAttemptStore(): AttemptStore | null {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const at = (value: unknown) => (typeof value === "string" ? new Date(value) : null);
  return {
    async lockedUntil(keys) {
      const { data, error } = await admin.rpc("auth_attempt_status", {
        p_keys: keys,
        p_window_seconds: ATTEMPT_POLICY.windowSeconds,
      });
      if (error) throw error;
      return at(data);
    },
    async recordFailure(key, scope, limit) {
      const { data, error } = await admin.rpc("auth_attempt_fail", {
        p_key: key,
        p_scope: scope,
        p_limit: limit,
        p_window_seconds: ATTEMPT_POLICY.windowSeconds,
        p_lock_seconds: ATTEMPT_POLICY.lockSeconds,
      });
      if (error) throw error;
      return at(data);
    },
    async clear(keys) {
      const { error } = await admin.rpc("auth_attempt_clear", { p_keys: keys });
      if (error) throw error;
    },
  };
}

/** Remove rows a day past their window and lock — run by the daily cron. */
export async function sweepAttempts(): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("auth_attempt_sweep", {
    p_window_seconds: ATTEMPT_POLICY.windowSeconds,
  });
  if (error) {
    troubled(error);
    return null;
  }
  return typeof data === "number" ? data : null;
}

/**
 * The HMAC key, derived from the one server-only secret the site already has
 * — so there is no new environment variable to set, leak or forget. Rotating
 * the service-role key simply starts every count afresh.
 */
function attemptSecret(): string | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createHmac("sha256", serviceKey).update("bh-auth-attempts/v1").digest("hex");
}

/** The device cookie: random, httpOnly, a year long, and nothing but an id. */
export const DEVICE_COOKIE = "bh_dev";
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * This browser's id, issued on first use. Only callable from a Server Action,
 * which is the only place the counters are consulted.
 */
async function deviceId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value;
  if (existing && DEVICE_ID.test(existing)) return existing;
  const issued = randomBytes(16).toString("base64url");
  store.set(DEVICE_COOKIE, issued, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return issued;
}

/** The counter for whoever is submitting this form, right now. */
export async function attemptsFor(
  scope: AttemptScope,
  store: AttemptStore | null = supabaseAttemptStore(),
): Promise<Attempts> {
  const secret = attemptSecret();
  if (!store || !secret) return createAttempts(null, null);
  const keys = deriveAttemptKeys(scope, await callerKey(), await deviceId(), secret);
  return createAttempts(store, keys);
}
