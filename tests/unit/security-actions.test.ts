import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The /admin security card's two switches (app/admin/security-actions.ts):
 * the admin alone may flip them, whatever the page showed, and the role is
 * read from the database on every call — a signed-out caller, a reader and an
 * uploader are all refused before anything is written.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  role: null as string | null,
  writes: [] as unknown[],
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void state.revalidated.push(path) }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.role ? { role: state.role } : null, error: null }) }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (row: unknown) => {
        state.writes.push({ table, row });
        return { error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/cache", () => ({ cachedClient: () => null }));

import { setRegistrationPausedAction, setUnconfirmedSweepAction } from "@/app/admin/security-actions";
import { MSG } from "@/lib/admin/messages";

function signedInAs(role: string | null) {
  state.user = { id: "5f0c1a52-0000-4000-8000-000000000001", email: "someone@gmail.com" };
  state.role = role;
}

beforeEach(() => {
  state.user = null;
  state.role = null;
  state.writes = [];
  state.revalidated = [];
});

describe("who may flip the switches", () => {
  it.each([
    ["a signed-out visitor", () => undefined],
    ["a reader", () => signedInAs("reader")],
    ["a reader with no profile row", () => signedInAs(null)],
    ["an uploader", () => signedInAs("uploader")],
  ])("%s is refused, and nothing is written", async (_who, arrange) => {
    arrange();
    expect(await setRegistrationPausedAction(true)).toEqual({ ok: false, error: MSG.forbidden });
    expect(await setUnconfirmedSweepAction(true)).toEqual({ ok: false, error: MSG.forbidden });
    expect(state.writes).toEqual([]);
    expect(state.revalidated).toEqual([]);
  });

  it("the admin may, and /admin is redrawn", async () => {
    signedInAs("admin");
    expect(await setRegistrationPausedAction(true)).toEqual({ ok: true, message: MSG.saved });
    expect(state.writes).toEqual([
      { table: "settings", row: { key: "registration_paused", value: true, is_public: true } },
    ]);
    expect(state.revalidated).toEqual(["/admin"]);
  });
});

describe("what they write", () => {
  it("the sweep's switch is private", async () => {
    signedInAs("admin");
    await setUnconfirmedSweepAction(true);
    await setUnconfirmedSweepAction(false);
    expect(state.writes).toEqual([
      { table: "settings", row: { key: "unconfirmed_sweep_enabled", value: true, is_public: false } },
      { table: "settings", row: { key: "unconfirmed_sweep_enabled", value: false, is_public: false } },
    ]);
  });

  it("only a literal true switches anything on", async () => {
    signedInAs("admin");
    for (const value of ["true", 1, "yes", null, undefined, {}]) {
      await setRegistrationPausedAction(value as never);
    }
    expect(state.writes.every((write) => (write as { row: { value: unknown } }).row.value === false)).toBe(true);
  });
});
