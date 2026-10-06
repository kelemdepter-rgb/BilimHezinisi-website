import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * When Auth or the database is slow or down (PROMPT-40), nothing may hang —
 * and slowness may only ever take something away, never grant it:
 *   - every role check fails CLOSED (lib/admin/guards.ts);
 *   - a page renders for an anonymous reader once its session check runs out
 *     of time (lib/data.ts getSessionInfo);
 *   - the proxy never holds a request past its deadline, and never marks a
 *     page as safe to keep offline when it could not verify the session that
 *     came with it (lib/supabase/middleware.ts);
 *   - a loader whose read failed throws rather than answering "empty", so
 *     nothing false lands in the shared cache (lib/cache.ts).
 */

type Answer<T> = () => Promise<T>;

const state = vi.hoisted(() => ({
  getUser: null as null | (() => Promise<unknown>),
  getClaims: null as null | (() => Promise<unknown>),
  profile: null as null | (() => Promise<unknown>),
}));

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: () => state.getUser!(), getClaims: () => state.getClaims!() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => state.profile!() }) }) }),
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: () => state.getClaims!() } }),
}));

import { getServerRole, requireAdmin, requireStaff } from "@/lib/admin/guards";
import { getSessionInfo } from "@/lib/data";
import { updateSession } from "@/lib/supabase/middleware";
import { LibraryUnavailableError, throwIfUnavailable } from "@/lib/cache";
import { PROXY_AUTH_DEADLINE_MS, SESSION_DEADLINE_MS } from "@/lib/supabase/timeouts";

const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
  state.getUser = async () => ({ data: { user: { id: "u-1", email: "staff@example.com" } }, error: null });
  state.getClaims = async () => ({ data: { claims: { sub: "u-1", email: "staff@example.com" } }, error: null });
  state.profile = async () => ({ data: { role: "admin", display_name: "" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (env.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
  if (env.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.key;
});

async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return work;
}

describe("role checks fail closed", () => {
  it("let a real admin through when the database answers", async () => {
    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
  });

  it("treat an Auth that never answers as nobody — within the deadline", async () => {
    vi.useFakeTimers();
    state.getUser = never as Answer<unknown>;
    expect(await within(getServerRole(), SESSION_DEADLINE_MS)).toBeNull();
    const staff = requireStaff();
    const settled = expect(staff).rejects.toThrow("FORBIDDEN");
    await vi.advanceTimersByTimeAsync(SESSION_DEADLINE_MS);
    await settled;
  });

  it("treat a profile lookup that failed as a reader, never as staff", async () => {
    state.profile = async () => ({ data: null, error: { code: "", message: "AbortError: This operation was aborted" } });
    await expect(getServerRole()).resolves.toMatchObject({ role: "reader" });
    await expect(requireStaff()).rejects.toThrow("FORBIDDEN");
    await expect(requireAdmin()).rejects.toThrow("FORBIDDEN");
  });
});

describe("a page's session check", () => {
  it("renders for an anonymous reader once the deadline passes", async () => {
    vi.useFakeTimers();
    state.getClaims = never as Answer<unknown>;
    expect(await within(getSessionInfo(), SESSION_DEADLINE_MS)).toBeNull();
  });
});

describe("the proxy's session check", () => {
  const request = (cookie?: string) =>
    new NextRequest("http://localhost/books/72", cookie ? { headers: { cookie } } : undefined);
  const SESSION_COOKIE = "sb-abcdefgh-auth-token=base64-eyJ";

  it("never holds a request past its deadline", async () => {
    vi.useFakeTimers();
    state.getClaims = never as Answer<unknown>;
    const pending = updateSession(request(), new Headers());
    const result = await within(pending, PROXY_AUTH_DEADLINE_MS);
    expect(result.response).toBeDefined();
  });

  it("does not let a page rendered with an unverified session be kept offline", async () => {
    vi.useFakeTimers();
    state.getClaims = never as Answer<unknown>;
    const result = await within(updateSession(request(SESSION_COOKIE), new Headers()), PROXY_AUTH_DEADLINE_MS);
    // signedIn true is what makes proxy.ts stamp the page "not cacheable".
    expect(result.signedIn).toBe(true);
  });

  it("does the same when the check failed rather than timed out", async () => {
    state.getClaims = async () => ({ data: null, error: { name: "AuthRetryableFetchError", status: 0 } });
    expect((await updateSession(request(SESSION_COOKIE), new Headers())).signedIn).toBe(true);
  });

  it("calls a request with no session cookie anonymous, slow or not", async () => {
    vi.useFakeTimers();
    state.getClaims = never as Answer<unknown>;
    expect((await within(updateSession(request(), new Headers()), PROXY_AUTH_DEADLINE_MS)).signedIn).toBe(false);
  });

  it("is unchanged when Auth answers: a verified session is signed in, none is anonymous", async () => {
    expect((await updateSession(request(SESSION_COOKIE), new Headers())).signedIn).toBe(true);
    state.getClaims = async () => ({ data: null, error: null });
    expect((await updateSession(request(), new Headers())).signedIn).toBe(false);
  });
});

describe("throwIfUnavailable", () => {
  it("throws for a failed read, and logs the code without the database's words", () => {
    const logged: string[] = [];
    vi.mocked(console.error).mockImplementation((line: string) => void logged.push(line));
    expect(() =>
      throwIfUnavailable("books", { code: "PGRST003", message: 'relation "secret" quoted value' } as { code: string }),
    ).toThrow(LibraryUnavailableError);
    expect(logged.join(" ")).toContain("PGRST003");
    expect(logged.join(" ")).not.toContain("secret");
  });

  it("does nothing when the read succeeded", () => {
    expect(() => throwIfUnavailable("books", null)).not.toThrow();
  });
});
