import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The notebook's Server Actions (PROMPT-43, PROMPT-47): a save is written only
 * over the version it was made on and never into the trash, every refusal has
 * its own code, and every query is filtered by the caller's id on top of RLS.
 * The database is a small fake that records each query's filters and moves
 * `updated_at` when the title or the text is written, the way the trigger
 * note_documents_set_updated_at does since 0031. The real PostgREST round trip
 * of the timestamp is tests/notes-save.spec.ts.
 */

type Row = {
  id: number;
  user_id: string;
  title: string;
  content_html: string;
  content_text: string;
  updated_at: string;
  pinned_at?: string | null;
  deleted_at?: string | null;
};
type Call = {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  filters: [string, unknown][];
  values?: Record<string, unknown>;
  columns?: string;
};

/** `.not(column, "is", null)` — recorded as this in a call's filters. */
const NOT_NULL = "not null";

const state = vi.hoisted(() => ({
  owner: null as { userId: string } | null,
  ownerThrows: false,
  rows: [] as Row[],
  calls: [] as Call[],
  failQueries: false,
  /** What the database answers to the next insert or update (migration 0030's trigger). */
  writeError: null as { code: string; message: string } | null,
  reported: [] as string[],
  /** Everything handed to the log, to prove what is never in it. */
  logged: [] as unknown[],
  clock: 0,
  revalidated: [] as string[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  rpcAnswer: null as null | ((name: string, args: Record<string, unknown>) => { data: unknown; error: unknown }),
}));

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const SOMEONE = "bbbbbbbb-0000-0000-0000-000000000002";

function version(): string {
  state.clock++;
  return `2026-10-08T10:00:${String(state.clock).padStart(2, "0")}.${String(state.clock * 101).padStart(6, "0")}+00:00`;
}

function run(call: Call) {
  if (state.failQueries) return { data: null, error: { code: "57014", message: "timeout" } };
  if (state.writeError && (call.op === "insert" || call.op === "update")) {
    return { data: null, error: state.writeError };
  }
  const matches = (row: Row) =>
    call.filters.every(([column, value]) => {
      const cell = row[column as keyof Row] ?? null;
      return value === NOT_NULL ? cell !== null : cell === value;
    });
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
    const edit = ["title", "content_html", "content_text"].some((column) => column in call.values!);
    Object.assign(row, call.values, edit ? { updated_at: version() } : {});
    return { data: { id: row.id, updated_at: row.updated_at }, error: null };
  }
  if (call.op === "delete") {
    const removed = state.rows.filter(matches);
    state.rows = state.rows.filter((candidate) => !matches(candidate));
    return { data: removed.map((gone) => ({ id: gone.id })), error: null };
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
    is(column: string, value: null) {
      call.filters.push([column, value]);
      return builder;
    },
    not(column: string, operator: string, value: null) {
      if (operator !== "is" || value !== null) throw new Error("the fake knows only not.is.null");
      call.filters.push([column, NOT_NULL]);
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

async function rpc(name: string, args: Record<string, unknown>) {
  state.rpcs.push({ name, args });
  if (state.failQueries) return { data: null, error: { code: "57014", message: "timeout" } };
  return state.rpcAnswer ? state.rpcAnswer(name, args) : { data: null, error: null };
}

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void state.revalidated.push(path) }));
vi.mock("@/lib/server-log", () => ({
  reportServerError: (where: string, error: unknown) => {
    state.reported.push(where);
    state.logged.push(where, error);
  },
}));
vi.mock("@/lib/notes/data", async (original) => ({
  ...(await original<typeof import("@/lib/notes/data")>()),
  ownerClient: async () => {
    if (state.ownerThrows) throw new Error("auth did not answer");
    return state.owner ? { supabase: { from, rpc }, userId: state.owner.userId } : null;
  },
}));

const {
  createNoteAction,
  loadNoteAction,
  noteVersionAction,
  saveNoteAction,
  pinNoteAction,
  trashNoteAction,
  restoreNoteAction,
  deleteNoteForeverAction,
  emptyTrashAction,
  searchMyNotesAction,
  discardIfEmptyAction,
} = await import("@/app/notes/actions");
const { CREATE_RATE_MESSAGE, MAX_SAVE_BYTES, SAVE_MESSAGES } = await import("@/lib/notes/save-protocol");
const { LIST_MESSAGES } = await import("@/lib/notes/list-protocol");
const { NOTE_CREATE_RULE, NOTE_SAVE_RULE, NOTE_SEARCH_RULE, resetRateLimits } = await import("@/lib/rate-limit");
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
  state.writeError = null;
  state.reported = [];
  state.logged = [];
  state.rpcs = [];
  state.rpcAnswer = null;
  resetRateLimits();
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
      ["deleted_at", null],
    ]);
    expect(state.revalidated).toEqual(["/notes"]);
  });

  it("never writes into the trash: a trashed note answers in_trash, and keeps its text", async () => {
    const row = seed({ deleted_at: "2026-10-13T08:00:00+00:00" });
    const result = await saveNoteAction({ id: 7, title: "x", html: "<p>يېڭى</p>", baseUpdatedAt: row.updated_at });
    expect(result).toEqual({ ok: false, code: "in_trash", error: SAVE_MESSAGES.in_trash });
    expect(SAVE_MESSAGES.in_trash).toBe("بۇ خاتىرە ئەخلەت ساندۇقىدا.");
    expect(row.content_html).toBe("<p>بىر</p>");
    expect(state.revalidated).toEqual([]);
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

  it("loadNoteAction will not hand a conflict choice a note in the trash", async () => {
    seed({ deleted_at: "2026-10-13T08:00:00+00:00" });
    expect(await loadNoteAction(7)).toEqual({ ok: false, code: "in_trash", error: SAVE_MESSAGES.in_trash });
  });
});

describe("pin, trash and restore", () => {
  it("pin and unpin the caller's own note, without making it an edit", async () => {
    const row = seed();
    const version = row.updated_at;
    expect(await pinNoteAction(7, true)).toEqual({ ok: true });
    expect(row.pinned_at).toEqual(expect.any(String));
    expect(await pinNoteAction(7, false)).toEqual({ ok: true });
    expect(row.pinned_at).toBeNull();
    expect(row.updated_at).toBe(version);
    expect(state.revalidated).toEqual(["/notes", "/notes"]);
    for (const call of state.calls) expect(call.filters).toContainEqual(["user_id", ME]);
  });

  it("move a note to the trash and back — the same note, the same text, the same version", async () => {
    const row = seed();
    const version = row.updated_at;
    expect(await trashNoteAction(7)).toEqual({ ok: true });
    expect(row.deleted_at).toEqual(expect.any(String));
    // Twice is not an error: a second tap, or another tab first.
    expect(await trashNoteAction(7)).toEqual({ ok: true });
    expect(await restoreNoteAction(7)).toEqual({ ok: true });
    expect(row.deleted_at).toBeNull();
    expect(await restoreNoteAction(7)).toEqual({ ok: true });
    expect(row).toMatchObject({ content_html: "<p>بىر</p>", updated_at: version });
  });

  it("a note in the trash cannot be pinned, and nobody else's note can be touched at all", async () => {
    seed({ deleted_at: "2026-10-13T08:00:00+00:00" });
    const theirs = seed({ id: 8, user_id: SOMEONE });
    expect(await pinNoteAction(7, true)).toEqual({ ok: false, code: "not_found", error: LIST_MESSAGES.not_found });
    for (const attempt of [pinNoteAction(8, true), trashNoteAction(8), restoreNoteAction(8), deleteNoteForeverAction(8)]) {
      expect(await attempt).toMatchObject({ ok: false, code: "not_found" });
    }
    expect(theirs.pinned_at ?? null).toBeNull();
    expect(theirs.deleted_at ?? null).toBeNull();
    expect(state.rows.map((row) => row.id)).toEqual([7, 8]);
  });

  it("signed out, a strange id, or a database that does not answer: refused, said in Uyghur", async () => {
    seed();
    expect(await trashNoteAction("7" as never)).toMatchObject({ code: "not_found" });
    state.failQueries = true;
    expect(await trashNoteAction(7)).toEqual({ ok: false, code: "failed", error: LIST_MESSAGES.failed });
    state.owner = null;
    expect(await pinNoteAction(7, true)).toEqual({
      ok: false,
      code: "needs_account",
      error: LIST_MESSAGES.needs_account,
    });
  });
});

describe("deleting for good", () => {
  it("only a note already in the trash", async () => {
    seed();
    expect(await deleteNoteForeverAction(7)).toMatchObject({ ok: false, code: "not_found" });
    expect(state.rows).toHaveLength(1);
    await trashNoteAction(7);
    expect(await deleteNoteForeverAction(7)).toEqual({ ok: true });
    expect(state.rows).toEqual([]);
  });

  it("emptying the trash takes this writer's trash and nothing else", async () => {
    seed({ id: 7, deleted_at: "2026-10-01T08:00:00+00:00" });
    seed({ id: 8, deleted_at: "2026-10-02T08:00:00+00:00" });
    seed({ id: 9 });
    seed({ id: 10, user_id: SOMEONE, deleted_at: "2026-10-02T08:00:00+00:00" });
    expect(await emptyTrashAction()).toEqual({ ok: true, deleted: 2 });
    expect(state.rows.map((row) => row.id)).toEqual([9, 10]);
  });
});

describe("searchMyNotesAction", () => {
  const found = {
    id: 7,
    title: "سەپەر",
    preview: "بۈگۈن",
    created_at: "2026-10-01T08:00:00+00:00",
    updated_at: "2026-10-02T08:00:00+00:00",
    pinned_at: null,
    content_length: 5,
    content_bytes: 30,
  };

  it("asks search_my_notes with the trimmed words, and answers the list's rows", async () => {
    state.rpcAnswer = () => ({ data: [found], error: null });
    expect(await searchMyNotesAction("  سەپەر ")).toEqual({
      ok: true,
      notes: [
        {
          id: 7,
          title: "سەپەر",
          preview: "بۈگۈن",
          created_at: found.created_at,
          updated_at: found.updated_at,
          pinned_at: null,
          length: 5,
          bytes: 30,
        },
      ],
    });
    expect(state.rpcs).toEqual([{ name: "search_my_notes", args: { p_query: "سەپەر", p_limit: 50 } }]);
  });

  it("does not ask for fewer than 2 or more than 100 characters", async () => {
    for (const words of ["", " س ", "س".repeat(101)]) {
      expect(await searchMyNotesAction(words)).toEqual({ ok: true, notes: [] });
    }
    expect(state.rpcs).toEqual([]);
  });

  it("never puts the words into the log", async () => {
    state.failQueries = true;
    expect(await searchMyNotesAction("مەخپىي سۆز")).toEqual({ ok: false, code: "failed", error: LIST_MESSAGES.failed });
    expect(state.reported).toEqual(["searchMyNotesAction:rpc"]);
    expect(JSON.stringify(state.logged)).not.toContain("مەخپىي");
  });

  it("NOTE_SEARCH_RULE's allowance, then `rate` before the database is asked — for that writer only", async () => {
    state.rpcAnswer = () => ({ data: [], error: null });
    for (let search = 0; search < NOTE_SEARCH_RULE.limit; search += 1) {
      expect((await searchMyNotesAction("سۆز")).ok).toBe(true);
    }
    state.rpcs = [];
    expect(await searchMyNotesAction("سۆز")).toEqual({ ok: false, code: "rate", error: LIST_MESSAGES.rate });
    expect(state.rpcs).toEqual([]);
    state.owner = { userId: SOMEONE };
    expect((await searchMyNotesAction("سۆز")).ok).toBe(true);
  });

  it("signed out: refused", async () => {
    state.owner = null;
    expect(await searchMyNotesAction("سۆز")).toMatchObject({ ok: false, code: "needs_account" });
  });
});

describe("discardIfEmptyAction", () => {
  it("leaves the decision to discard_note_if_empty, and redraws nothing", async () => {
    state.rpcAnswer = (_name, args) => ({ data: args.p_id === 7, error: null });
    expect(await discardIfEmptyAction(7)).toEqual({ ok: true, discarded: true });
    expect(await discardIfEmptyAction(8)).toEqual({ ok: true, discarded: false });
    expect(state.rpcs).toEqual([
      { name: "discard_note_if_empty", args: { p_id: 7 } },
      { name: "discard_note_if_empty", args: { p_id: 8 } },
    ]);
    expect(state.revalidated).toEqual([]);
  });

  it("a strange id or a signed-out caller never reaches the database", async () => {
    expect(await discardIfEmptyAction(0)).toMatchObject({ ok: false, code: "not_found" });
    state.owner = null;
    expect(await discardIfEmptyAction(7)).toMatchObject({ ok: false, code: "needs_account" });
    expect(state.rpcs).toEqual([]);
  });
});

describe("a full notebook (migration 0030)", () => {
  it("a save the trigger refuses for size is quota_bytes, in Uyghur, and is not logged as a fault", async () => {
    const row = seed();
    state.writeError = { code: "P0001", message: "note_quota_bytes" };
    expect(
      await saveNoteAction({ id: 7, title: "x", html: "<p>كۆپ</p>", baseUpdatedAt: row.updated_at }),
    ).toEqual({ ok: false, code: "quota_bytes", error: SAVE_MESSAGES.quota_bytes });
    expect(row.content_html).toBe("<p>بىر</p>");
    expect(state.reported).toEqual([]);
    expect(state.revalidated).toEqual([]);
  });

  it("a new note the trigger refuses is quota_count, or quota_bytes when it is the size", async () => {
    state.writeError = { code: "P0001", message: "note_quota_count" };
    expect(await createNoteAction()).toEqual({ ok: false, code: "quota_count", error: SAVE_MESSAGES.quota_count });
    state.writeError = { code: "P0001", message: "note_quota_bytes" };
    expect(await createNoteAction({ title: "x", html: "<p>x</p>" })).toEqual({
      ok: false,
      code: "quota_bytes",
      error: SAVE_MESSAGES.quota_bytes,
    });
    expect(state.rows).toEqual([]);
    expect(state.reported).toEqual([]);
  });

  it("any other refusal is still a logged failure to retry", async () => {
    const row = seed();
    state.writeError = { code: "P0001", message: "note_quota_bytes_and_more" };
    expect(
      await saveNoteAction({ id: 7, title: "x", html: "<p>x</p>", baseUpdatedAt: row.updated_at }),
    ).toMatchObject({ ok: false, code: "failed" });
    expect(state.reported).toEqual(["saveNoteAction:update"]);
  });
});

describe("the writer's own rate limits", () => {
  it("saves: NOTE_SAVE_RULE's allowance, then `rate` before the database is asked — for that writer only", async () => {
    const row = seed();
    for (let save = 0; save < NOTE_SAVE_RULE.limit; save += 1) {
      const result = await saveNoteAction({ id: 7, title: "x", html: `<p>${save}</p>`, baseUpdatedAt: row.updated_at });
      expect(result.ok, `save ${save + 1}`).toBe(true);
    }
    state.calls = [];
    expect(
      await saveNoteAction({ id: 7, title: "x", html: "<p>y</p>", baseUpdatedAt: row.updated_at }),
    ).toEqual({ ok: false, code: "rate", error: SAVE_MESSAGES.rate });
    expect(state.calls).toEqual([]);

    // Another writer is not slowed by this one.
    state.owner = { userId: SOMEONE };
    const theirs = seed({ id: 8, user_id: SOMEONE });
    expect(
      await saveNoteAction({ id: 8, title: "x", html: "<p>z</p>", baseUpdatedAt: theirs.updated_at }),
    ).toMatchObject({ ok: true });
  });

  it("new notes: NOTE_CREATE_RULE's allowance, then `rate` with the list's own sentence", async () => {
    for (let note = 0; note < NOTE_CREATE_RULE.limit; note += 1) {
      expect((await createNoteAction()).ok, `note ${note + 1}`).toBe(true);
    }
    state.calls = [];
    expect(await createNoteAction()).toEqual({ ok: false, code: "rate", error: CREATE_RATE_MESSAGE });
    expect(state.calls).toEqual([]);
    // Saving is a separate allowance.
    const row = state.rows[0];
    expect(
      await saveNoteAction({ id: row.id, title: "x", html: "<p>x</p>", baseUpdatedAt: row.updated_at }),
    ).toMatchObject({ ok: true });
  });

  it("a signed-out caller is not counted against anyone", async () => {
    state.owner = null;
    for (let call = 0; call < NOTE_CREATE_RULE.limit + 5; call += 1) {
      expect(await createNoteAction()).toMatchObject({ code: "needs_account" });
    }
    state.owner = { userId: ME };
    expect(await createNoteAction()).toMatchObject({ ok: true });
  });
});
