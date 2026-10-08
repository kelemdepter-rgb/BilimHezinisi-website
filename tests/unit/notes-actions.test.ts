import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The notebook's Server Actions (PROMPT-43): a save is written only over the
 * version it was made on, every refusal has its own code, and every query is
 * filtered by the caller's id on top of RLS. The database is a small fake that
 * records each query's filters and moves `updated_at` on every write, the way
 * the trigger note_documents_set_updated_at does. The real PostgREST round
 * trip of the timestamp is tests/notes-save.spec.ts.
 */

type Row = { id: number; user_id: string; title: string; content_html: string; content_text: string; updated_at: string };
type Call = {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  filters: [string, unknown][];
  values?: Record<string, unknown>;
  columns?: string;
};

const state = vi.hoisted(() => ({
  owner: null as { userId: string } | null,
  ownerThrows: false,
  rows: [] as Row[],
  calls: [] as Call[],
  failQueries: false,
  clock: 0,
  revalidated: [] as string[],
}));

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const SOMEONE = "bbbbbbbb-0000-0000-0000-000000000002";

function version(): string {
  state.clock++;
  return `2026-10-08T10:00:${String(state.clock).padStart(2, "0")}.${String(state.clock * 101).padStart(6, "0")}+00:00`;
}

function run(call: Call) {
  if (state.failQueries) return { data: null, error: { code: "57014", message: "timeout" } };
  const matches = (row: Row) =>
    call.filters.every(([column, value]) => row[column as keyof Row] === value);
  if (call.op === "insert") {
    const row: Row = {
      id: state.rows.length + 100,
      user_id: String(call.values!.user_id),
      title: String(call.values!.title),
      content_html: String(call.values!.content_html ?? ""),
      content_text: String(call.values!.content_text ?? ""),
      updated_at: version(),
    };
    state.rows.push(row);
    return { data: { id: row.id, updated_at: row.updated_at }, error: null };
  }
  const row = state.rows.find(matches);
  if (call.op === "update") {
    if (!row) return { data: null, error: null };
    Object.assign(row, call.values, { updated_at: version() });
    return { data: { updated_at: row.updated_at }, error: null };
  }
  if (call.op === "delete") {
    state.rows = state.rows.filter((candidate) => !matches(candidate));
    return { data: null, error: null };
  }
  return { data: row ? { ...row } : null, error: null };
}

function from(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  state.calls.push(call);
  const builder = {
    select(columns: string) {
      call.columns = columns;
      return builder;
    },
    update(values: Record<string, unknown>) {
      call.op = "update";
      call.values = values;
      return builder;
    },
    insert(values: Record<string, unknown>) {
      call.op = "insert";
      call.values = values;
      return builder;
    },
    delete() {
      call.op = "delete";
      return builder;
    },
    eq(column: string, value: unknown) {
      call.filters.push([column, value]);
      return builder;
    },
    maybeSingle: async () => run(call),
    single: async () => run(call),
    then(resolve: (value: unknown) => void) {
      resolve(run(call));
    },
  };
  return builder;
}

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void state.revalidated.push(path) }));
vi.mock("@/lib/server-log", () => ({ reportServerError: () => {} }));
vi.mock("@/lib/notes/data", () => ({
  ownerClient: async () => {
    if (state.ownerThrows) throw new Error("auth did not answer");
    return state.owner ? { supabase: { from }, userId: state.owner.userId } : null;
  },
}));

const { createNoteAction, loadNoteAction, noteVersionAction, saveNoteAction, deleteNoteAction } =
  await import("@/app/notes/actions");
const { MAX_SAVE_BYTES, SAVE_MESSAGES } = await import("@/lib/notes/save-protocol");
const { MAX_NOTE_CHARS } = await import("@/lib/notes/limits");

function seed(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: 7,
    user_id: ME,
    title: "خاتىرە",
    content_html: "<p>بىر</p>",
    content_text: "بىر",
    updated_at: version(),
    ...overrides,
  };
  state.rows.push(row);
  return row;
}

beforeEach(() => {
  state.owner = { userId: ME };
  state.ownerThrows = false;
  state.rows = [];
  state.calls = [];
  state.failQueries = false;
  state.clock = 0;
  state.revalidated = [];
});

describe("saveNoteAction", () => {
  it("writes over the version it was made on, and returns the new one", async () => {
    const row = seed();
    const base = row.updated_at;
    const result = await saveNoteAction({
      id: 7,
      title: "  دەرس پىلانى ",
      html: '<p onclick="x()">ئىككى<script>alert(1)</script></p>',
      baseUpdatedAt: base,
    });
    expect(result).toEqual({ ok: true, updatedAt: row.updated_at });
    expect(row.updated_at).not.toBe(base);
    expect(row.title).toBe("دەرس پىلانى");
    expect(row.content_html).toBe("<p>ئىككى</p>");
    expect(row.content_text).toBe("ئىككى");

    const update = state.calls.find((call) => call.op === "update")!;
    expect(update.filters).toEqual([
      ["id", 7],
      ["user_id", ME],
      ["updated_at", base],
    ]);
    expect(state.revalidated).toEqual(["/notes"]);
  });

  it("a stale version is a conflict, carrying the server's version — nothing is written", async () => {
    const row = seed();
    const stale = row.updated_at;
    await saveNoteAction({ id: 7, title: "A", html: "<p>بىرىنچى</p>", baseUpdatedAt: stale });
    const current = row.updated_at;

    const result = await saveNoteAction({ id: 7, title: "B", html: "<p>ئىككىنچى</p>", baseUpdatedAt: stale });
    expect(result).toEqual({
      ok: false,
      code: "conflict",
      error: SAVE_MESSAGES.conflict,
      serverUpdatedAt: current,
    });
    expect(row.content_html).toBe("<p>بىرىنچى</p>");
  });

  it("someone else's note, or none at all, is not_found — and is never written", async () => {
    const theirs = seed({ id: 8, user_id: SOMEONE });
    for (const id of [8, 9]) {
      const result = await saveNoteAction({ id, title: "x", html: "<p>x</p>", baseUpdatedAt: theirs.updated_at });
      expect(result).toMatchObject({ ok: false, code: "not_found", error: SAVE_MESSAGES.not_found });
    }
    expect(theirs.content_html).toBe("<p>بىر</p>");
    for (const call of state.calls) expect(call.filters).toContainEqual(["user_id", ME]);
  });

  it("signed out is needs_account; Auth not answering is a failure to retry, never a sign-out", async () => {
    seed();
    state.owner = null;
    expect(await saveNoteAction({ id: 7, title: "x", html: "", baseUpdatedAt: "v" })).toMatchObject({
      code: "needs_account",
      error: SAVE_MESSAGES.needs_account,
    });
    state.ownerThrows = true;
    expect(await saveNoteAction({ id: 7, title: "x", html: "", baseUpdatedAt: "v" })).toMatchObject({
      code: "failed",
    });
  });

  it("refuses too long and too large before anything is written", async () => {
    const row = seed();
    expect(
      await saveNoteAction({
        id: 7,
        title: "x",
        html: `<p>${"ئ".repeat(MAX_NOTE_CHARS + 1)}</p>`,
        baseUpdatedAt: row.updated_at,
      }),
    ).toMatchObject({ code: "too_long", error: SAVE_MESSAGES.too_long });
    expect(
      await saveNoteAction({
        id: 7,
        title: "x",
        html: `<p style="color: red">${"a".repeat(MAX_SAVE_BYTES)}</p>`,
        baseUpdatedAt: row.updated_at,
      }),
    ).toMatchObject({ code: "too_large", error: SAVE_MESSAGES.too_large });
    expect(state.calls).toEqual([]);
  });

  it("a malformed call is a failure and touches nothing", async () => {
    seed();
    for (const input of [
      { id: 7, title: "x", html: "<p>x</p>" },
      { id: "7", title: "x", html: "<p>x</p>", baseUpdatedAt: "v" },
      { id: 7, title: 1, html: "<p>x</p>", baseUpdatedAt: "v" },
      { id: 7, title: "x", html: "<p>x</p>", baseUpdatedAt: "v".repeat(100) },
    ]) {
      expect(await saveNoteAction(input as never)).toMatchObject({ code: "failed" });
    }
    expect(state.calls).toEqual([]);
  });

  it("a database that does not answer is a failure to retry", async () => {
    const row = seed();
    state.failQueries = true;
    expect(
      await saveNoteAction({ id: 7, title: "x", html: "<p>x</p>", baseUpdatedAt: row.updated_at }),
    ).toMatchObject({ ok: false, code: "failed" });
  });
});

describe("createNoteAction", () => {
  it("makes an empty note when asked with nothing — or with a form", async () => {
    const plain = await createNoteAction();
    expect(plain).toMatchObject({ ok: true });
    const form = new FormData();
    form.set("html", "<p>x</p>");
    const fromForm = await createNoteAction(form as never);
    expect(fromForm).toMatchObject({ ok: true });
    for (const call of state.calls) {
      expect(call.values).toEqual({ user_id: ME, title: "يېڭى خاتىرە" });
    }
  });

  it("makes a note already holding a text, sanitized, in one request", async () => {
    const result = await createNoteAction({
      title: "سەپەر (بۇ ئۈسكۈنىدىكى نۇسخا)",
      html: '<p>يول<img src="data:image/png;base64,AAAA"></p>',
    });
    expect(result).toEqual({ ok: true, id: 100, updatedAt: state.rows[0].updated_at });
    expect(state.calls).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      user_id: ME,
      title: "سەپەر (بۇ ئۈسكۈنىدىكى نۇسخا)",
      content_html: "<p>يول</p>",
      content_text: "يول",
    });
  });

  it("refuses a text that is too long", async () => {
    expect(
      await createNoteAction({ title: "x", html: `<p>${"ئ".repeat(MAX_NOTE_CHARS + 1)}</p>` }),
    ).toMatchObject({ ok: false, code: "too_long" });
    expect(state.rows).toEqual([]);
  });

  it("signed out: refused", async () => {
    state.owner = null;
    expect(await createNoteAction()).toMatchObject({ ok: false, code: "needs_account" });
  });
});

describe("noteVersionAction and loadNoteAction", () => {
  it("answer for the caller's own note only", async () => {
    const mine = seed();
    seed({ id: 8, user_id: SOMEONE });
    expect(await noteVersionAction(7)).toEqual({ ok: true, updatedAt: mine.updated_at });
    expect(await loadNoteAction(7)).toEqual({
      ok: true,
      title: mine.title,
      html: mine.content_html,
      updatedAt: mine.updated_at,
    });
    expect(await noteVersionAction(8)).toMatchObject({ ok: false, code: "not_found" });
    expect(await loadNoteAction(8)).toMatchObject({ ok: false, code: "not_found" });
    for (const call of state.calls) expect(call.filters).toContainEqual(["user_id", ME]);
    // The version check reads the version and nothing else.
    expect(state.calls[0].columns).toBe("updated_at");
  });

  it("refuse a strange id without asking the database", async () => {
    expect(await noteVersionAction(-1)).toMatchObject({ code: "not_found" });
    expect(await loadNoteAction(Number.NaN)).toMatchObject({ code: "not_found" });
    expect(state.calls).toEqual([]);
  });
});

describe("deleteNoteAction", () => {
  it("still deletes only the caller's own note", async () => {
    seed();
    seed({ id: 8, user_id: SOMEONE });
    const form = new FormData();
    form.set("id", "8");
    await deleteNoteAction(form);
    expect(state.rows.map((row) => row.id)).toEqual([7, 8]);
    form.set("id", "7");
    expect(await deleteNoteAction(form)).toMatchObject({ ok: true });
    expect(state.rows.map((row) => row.id)).toEqual([8]);
  });
});
