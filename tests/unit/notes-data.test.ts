import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

/**
 * The notebook's loaders (lib/notes/data.ts) tell three answers apart, and
 * only one of them may become «تېخى خاتىرە يوق» or a 404:
 *   - nobody is signed in → null, and the pages send the visitor to sign in;
 *   - the writer's notes, or the lack of one → the list, [] or null (a 404);
 *   - Auth or the database did not answer → a throw, so app/notes/error.tsx
 *     says the notebook did not open and offers to try again (PROMPT-40).
 * On 2026-10-07 the third was answered as the second: a writer who had just
 * made a note was told they had none. tests/notes-unavailable.spec.ts shows
 * the same from the browser; this pins down every Auth answer, which the fake
 * Supabase cannot single out.
 */

type Answer = () => Promise<unknown>;

const state = vi.hoisted(() => ({
  getUser: null as null | (() => Promise<unknown>),
  read: null as null | (() => Promise<unknown>),
  /** What a delete answers (openTrash's expiry). */
  remove: null as null | (() => Promise<unknown>),
  filters: [] as [string, unknown][],
  deletes: [] as [string, unknown][][],
}));

const never = (): Promise<never> => new Promise<never>(() => undefined);

/** A PostgREST query: every builder step returns itself; awaiting it reads. */
function query() {
  let deleting = false;
  const filters: [string, unknown][] = [];
  const filter = (column: string, value: unknown) => {
    filters.push([column, value]);
    state.filters.push([column, value]);
    return chain;
  };
  const answer = () => (deleting ? state.remove!() : state.read!());
  const chain = {
    select: () => chain,
    order: () => chain,
    delete: () => {
      deleting = true;
      state.deletes.push(filters);
      return chain;
    },
    eq: filter,
    not: (column: string, operator: string, value: unknown) => filter(column, `not.${operator}.${String(value)}`),
    lt: (column: string, value: unknown) => filter(column, `lt.${String(value)}`),
    gte: (column: string, value: unknown) => filter(column, `gte.${String(value)}`),
    maybeSingle: () => answer(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      answer().then(resolve, reject),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: () => state.getUser!() },
    from: () => query(),
  }),
}));

import { getNote, loadNotebook, openTrash } from "@/lib/notes/data";
import { LibraryUnavailableError } from "@/lib/cache";
import { SESSION_DEADLINE_MS } from "@/lib/supabase/timeouts";

const WRITER = { id: "u-1", email: "writer@example.com" };
const NOTE = {
  id: 4143,
  title: "سىناق",
  content_html: "<p>مەزمۇن</p>",
  content_text: "مەزمۇن",
  updated_at: "2026-10-07T09:00:00.000Z",
};

const authSays = (error: unknown): Answer => async () => ({ data: { user: null }, error });

beforeEach(() => {
  state.getUser = async () => ({ data: { user: WRITER }, error: null });
  state.read = async () => ({ data: [], error: null });
  state.remove = async () => ({ data: null, error: null });
  state.filters = [];
  state.deletes = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("who is writing", () => {
  it("a visitor with no session is null — the pages send them to sign in", async () => {
    state.getUser = authSays(new AuthSessionMissingError());
    expect(await loadNotebook()).toBeNull();
    expect(await getNote(NOTE.id)).toBeNull();
  });

  it("a token Auth refused is null too", async () => {
    state.getUser = authSays(new AuthApiError("invalid JWT", 403, "bad_jwt"));
    expect(await loadNotebook()).toBeNull();
    expect(await getNote(NOTE.id)).toBeNull();
  });

  it.each([
    ["a timed-out or failed request", new AuthRetryableFetchError("This operation was aborted", 0)],
    ["a 5xx", new AuthApiError("Internal Server Error", 500, undefined)],
    ["a 429", new AuthApiError("Too many requests", 429, "over_request_rate_limit")],
  ])("an Auth that could not be asked (%s) throws — never «not signed in», never a 404", async (_, error) => {
    state.getUser = authSays(error);
    await expect(loadNotebook()).rejects.toThrow(LibraryUnavailableError);
    await expect(getNote(NOTE.id)).rejects.toThrow(LibraryUnavailableError);
  });

  it("an Auth that never answers throws once the session deadline passes", async () => {
    vi.useFakeTimers();
    state.getUser = never;
    const list = expect(loadNotebook()).rejects.toThrow(LibraryUnavailableError);
    const note = expect(getNote(NOTE.id)).rejects.toThrow(LibraryUnavailableError);
    await vi.advanceTimersByTimeAsync(SESSION_DEADLINE_MS);
    await list;
    await note;
  });
});

describe("the notes", () => {
  const failed = async () => ({ data: null, error: { code: "PGRST003", message: "Timed out acquiring connection" } });

  it("a list that did not load throws, and is never an empty notebook", async () => {
    state.read = failed;
    await expect(loadNotebook()).rejects.toThrow(LibraryUnavailableError);
  });

  it("no notes at all is an empty list — that one is true", async () => {
    expect(await loadNotebook()).toEqual({ notes: [], trash: [] });
    expect(state.filters).toContainEqual(["user_id", WRITER.id]);
  });

  it("the writer's notes come back, newest first as read, the trash beside them", async () => {
    const row = {
      id: NOTE.id,
      title: NOTE.title,
      preview: "مەزمۇن",
      created_at: "2026-10-01T09:00:00.000Z",
      updated_at: NOTE.updated_at,
      pinned_at: null,
      deleted_at: null,
      content_length: 6,
      content_bytes: 40,
    };
    const trashed = { ...row, id: 4144, deleted_at: "2026-10-08T09:00:00.000Z" };
    state.read = async () => ({ data: [row, trashed], error: null });
    const summary = {
      id: NOTE.id,
      title: NOTE.title,
      preview: "مەزمۇن",
      created_at: row.created_at,
      updated_at: NOTE.updated_at,
      pinned_at: null,
      length: 6,
      bytes: 40,
    };
    expect(await loadNotebook()).toEqual({
      notes: [summary],
      trash: [{ ...summary, id: 4144, deleted_at: trashed.deleted_at }],
    });
  });

  it("opening the trash first deletes this writer's own notes whose 30 days are over", async () => {
    const now = Date.parse("2026-10-13T12:00:00.000Z");
    await openTrash(now);
    expect(state.deletes).toHaveLength(1);
    expect(state.deletes[0]).toEqual([
      ["user_id", WRITER.id],
      ["deleted_at", "not.is.null"],
      ["deleted_at", "lt.2026-09-13T12:00:00.000Z"],
    ]);
  });

  it("an expiry that failed leaves the trash readable; a trash that did not load throws", async () => {
    state.remove = async () => ({ data: null, error: { code: "57014", message: "timeout" } });
    expect(await openTrash()).toEqual([]);
    state.read = failed;
    await expect(openTrash()).rejects.toThrow(LibraryUnavailableError);
  });

  it("a note that did not load throws, rather than becoming a 404", async () => {
    state.read = failed;
    await expect(getNote(NOTE.id)).rejects.toThrow(LibraryUnavailableError);
  });

  it("a note that is not there — or not theirs — is null, a real 404", async () => {
    state.read = async () => ({ data: null, error: null });
    expect(await getNote(NOTE.id)).toBeNull();
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ["id", NOTE.id],
        ["user_id", WRITER.id],
      ]),
    );
  });

  it("the writer's own note comes back", async () => {
    state.read = async () => ({ data: NOTE, error: null });
    expect(await getNote(NOTE.id)).toEqual(NOTE);
  });
});
