import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth Server Actions themselves (app/(auth)/actions.ts), with Next's
 * request APIs, Supabase and DNS replaced — and the attempt counter running
 * the real migration 0026 in PGlite. What this pins down is ORDER and
 * CONSEQUENCE (PROMPT-38 B4): a locked person is answered before any lookup
 * or Supabase call, nothing before the Supabase call spends an email, only
 * the listed outcomes count as failed attempts, password recovery is never
 * locked, and nothing private reaches a log line.
 */

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  ip: "203.0.113.1",
  dnsLookups: [] as string[],
  mx: new Map<string, unknown>(),
  supabase: null as unknown,
  admin: null as unknown,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { redirectTo: url });
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined),
    set: (name: string, value: string) => void state.cookies.set(name, value),
    delete: (name: string) => void state.cookies.delete(name),
    has: (name: string) => state.cookies.has(name),
    getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })),
  }),
  headers: async () => new Headers({ "x-forwarded-for": state.ip }),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => state.supabase }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => state.admin }));

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolveMx(domain: string) {
      state.dnsLookups.push(domain);
      const answer = state.mx.get(domain) ?? [{ exchange: "mx.example.net", priority: 1 }];
      return typeof answer === "string"
        ? Promise.reject(Object.assign(new Error(answer), { code: answer }))
        : Promise.resolve(answer);
    }
    resolve4() {
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    }
    resolve6() {
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    }
    cancel() {}
  },
}));

import {
  acceptSuggestionAction,
  keepSuggestionAction,
  requestPasswordResetAction,
  resendConfirmationAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from "@/app/(auth)/actions";
import { decodeFlash } from "@/lib/auth/flash";
import { resetRateLimits } from "@/lib/rate-limit";

/** Drawn per run: no password is ever written into the repository, not even a fake one. */
const PASSWORD = randomBytes(12).toString("base64url");
const NEW_PASSWORD = randomBytes(12).toString("base64url");

type AuthResult = { data: Record<string, unknown>; error: Record<string, unknown> | null };

let db: PGlite;
let auth: Record<string, ReturnType<typeof vi.fn>>;
let logged: string[];

function ok(data: Record<string, unknown> = {}): AuthResult {
  return { data, error: null };
}
function refused(code: string, message = code, status = 400): AuthResult {
  return { data: { user: null, session: null }, error: { code, message, status } };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Run an action to its redirect and return where it went. */
async function run(action: (data: FormData) => Promise<unknown>, fields: Record<string, string>) {
  try {
    await action(form(fields));
  } catch (error) {
    const to = (error as { redirectTo?: string }).redirectTo;
    if (to) return to;
    throw error;
  }
  throw new Error("the action returned without redirecting");
}

const register = (email: string, extra: Record<string, string> = {}) =>
  run(signUpAction, { email, password: PASSWORD, display_name: "سىناق", ...extra });
const signIn = (email: string) => run(signInAction, { email, password: PASSWORD });

async function counterRows(): Promise<number> {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.auth_attempts");
  return rows[0].n;
}

beforeAll(async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-key";
  db = await new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(readFileSync(join(process.cwd(), "supabase", "migrations", "0026_auth_attempts.sql"), "utf8"));
  state.admin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      try {
        const { rows } = await db.query<{ result: unknown }>(
          `select public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(", ")}) as result`,
          names.map((name) => args[name]),
        );
        const value = rows[0]?.result ?? null;
        return { data: value instanceof Date ? value.toISOString() : value, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from public.auth_attempts");
  resetRateLimits();
  state.cookies.clear();
  state.dnsLookups.length = 0;
  state.mx.clear();
  state.ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  auth = {
    signUp: vi.fn(async () => ok({ user: { id: "new-user" }, session: null })),
    signInWithPassword: vi.fn(async () => refused("invalid_credentials", "Invalid login credentials")),
    resetPasswordForEmail: vi.fn(async () => ok()),
    resend: vi.fn(async () => ok()),
    getUser: vi.fn(async () => ok({ user: { id: "u1", email: "reader@gmail.com" } })),
    updateUser: vi.fn(async () => ok({ user: { id: "u1" } })),
  };
  state.supabase = { auth };
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => void logged.push(parts.join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => void logged.push(parts.join(" ")));
});

describe("registration, in order", () => {
  it("empty fields and a short password are answered first and never counted", async () => {
    expect(await register("")).toBe("/register?xata=empty");
    expect(await run(signUpAction, { email: "a@gmail.com", password: PASSWORD.slice(0, 3) })).toBe("/register?xata=short");
    expect(await counterRows()).toBe(0);
  });

  it("broken, blocked and undeliverable addresses are failed attempts that send nothing", async () => {
    expect(await register("a..b@example.org")).toBe("/register?xata=bad_email");
    expect(await register("a@qq.com")).toBe("/register?xata=blocked");
    state.ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    state.mx.set("no-such-domain.org", "ENOTFOUND");
    expect(await register("a@no-such-domain.org")).toBe("/register?xata=bad_email");
    state.mx.set("innocent.org", [{ exchange: "mxbiz1.qq.com", priority: 5 }]);
    expect(await register("a@innocent.org")).toBe("/register?xata=blocked");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("the third failure answers with the lock, and a fourth reaches no lookup and no Supabase", async () => {
    expect(await register("a@qq.com")).toBe("/register?xata=blocked");
    expect(await register("a@163.com")).toBe("/register?xata=blocked");
    expect(await register("a@x.com.cn")).toBe("/register?xata=locked");

    state.dnsLookups.length = 0;
    expect(await register("fresh@innocent-looking.org")).toBe("/register?xata=locked");
    expect(state.dnsLookups, "no DNS lookup while locked").toEqual([]);
    expect(auth.signUp, "no Supabase call while locked").not.toHaveBeenCalled();
  });

  it("a probable typo stops before anything is sent, keeps what was typed, and is not a failure", async () => {
    expect(await register("name@gmial.com")).toBe("/register");
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(await counterRows()).toBe(0);
    const draft = decodeFlash(state.cookies.get("bh_reg"));
    expect(draft).toEqual({ email: "name@gmial.com", name: "سىناق", suggestion: "gmail.com" });
    expect(JSON.stringify(draft)).not.toContain(PASSWORD);

    // «Keep it» — the typed domain goes to Supabase as typed.
    expect(await register("name@gmial.com", { keep_domain: "gmial.com" })).toBe("/login?uqtur=confirm");
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "name@gmial.com" }));
  });

  it("a typo whose domain cannot receive mail is offered the fix first; kept, it is refused", async () => {
    // gmal.com: no mail exchanger and no address — undeliverable, and one slip from gmail.com.
    state.mx.set("gmal.com", "ENODATA");
    expect(await register("name@gmal.com")).toBe("/register");
    expect(decodeFlash(state.cookies.get("bh_reg"))?.suggestion).toBe("gmail.com");
    expect(await counterRows(), "a suggestion is not a failed attempt").toBe(0);

    expect(await register("name@gmal.com", { keep_domain: "gmal.com" })).toBe("/register?xata=bad_email");
    expect(await counterRows()).toBe(2);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("the no-JavaScript buttons fix or keep the domain without sending anything", async () => {
    expect(
      await run(acceptSuggestionAction, { email: "name@gmial.com", display_name: "سىناق" }),
    ).toBe("/register");
    expect(decodeFlash(state.cookies.get("bh_reg"))).toEqual({ email: "name@gmail.com", name: "سىناق" });

    await run(keepSuggestionAction, { email: "name@gmial.com", display_name: "سىناق" });
    expect(decodeFlash(state.cookies.get("bh_reg"))).toEqual({
      email: "name@gmial.com",
      name: "سىناق",
      kept: "gmial.com",
    });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("Supabase's per-address wait is a wait in seconds, and not a failure", async () => {
    auth.signUp.mockResolvedValueOnce(
      refused(
        "over_email_send_rate_limit",
        "For security purposes, you can only request this after 42 seconds.",
        429,
      ),
    );
    expect(await register("reader@gmail.com")).toBe("/register?xata=wait&s=45");
    expect(await counterRows()).toBe(0);
  });

  it("the project-wide cap is the reader-friendly message and one log line for the owner", async () => {
    auth.signUp.mockResolvedValueOnce(refused("over_email_send_rate_limit", "email rate limit exceeded", 429));
    expect(await register("reader@gmail.com")).toBe("/register?xata=email_limit");
    expect(logged.filter((line) => line.includes("email allowance"))).toHaveLength(1);
  });

  it("an unknown code is `failed` plus a log line", async () => {
    auth.signUp.mockResolvedValueOnce(refused("brand_new_code", "Email address \"reader@gmail.com\" is odd", 422));
    expect(await register("reader@gmail.com")).toBe("/register?xata=failed");
    expect(logged.some((line) => line.includes("brand_new_code"))).toBe(true);
  });

  it("Supabase's own `invalid` and `exists` are failed attempts", async () => {
    auth.signUp.mockResolvedValueOnce(refused("email_address_invalid"));
    auth.signUp.mockResolvedValueOnce(refused("user_already_exists"));
    auth.signUp.mockResolvedValueOnce(refused("email_exists"));
    expect(await register("one@gmail.com")).toBe("/register?xata=bad_email");
    expect(await register("two@gmail.com")).toBe("/register?xata=exists");
    expect(await register("three@gmail.com")).toBe("/register?xata=locked");
  });

  it("a success says where the link went, in a cookie and never in the URL", async () => {
    const to = await register("Reader@Gmail.com");
    expect(to).toBe("/login?uqtur=confirm");
    expect(to).not.toContain("Reader");
    expect(decodeFlash(state.cookies.get("bh_sent"))).toEqual({ email: "Reader@gmail.com", name: "سىناق" });
    expect(state.cookies.has("bh_reg")).toBe(false);
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "Reader@gmail.com" }));
  });

  it("the familiar providers are never looked up", async () => {
    await register("reader@gmail.com");
    await register("reader@outlook.com");
    expect(state.dnsLookups).toEqual([]);
  });
});

describe("signing in", () => {
  it("three wrong passwords lock; the right one is not even tried while locked", async () => {
    expect(await signIn("reader@gmail.com")).toBe("/login?xata=credentials");
    expect(await signIn("reader@gmail.com")).toBe("/login?xata=credentials");
    expect(await signIn("reader@gmail.com")).toBe("/login?xata=locked");
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(3);
    expect(await signIn("reader@gmail.com")).toBe("/login?xata=locked");
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(3);
  });

  it("an unconfirmed address is not a failed attempt", async () => {
    auth.signInWithPassword.mockResolvedValue(refused("email_not_confirmed"));
    for (let i = 0; i < 4; i += 1) expect(await signIn("reader@gmail.com")).toBe("/login?xata=unconfirmed");
    expect(await counterRows()).toBe(0);
  });

  it("a blocked address is refused and counted, without asking Supabase", async () => {
    expect(await signIn("a@sohu.com")).toBe("/login?xata=blocked");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(await counterRows()).toBe(2);
  });

  it("a success clears that person's count", async () => {
    await signIn("reader@gmail.com");
    await signIn("reader@gmail.com");
    auth.signInWithPassword.mockResolvedValueOnce(ok({ user: { id: "u1", email: "reader@gmail.com" } }));
    expect(await signIn("reader@gmail.com")).toBe("/");
    // Two fresh failures now, not a lock.
    expect(await signIn("reader@gmail.com")).toBe("/login?xata=credentials");
    expect(await signIn("reader@gmail.com")).toBe("/login?xata=credentials");
  });

  it("fails open when the counter cannot be reached", async () => {
    const previous = state.admin;
    state.admin = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "function not found" } }) };
    try {
      for (let i = 0; i < 5; i += 1) expect(await signIn("reader@gmail.com")).toBe("/login?xata=credentials");
      expect(auth.signInWithPassword).toHaveBeenCalledTimes(5);
    } finally {
      state.admin = previous;
    }
  });
});

describe("password recovery is never locked", () => {
  it("works for a person locked out of both forms, and unlocks them", async () => {
    for (let i = 0; i < 3; i += 1) await signIn("reader@gmail.com");
    for (const address of ["a@qq.com", "b@qq.com", "c@qq.com"]) await register(address);
    expect(await signIn("reader@gmail.com")).toBe("/login?xata=locked");
    expect(await register("reader@gmail.com")).toBe("/register?xata=locked");

    expect(await run(requestPasswordResetAction, { email: "reader@gmail.com" })).toBe(
      "/forgot-password?uqtur=sent",
    );
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);

    expect(await run(updatePasswordAction, { password: NEW_PASSWORD, confirm: NEW_PASSWORD })).toBe(
      "/my/account?uqtur=password_changed",
    );
    auth.signInWithPassword.mockResolvedValueOnce(ok({ user: { id: "u1", email: "reader@gmail.com" } }));
    expect(await signIn("reader@gmail.com")).toBe("/");
    expect(await register("fresh@gmail.com")).toBe("/login?uqtur=confirm");
  });

  it("answers the same for any address, and tells a blocked one the rule without sending", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    expect(await run(requestPasswordResetAction, { email: "known@gmail.com" })).toBe("/forgot-password?uqtur=sent");
    expect(await run(requestPasswordResetAction, { email: "unknown@gmail.com" })).toBe("/forgot-password?uqtur=sent");
    expect(await run(requestPasswordResetAction, { email: "a@foxmail.com" })).toBe("/forgot-password?xata=blocked");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
    expect(await counterRows()).toBe(0);
  });

  it("answers Supabase's errors without saying whether the address has an account", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce(refused("over_email_send_rate_limit", "email rate limit exceeded", 429));
    expect(await run(requestPasswordResetAction, { email: "a@gmail.com" })).toBe("/forgot-password?xata=email_limit");
    auth.resetPasswordForEmail.mockResolvedValueOnce(refused("email_address_invalid"));
    expect(await run(requestPasswordResetAction, { email: "a@gmail.com" })).toBe("/forgot-password?uqtur=sent");
    // The wait Supabase imposes only on a registered address: the same answer as anyone.
    auth.resetPasswordForEmail.mockResolvedValueOnce(
      refused("over_email_send_rate_limit", "For security purposes, you can only request this after 52 seconds.", 429),
    );
    expect(await run(requestPasswordResetAction, { email: "a@gmail.com" })).toBe("/forgot-password?uqtur=sent");
  });
});

describe("resending the confirmation", () => {
  it("answers the same whatever Supabase says about the address", async () => {
    auth.resend
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(
        refused("over_email_send_rate_limit", "For security purposes, you can only request this after 30 seconds.", 429),
      )
      .mockResolvedValueOnce(refused("over_email_send_rate_limit", "email rate limit exceeded", 429));
    for (const email of ["new@gmail.com", "pending@gmail.com", "other@gmail.com"]) {
      expect(await run(resendConfirmationAction, { email })).toBe("/login?uqtur=resent");
    }
    expect(state.cookies.has("bh_resent")).toBe(true);
    expect(await counterRows(), "a resend is never a failed attempt").toBe(0);
  });

  it("refuses a blocked or broken address, and brakes after three", async () => {
    expect(await run(resendConfirmationAction, { email: "a@126.com" })).toBe("/login?xata=blocked&resend=1");
    expect(await run(resendConfirmationAction, { email: "not-an-address" })).toBe("/login?xata=bad_email&resend=1");
    expect(await run(resendConfirmationAction, { email: "ok@gmail.com" })).toBe("/login?uqtur=resent");
    expect(await run(resendConfirmationAction, { email: "ok@gmail.com" })).toBe("/login?xata=rate_limit&resend=1");
    expect(auth.resend).toHaveBeenCalledTimes(1);
  });
});

describe("the logs", () => {
  it("never hold an address, an IP or a password", async () => {
    auth.signUp.mockResolvedValueOnce(refused("brand_new_code", 'Email address "leaky@gmail.com" is invalid', 422));
    await register("leaky@gmail.com");
    auth.signUp.mockResolvedValueOnce(refused("over_email_send_rate_limit", "email rate limit exceeded", 429));
    await register("leaky@gmail.com");
    auth.resend.mockResolvedValueOnce(refused("email_address_not_authorized", "Email address not authorized", 403));
    await run(resendConfirmationAction, { email: "leaky@gmail.com" });

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain("leaky@gmail.com");
      expect(line).not.toContain(state.ip);
      expect(line).not.toContain(PASSWORD);
      expect(line).not.toMatch(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i);
    }
  });
});
