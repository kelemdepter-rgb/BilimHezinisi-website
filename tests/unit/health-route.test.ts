import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/health runs the daily housekeeping (app/api/health/route.ts). The one
 * part of it that deletes people — the sweep of accounts never confirmed —
 * must run on the production deployment only: the Playwright suite starts
 * local servers that talk to the real project and call this very route.
 */

const state = vi.hoisted(() => ({
  sweeps: 0,
  purges: 0,
  rpcs: [] as { name: string; args: unknown }[],
  rpcAnswer: { data: 3 as unknown, error: null as unknown },
}));

vi.mock("@/lib/auth/account-security", () => ({
  sweepUnconfirmedAccounts: async () => {
    state.sweeps += 1;
    return 0;
  },
}));
vi.mock("@/lib/auth/attempts", () => ({ sweepAttempts: async () => 0 }));
vi.mock("@/lib/notes/trash-purge", () => ({
  purgeNoteTrash: async () => {
    state.purges += 1;
    return 4;
  },
}));
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
    rpc: async (name: string, args: unknown) => {
      state.rpcs.push({ name, args });
      return state.rpcAnswer;
    },
  }),
}));

import { GET } from "@/app/api/health/route";

const previous = { vercelEnv: process.env.VERCEL_ENV, cronSecret: process.env.CRON_SECRET };

beforeEach(() => {
  state.sweeps = 0;
  state.purges = 0;
  state.rpcs = [];
  state.rpcAnswer = { data: 3, error: null };
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
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

describe("the notebook's trash purge (PROMPT-47)", () => {
  it("runs on the production deployment, after the other sweeps", async () => {
    process.env.VERCEL_ENV = "production";
    const response = await GET(new Request("https://bilimhezinisi.com/api/health"));
    expect(state.purges).toBe(1);
    expect(await response.json()).toMatchObject({ ok: true, purgedNotes: 4 });
  });

  it.each([undefined, "preview", "development"])("never runs anywhere else (VERCEL_ENV=%s)", async (environment) => {
    if (environment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = environment;
    const response = await GET(new Request("http://localhost:3000/api/health"));
    expect(state.purges).toBe(0);
    expect(await response.json()).toMatchObject({ ok: true, purgedNotes: null });
  });

  it("is left for tomorrow when the run has used up its time", async () => {
    process.env.VERCEL_ENV = "production";
    // Every look at the clock finds 50 s gone: the purge's look is past 45 s.
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      clock += 50_000;
      return clock;
    });
    const response = await GET(new Request("https://bilimhezinisi.com/api/health"));
    expect(state.purges).toBe(0);
    expect(await response.json()).toMatchObject({ ok: true, purgedNotes: null });
  });

  it("asks for at most 500 notes, and logs the count — nothing else", async () => {
    const { purgeNoteTrash, TRASH_PURGE_LIMIT } =
      await vi.importActual<typeof import("@/lib/notes/trash-purge")>("@/lib/notes/trash-purge");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await purgeNoteTrash()).toBe(3);
    expect(TRASH_PURGE_LIMIT).toBe(500);
    expect(state.rpcs).toEqual([{ name: "purge_note_trash", args: { p_limit: 500 } }]);
    expect(log.mock.calls).toEqual([["[notes] trash purge deleted 3 note(s)"]]);

    state.rpcAnswer = { data: null, error: { code: "57014", message: "a note title would never be here" } };
    expect(await purgeNoteTrash()).toBeNull();
    expect(error.mock.calls).toEqual([["[notes] trash purge failed: code=57014"]]);
  });
});
