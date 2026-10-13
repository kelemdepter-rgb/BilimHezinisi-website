import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_EVERY_MS,
  HISTORY_DB,
  MAX_HISTORY_BYTES,
  MAX_VERSIONS_PER_NOTE,
  createNoteHistory,
  forgetNoteHistory,
  versionSize,
  type NoteHistory,
  type VersionReason,
} from "@/lib/notes/history";

/**
 * The notebook's on-device version history (PROMPT-46) against a fake
 * IndexedDB: what is kept, what is thrown away first when it is full, and
 * that every way the browser can refuse it ends in an answer rather than an
 * exception. Each test gets a factory of its own, so nothing carries over.
 * Every text is invented.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

/** A history on a fresh fake database, with a clock the test moves. */
function fresh(start = Date.UTC(2026, 9, 13, 9, 0)) {
  const clock = { now: start };
  const factory = new IDBFactory();
  const history = createNoteHistory({ indexedDB: () => factory, now: () => clock.now });
  const tick = (ms = 1000) => {
    clock.now += ms;
  };
  return { history, clock, tick, factory };
}

function input(noteId: number, html: string, userId = ALICE, title = "خاتىرە") {
  return { userId, noteId, title, html };
}

async function reasons(history: NoteHistory, noteId: number, userId = ALICE) {
  const listed = await history.list(userId, noteId);
  if (!listed.ok) throw new Error("the list was unavailable");
  return listed.versions.map((version) => `${version.reason}:${version.html.slice(0, 12)}`);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("what is kept", () => {
  it("a version identical to the note's newest is never stored twice", async () => {
    const { history, tick } = fresh();
    expect(await history.keep({ ...input(1, "<p>بىرىنچى</p>"), reason: "open" })).toBe("kept");
    tick();
    expect(await history.keep({ ...input(1, "<p>بىرىنچى</p>"), reason: "open" })).toBe("same");
    // A different title is a different version.
    tick();
    expect(await history.keep({ ...input(1, "<p>بىرىنچى</p>", ALICE, "يېڭى ماۋزۇ"), reason: "before-ai" })).toBe(
      "kept",
    );
    // Identical to an OLDER version, but not to the newest: kept.
    tick();
    expect(await history.keep({ ...input(1, "<p>بىرىنچى</p>"), reason: "before-restore" })).toBe("kept");
    const listed = await history.list(ALICE, 1);
    expect(listed.ok && listed.versions.map((v) => v.reason)).toEqual(["before-restore", "before-ai", "open"]);
  });

  it("a destructive action right after opening names the version it did not store twice", async () => {
    const { history, tick } = fresh();
    await history.keep({ ...input(1, "<p>a</p>"), reason: "open" });
    tick();
    expect(await history.keep({ ...input(1, "<p>a</p>"), reason: "before-replace-all" })).toBe("same");
    tick();
    await history.keepAuto(input(1, "<p>b</p>"));
    tick();
    expect(await history.keep({ ...input(1, "<p>b</p>"), reason: "before-ai" })).toBe("same");
    // A label that already says why stays as it is.
    tick();
    expect(await history.keep({ ...input(1, "<p>b</p>"), reason: "before-restore" })).toBe("same");
    const listed = await history.list(ALICE, 1);
    expect(listed.ok && listed.versions.map((v) => `${v.reason}:${v.html}`)).toEqual([
      "before-ai:<p>b</p>",
      "before-replace-all:<p>a</p>",
    ]);
    const usage = await history.measure();
    expect(usage.ok && usage.count).toBe(2);
  });

  it("lists one note's versions only, newest first, with their length as text", async () => {
    const { history, tick } = fresh();
    await history.keep({ ...input(1, "<p>ئالىسنىڭ بىرىنچىسى</p>"), reason: "open" });
    tick();
    await history.keep({ ...input(2, "<p>ئالىسنىڭ ئىككىنچىسى</p>"), reason: "open" });
    tick();
    await history.keep({ ...input(1, "<p>بوبنىڭ</p>", BOB), reason: "open" });
    tick();
    await history.keep({ ...input(1, "<div>a<b>b</b></div>"), reason: "auto" });

    const alice1 = await history.list(ALICE, 1);
    expect(alice1.ok).toBe(true);
    if (!alice1.ok) return;
    expect(alice1.versions.map((v) => v.html)).toEqual(["<div>a<b>b</b></div>", "<p>ئالىسنىڭ بىرىنچىسى</p>"]);
    expect(alice1.versions.every((v) => v.userId === ALICE && v.noteId === 1)).toBe(true);
    expect(alice1.versions[0].chars).toBe(2);
    expect(alice1.versions[0].at).toBeGreaterThan(alice1.versions[1].at);

    const bob1 = await history.list(BOB, 1);
    expect(bob1.ok && bob1.versions.map((v) => v.html)).toEqual(["<p>بوبنىڭ</p>"]);
    // The same text in another note, or for another account, is not "the same".
    expect(await history.keep({ ...input(2, "<p>بوبنىڭ</p>", BOB), reason: "open" })).toBe("kept");
  });

  it("two versions taken in the same millisecond still have an order", async () => {
    const { history } = fresh();
    await history.keep({ ...input(1, "<p>a</p>"), reason: "before-replace-all" });
    await history.keep({ ...input(1, "<p>b</p>"), reason: "before-restore" });
    const listed = await history.list(ALICE, 1);
    expect(listed.ok && listed.versions.map((v) => v.html)).toEqual(["<p>b</p>", "<p>a</p>"]);
  });
});

describe("at most 30 versions of a note", () => {
  it("the oldest automatic versions go first, and the note's newest never", async () => {
    const { history, tick } = fresh();
    await history.keep({ ...input(1, "<p>open</p>"), reason: "open" });
    for (let n = 0; n < MAX_VERSIONS_PER_NOTE; n += 1) {
      tick();
      await history.keep({ ...input(1, `<p>auto ${n}</p>`), reason: "auto" });
    }
    const listed = await history.list(ALICE, 1);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.versions).toHaveLength(MAX_VERSIONS_PER_NOTE);
    // The first automatic one went; the opening one, older still, stayed.
    expect(listed.versions.map((v) => v.html)).not.toContain("<p>auto 0</p>");
    expect(listed.versions.at(-1)?.reason).toBe("open");
    expect(listed.versions[0].html).toBe(`<p>auto ${MAX_VERSIONS_PER_NOTE - 1}</p>`);
  });

  it("with no automatic versions to spare, the oldest of any reason goes", async () => {
    const { history, tick } = fresh();
    const kinds: VersionReason[] = ["open", "before-ai", "before-replace-all", "before-restore", "before-conflict"];
    for (let n = 0; n < MAX_VERSIONS_PER_NOTE + 3; n += 1) {
      tick();
      await history.keep({ ...input(1, `<p>v${n}</p>`), reason: kinds[n % kinds.length] });
    }
    const listed = await history.list(ALICE, 1);
    if (!listed.ok) throw new Error("unavailable");
    expect(listed.versions).toHaveLength(MAX_VERSIONS_PER_NOTE);
    expect(listed.versions.at(-1)?.html).toBe("<p>v3</p>");
    expect(listed.versions[0].html).toBe(`<p>v${MAX_VERSIONS_PER_NOTE + 2}</p>`);
  });

  it("the newest is kept even when it is the only automatic one", async () => {
    const { history, tick } = fresh();
    for (let n = 0; n < MAX_VERSIONS_PER_NOTE; n += 1) {
      tick();
      await history.keep({ ...input(1, `<p>v${n}</p>`), reason: "before-ai" });
    }
    tick();
    expect(await history.keepAuto(input(1, "<p>newest</p>"))).toBe("kept");
    const listed = await history.list(ALICE, 1);
    if (!listed.ok) throw new Error("unavailable");
    expect(listed.versions).toHaveLength(MAX_VERSIONS_PER_NOTE);
    expect(listed.versions[0]).toMatchObject({ reason: "auto", html: "<p>newest</p>" });
    expect(listed.versions.at(-1)?.html).toBe("<p>v1</p>");
  });

  it("another note's versions are not counted against this one", async () => {
    const { history, tick } = fresh();
    for (let n = 0; n < MAX_VERSIONS_PER_NOTE; n += 1) {
      tick();
      await history.keep({ ...input(1, `<p>one ${n}</p>`), reason: "auto" });
      await history.keep({ ...input(2, `<p>two ${n}</p>`), reason: "auto" });
    }
    const usage = await history.measure();
    expect(usage.ok && usage.count).toBe(2 * MAX_VERSIONS_PER_NOTE);
  });
});

describe("at most 20 MB for the whole store", () => {
  /** Big enough that five fit and six do not. */
  const BIG = 2_000_000;
  const big = (label: string) => `<p>${label}</p>${"ا".repeat(BIG)}`;

  it("evicts the oldest automatic versions first, then the oldest of any reason, never a note's newest", async () => {
    const { history, tick } = fresh();
    const size = versionSize({ title: "خاتىرە", html: big("A-open") });
    expect(5 * size).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
    expect(6 * size).toBeGreaterThan(MAX_HISTORY_BYTES);

    const keep = async (noteId: number, label: string, reason: VersionReason) => {
      tick();
      return history.keep({ ...input(noteId, big(label)), reason });
    };
    await keep(1, "A-open", "open");
    await keep(1, "A-auto", "auto");
    await keep(1, "A-ai", "before-ai"); // A's newest
    await keep(2, "B-auto", "auto");
    await keep(2, "B-open", "open"); // B's newest — five, the store is full

    // Sixth: the oldest automatic version that is not a note's newest goes.
    await keep(3, "C-open", "open");
    expect(await reasons(history, 1)).toEqual(["before-ai:<p>A-ai</p>ا", "open:<p>A-open</p"]);

    // Seventh: B's automatic one, the oldest left.
    await keep(3, "C-auto", "auto"); // C's newest
    expect(await reasons(history, 2)).toEqual(["open:<p>B-open</p"]);

    // Eighth: no automatic version to spare (C's is its newest), so the
    // oldest of any reason — A's opening version.
    await keep(4, "D-open", "open");
    expect(await reasons(history, 1)).toEqual(["before-ai:<p>A-ai</p>ا"]);

    // Ninth: A's version is A's newest now and stays; C's opening one goes.
    await keep(5, "E-open", "open");
    expect(await reasons(history, 1)).toEqual(["before-ai:<p>A-ai</p>ا"]);
    expect(await reasons(history, 3)).toEqual(["auto:<p>C-auto</p"]);

    // Tenth: every version left is some note's newest. Nothing is thrown
    // away, even over the limit — losing the last copy of a note is worse.
    await keep(6, "F-open", "open");
    for (const noteId of [1, 2, 3, 4, 5, 6]) {
      const listed = await history.list(ALICE, noteId);
      expect(listed.ok && listed.versions.length, `note ${noteId} keeps its newest`).toBe(1);
    }
    const left = ["A-ai", "B-open", "C-auto", "D-open", "E-open", "F-open"];
    const usage = await history.measure();
    expect(usage).toEqual({
      ok: true,
      bytes: left.reduce((sum, label) => sum + versionSize({ title: "خاتىرە", html: big(label) }), 0),
      count: 6,
    });
  });

  it("the size it reports is the sum of what it holds, and goes down when versions go", async () => {
    const { history, tick } = fresh();
    const a = input(1, "<p>بىر</p>");
    const b = input(1, "<p>ئىككى</p>");
    await history.keep({ ...a, reason: "open" });
    tick();
    await history.keep({ ...b, reason: "auto" });
    expect(await history.measure()).toEqual({ ok: true, bytes: versionSize(a) + versionSize(b), count: 2 });
  });
});

describe("clearAll", () => {
  it("removes every version of every note and account", async () => {
    const { history, tick } = fresh();
    await history.keep({ ...input(1, "<p>a</p>"), reason: "open" });
    tick();
    await history.keep({ ...input(2, "<p>b</p>", BOB), reason: "auto" });
    expect(await history.clearAll()).toBe(true);
    expect(await history.measure()).toEqual({ ok: true, bytes: 0, count: 0 });
    expect(await history.list(ALICE, 1)).toEqual({ ok: true, versions: [] });
    // And it carries on working afterwards.
    expect(await history.keep({ ...input(1, "<p>a</p>"), reason: "open" })).toBe("kept");
  });

  it("forgetNoteHistory empties it, and never waits longer than it was given", async () => {
    const { history } = fresh();
    await history.keep({ ...input(1, "<p>a</p>"), reason: "open" });
    await forgetNoteHistory(1000, history);
    expect(await history.measure()).toEqual({ ok: true, bytes: 0, count: 0 });

    const stuck: NoteHistory = { ...history, clearAll: () => new Promise<boolean>(() => {}) };
    const started = Date.now();
    await forgetNoteHistory(50, stuck);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("every failure is an answer, never an exception", () => {
  async function expectUnavailable(history: NoteHistory) {
    await expect(history.keep({ ...input(1, "<p>a</p>"), reason: "open" })).resolves.toBe("unavailable");
    await expect(history.keepAuto(input(1, "<p>a</p>"))).resolves.toBe("unavailable");
    await expect(history.list(ALICE, 1)).resolves.toEqual({ ok: false });
    await expect(history.measure()).resolves.toEqual({ ok: false });
    await expect(history.clearAll()).resolves.toBe(false);
    await expect(forgetNoteHistory(1000, history)).resolves.toBeUndefined();
  }

  it("no IndexedDB at all", async () => {
    await expectUnavailable(createNoteHistory({ indexedDB: () => undefined, now: Date.now }));
  });

  it("touching IndexedDB throws (a private window, blocked site data)", async () => {
    await expectUnavailable(
      createNoteHistory({
        indexedDB: () => {
          throw new DOMException("The user denied permission to access the database.", "SecurityError");
        },
        now: Date.now,
      }),
    );
  });

  it("opening the database throws", async () => {
    const factory = {
      open: () => {
        throw new DOMException("blocked", "InvalidStateError");
      },
    } as unknown as IDBFactory;
    await expectUnavailable(createNoteHistory({ indexedDB: () => factory, now: Date.now }));
  });

  it("opening the database fails", async () => {
    const factory = {
      open: () => {
        const request = {} as IDBOpenDBRequest & { onerror: (() => void) | null };
        setTimeout(() => request.onerror?.(), 0);
        return request;
      },
    } as unknown as IDBFactory;
    await expectUnavailable(createNoteHistory({ indexedDB: () => factory, now: Date.now }));
  });

  it("a database that never answers is given up on", async () => {
    vi.useFakeTimers();
    const factory = { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory;
    const history = createNoteHistory({ indexedDB: () => factory, now: Date.now });
    const kept = history.keep({ ...input(1, "<p>a</p>"), reason: "open" });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(kept).resolves.toBe("unavailable");
  });

  it("a database of that name without our stores in it", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(HISTORY_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("something-else");
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    await expectUnavailable(createNoteHistory({ indexedDB: () => factory, now: Date.now }));
  });

  it("anything that goes wrong inside a write leaves what was there", async () => {
    const { history, factory } = fresh();
    await history.keep({ ...input(1, "<p>a</p>"), reason: "open" });
    const refusing = createNoteHistory({
      indexedDB: () => factory,
      now: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    });
    await expect(refusing.keep({ ...input(1, "<p>b</p>"), reason: "before-ai" })).resolves.toBe("unavailable");
    expect(await reasons(history, 1)).toEqual(["open:<p>a</p>"]);
  });
});

describe("an automatic version at most every five minutes", () => {
  it("on fake timers: the first save keeps one, the next only once five minutes have passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 13, 10, 0));
    const factory = new IDBFactory();
    const history = createNoteHistory({ indexedDB: () => factory, now: () => Date.now() });

    expect(await history.keepAuto(input(1, "<p>a</p>"))).toBe("kept");
    vi.advanceTimersByTime(4 * 60_000 + 59_000);
    expect(await history.keepAuto(input(1, "<p>b</p>"))).toBe("recent");
    vi.advanceTimersByTime(1000);
    expect(await history.keepAuto(input(1, "<p>b</p>"))).toBe("kept");

    // Another reason in between does not restart the five minutes …
    vi.advanceTimersByTime(60_000);
    expect(await history.keep({ ...input(1, "<p>c</p>"), reason: "before-ai" })).toBe("kept");
    vi.advanceTimersByTime(AUTO_EVERY_MS - 2 * 60_000);
    expect(await history.keepAuto(input(1, "<p>d</p>"))).toBe("recent");
    vi.advanceTimersByTime(60_000);
    expect(await history.keepAuto(input(1, "<p>d</p>"))).toBe("kept");

    // … the content that is already the newest is not kept again …
    vi.advanceTimersByTime(AUTO_EVERY_MS);
    expect(await history.keepAuto(input(1, "<p>d</p>"))).toBe("same");

    // … and each note keeps its own clock.
    expect(await history.keepAuto(input(2, "<p>x</p>"))).toBe("kept");

    const listed = await history.list(ALICE, 1);
    expect(listed.ok && listed.versions.map((v) => `${v.reason}:${v.html}`)).toEqual([
      "auto:<p>d</p>",
      "before-ai:<p>c</p>",
      "auto:<p>b</p>",
      "auto:<p>a</p>",
    ]);
  });
});
