import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/health runs the daily housekeeping (app/api/health/route.ts). The one
 * part of it that deletes people — the sweep of accounts never confirmed —
 * must run on the production deployment only: the Playwright suite starts
 * local servers that talk to the real project and call this very route.
 */

const state = vi.hoisted(() => ({ sweeps: 0 }));

vi.mock("@/lib/auth/account-security", () => ({
  sweepUnconfirmedAccounts: async () => {
    state.sweeps += 1;
    return 0;
  },
}));
vi.mock("@/lib/auth/attempts", () => ({ sweepAttempts: async () => 0 }));
vi.mock("@/lib/search/health", () => ({
  SEARCH_HEALTH_KEY: "search_health",
  SEARCH_HEALTH_NAMES: [],
  anonymousSearchHealthClient: () => null,
  runSearchHealthCheck: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: async () => ({ count: 0, error: null }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

import { GET } from "@/app/api/health/route";

const previous = { vercelEnv: process.env.VERCEL_ENV, cronSecret: process.env.CRON_SECRET };

beforeEach(() => {
  state.sweeps = 0;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  for (const [name, value] of [
    ["VERCEL_ENV", previous.vercelEnv],
    ["CRON_SECRET", previous.cronSecret],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the unconfirmed-account sweep", () => {
  it("runs on the production deployment", async () => {
    process.env.VERCEL_ENV = "production";
    const response = await GET(new Request("https://bilimhezinisi.com/api/health"));
    expect(response.status).toBe(200);
    expect(state.sweeps).toBe(1);
    expect(await response.json()).toMatchObject({ ok: true, sweptAccounts: 0 });
  });

  it.each([undefined, "preview", "development"])("never runs anywhere else (VERCEL_ENV=%s)", async (environment) => {
    if (environment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = environment;
    const response = await GET(new Request("http://localhost:3000/api/health"));
    expect(response.status).toBe(200);
    expect(state.sweeps).toBe(0);
    expect(await response.json()).toMatchObject({ ok: true, sweptAccounts: null });
  });
});
