import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_DELAY_MS,
  MIN_SAVE_GAP_MS,
  RETRY_DELAYS_MS,
  SAVE_DEBOUNCE_MS,
  SaveLoop,
  VERSION_CHECK_AFTER_MS,
  findSaveLoop,
  keepSaveLoop,
  realClock,
  resetSaveLoops,
  type NoteContent,
} from "@/lib/notes/save-loop";
import {
  CODE_STATE,
  MAX_SAVE_BYTES,
  SAVE_CODES,
  SAVE_LABEL,
  SAVE_MESSAGES,
  saveFailure,
  type SaveResult,
} from "@/lib/notes/save-protocol";

/**
 * The notebook's save loop (PROMPT-43) on fake timers: every rule about WHEN
 * a note is sent and what the label says, without a browser or a server. The
 * four failures from the audit — a lost last letter of the title (A), a title
 * set in one go never saved (B), a sentence lost by leaving through a link (C)
 * and an `ok: false` followed by closing the tab (D) — are replayed at the
 * bottom against the new loop. Every text here is invented.
 */

const V0 = "2026-10-08T10:00:00.123456+00:00";
const V1 = "2026-10-08T10:00:05.5+00:00";
const V2 = "2026-10-08T10:00:09.000001+00:00";

type Draft = NoteContent & { baseUpdatedAt: string | null; revision: number };
type Request = {
  input: NoteContent & { baseUpdatedAt: string };
  resolve(result: SaveResult): void;
  reject(error: unknown): void;
};

function setup(options: { base?: string | null } = {}) {
  const requests: Request[] = [];
  const env = {
    content: { title: "خاتىرە", html: "<p>بىرىنچى</p>" } as NoteContent,
    online: true,
    visible: true,
    draft: null as Draft | null,
    draftWrites: 0,
    storageFull: false,
    remote: null as string | null,
    versionChecks: 0,
    remoteNewer: [] as string[],
  };
  const loop = new SaveLoop({
    baseUpdatedAt: options.base === undefined ? V0 : options.base,
    clock: realClock,
    send: (input) => new Promise((resolve, reject) => requests.push({ input, resolve, reject })),
    writeDraft: (draft) => {
      if (env.storageFull) return false;
      env.draft = { ...draft };
      env.draftWrites++;
      return true;
    },
    removeDraft: () => {
      env.draft = null;
    },
    isOnline: () => env.online,
    isVisible: () => env.visible,
    checkVersion: async () => {
      env.versionChecks++;
      return env.remote;
    },
  });
  loop.attach({
    read: () => ({ ...env.content }),
    onRemoteNewer: (version) => env.remoteNewer.push(version),
  });

  const write = (html: string) => {
    env.content = { ...env.content, html };
    loop.change();
  };
  const retitle = (title: string) => {
    env.content = { ...env.content, title };
    loop.change();
  };
  const state = () => loop.getSnapshot().state;
  const label = () => SAVE_LABEL[state()];
  /** Answer the oldest request still waiting, and let its handler run. */
  const answer = async (result: SaveResult) => {
    const request = requests.shift();
    if (!request) throw new Error("no request is waiting");
    request.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
  };
  const drop = async () => {
    const request = requests.shift();
    if (!request) throw new Error("no request is waiting");
    request.reject(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);
  };
  const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  return { loop, env, requests, write, retitle, state, label, answer, drop, wait };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSaveLoops();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("when a save is sent", () => {
  it("waits 1.2 s after the last change, and restarts the wait on every change", async () => {
    const t = setup();
    t.write("<p>ب</p>");
    expect(t.label()).toBe("ئۆزگەردى…");
    await t.wait(SAVE_DEBOUNCE_MS - 100);
    t.write("<p>بى</p>");
    await t.wait(SAVE_DEBOUNCE_MS - 100);
    expect(t.requests).toHaveLength(0);
    await t.wait(100);
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].input.html).toBe("<p>بى</p>");
    expect(t.label()).toBe("ساقلىنىۋاتىدۇ…");
  });

  it("keeps at least 3 s between two saves", async () => {
    const t = setup();
    t.write("<p>1</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    const first = Date.now();
    await t.answer({ ok: true, updatedAt: V1 });
    t.write("<p>2</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    // The debounce is over but the gap is not.
    expect(t.requests).toHaveLength(0);
    await t.wait(MIN_SAVE_GAP_MS - SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(1);
    expect(Date.now() - first).toBeGreaterThanOrEqual(MIN_SAVE_GAP_MS);
  });

  it("has at most one save in flight", async () => {
    const t = setup();
    t.write("<p>1</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(1);
    t.write("<p>2</p>");
    await t.wait(10 * MIN_SAVE_GAP_MS);
    expect(t.requests).toHaveLength(1);
  });

  it("sends at once when the page is hidden, before the debounce would have", async () => {
    const t = setup();
    t.write("<p>سەپەر</p>");
    t.env.visible = false;
    t.loop.visibility(false);
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].input.html).toBe("<p>سەپەر</p>");
    // And the copy on this device was written synchronously, not 300 ms later.
    expect(t.env.draft?.html).toBe("<p>سەپەر</p>");
  });

  it("sends at once when the editor goes away, and a late answer still lands safely", async () => {
    const t = setup();
    t.write("<p>مۇھىم جۈملە</p>");
    t.loop.detach();
    expect(t.requests).toHaveLength(1);
    expect(t.env.draft?.html).toBe("<p>مۇھىم جۈملە</p>");
    // The answer arrives after the page has changed.
    await t.answer({ ok: true, updatedAt: V1 });
    expect(t.label()).toBe("ساقلاندى");
    expect(t.env.draft).toBeNull();
    expect(t.loop.content().html).toBe("<p>مۇھىم جۈملە</p>");
  });

  it("an edit made during a save is sent as soon as that save returns, even after leaving", async () => {
    const t = setup();
    t.write("<p>1</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    t.write("<p>12</p>");
    t.loop.detach();
    expect(t.requests).toHaveLength(1);
    await t.answer({ ok: true, updatedAt: V1 });
    // Leaving asked for the newest text; the gap does not hold it back.
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].input).toEqual({ title: "خاتىرە", html: "<p>12</p>", baseUpdatedAt: V1 });
  });

  it("never sends from a page that is offline; says so and keeps the copy", async () => {
    const t = setup();
    t.env.online = false;
    t.write("<p>ئۇلىنىشسىز</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(0);
    expect(t.label()).toBe("ئۇلىنىش يوق — بۇ ئۈسكۈنىدە ساقلاندى");
    expect(t.env.draft?.html).toBe("<p>ئۇلىنىشسىز</p>");
  });
});

describe("the copy on this device", () => {
  it("is written within 300 ms of every change", async () => {
    const t = setup();
    t.write("<p>a</p>");
    expect(t.env.draft).toBeNull();
    await t.wait(DRAFT_DELAY_MS);
    expect(t.env.draft).toMatchObject({ html: "<p>a</p>", baseUpdatedAt: V0, revision: 1 });
  });

  it("is removed only when the save confirmed the revision on screen (N2b)", async () => {
    const t = setup();
    t.write("<p>بىر جۈملە</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    // Something is inserted while the save is on its way.
    t.write("<p>بىر جۈملە</p><blockquote>نەقىل</blockquote>");
    await t.answer({ ok: true, updatedAt: V1 });

    // That save confirmed the sentence, not the quotation: nothing may say
    // «ساقلاندى», and the copy stays.
    expect(t.label()).toBe("ئۆزگەردى…");
    expect(t.env.draft?.html).toContain("نەقىل");

    await t.wait(MIN_SAVE_GAP_MS);
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].input.html).toContain("نەقىل");
    expect(t.requests[0].input.baseUpdatedAt).toBe(V1);
    await t.answer({ ok: true, updatedAt: V2 });
    expect(t.label()).toBe("ساقلاندى");
    expect(t.env.draft).toBeNull();
  });

  it("says once that it could not be written, and the loop carries on", async () => {
    const t = setup();
    t.env.storageFull = true;
    t.write("<p>a</p>");
    await t.wait(DRAFT_DELAY_MS);
    expect(t.loop.getSnapshot().storageFailed).toBe(true);
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(1);
  });
});

describe("the title", () => {
  it("is read when the save is sent, not when the timer was set", async () => {
    const t = setup();
    t.retitle("تار");
    await t.wait(500);
    t.env.content = { ...t.env.content, title: "تارىخ" };
    // No change() for the last letter on purpose: whatever is on screen when
    // the timer fires is what goes.
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests[0].input.title).toBe("تارىخ");
  });
});

describe("failures", () => {
  it("retries after 5 s, 15 s, 45 s and then every minute while visible", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.answer(saveFailure("failed"));
    expect(t.label()).toBe("ساقلانمىدى — بۇ ئۈسكۈنىدە ساقلاندى، قايتا سىنايدۇ");
    expect(t.env.draft?.html).toBe("<p>a</p>");

    for (const delay of [...RETRY_DELAYS_MS, 60_000, 60_000]) {
      await t.wait(delay - 1);
      expect(t.requests, `nothing before ${delay} ms`).toHaveLength(0);
      await t.wait(1);
      expect(t.requests, `a retry at ${delay} ms`).toHaveLength(1);
      await t.answer(saveFailure("failed"));
    }
  });

  it("a request that never got an answer is «offline», and retries the same way", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.drop();
    expect(t.state()).toBe("offline");
    await t.wait(RETRY_DELAYS_MS[0]);
    expect(t.requests).toHaveLength(1);
  });

  it("retries at once when the connection comes back", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.drop();
    await t.wait(MIN_SAVE_GAP_MS);
    t.loop.online();
    expect(t.requests).toHaveLength(1);
  });

  it("waits while hidden, and retries the moment the page is shown again", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.drop();
    t.env.visible = false;
    t.loop.visibility(false);
    await t.wait(10 * 60_000);
    expect(t.requests).toHaveLength(0);
    t.env.visible = true;
    t.loop.visibility(true);
    expect(t.requests).toHaveLength(1);
  });

  it("«ھازىر قايتا سىناش» sends without waiting for the schedule", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.answer(saveFailure("failed"));
    await t.wait(RETRY_DELAYS_MS[0]);
    await t.answer(saveFailure("failed"));
    // The next scheduled retry is 15 s away.
    await t.wait(MIN_SAVE_GAP_MS);
    t.loop.retryNow();
    expect(t.requests).toHaveLength(1);
    await t.answer({ ok: true, updatedAt: V1 });
    expect(t.label()).toBe("ساقلاندى");
    expect(t.env.draft).toBeNull();
  });

  it("writing while a retry is pending does not send early; the retry sends the newest text", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.answer(saveFailure("failed"));
    t.write("<p>ab</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(0);
    expect(t.env.draft?.html).toBe("<p>ab</p>");
    await t.wait(RETRY_DELAYS_MS[0] - SAVE_DEBOUNCE_MS);
    expect(t.requests[0].input.html).toBe("<p>ab</p>");
  });

  it("never sends a note over 900 KB, says why, keeps the copy, and the next edit tries again", async () => {
    const t = setup();
    const huge = `<p style="color: red">${"ئا".repeat(MAX_SAVE_BYTES / 4 + 1)}</p>`;
    t.write(huge);
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(0);
    expect(t.loop.getSnapshot()).toMatchObject({ state: "blocked", code: "too_large" });
    expect(t.env.draft?.html).toBe(huge);
    await t.wait(10 * 60_000);
    expect(t.requests).toHaveLength(0);

    t.write("<p>كىچىك</p>");
    expect(t.label()).toBe("ئۆزگەردى…");
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(1);
  });

  it.each(SAVE_CODES)("«%s» leads to its state, its label and its message", async (code) => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.answer(saveFailure(code, code === "conflict" ? V2 : undefined));
    const snapshot = t.loop.getSnapshot();
    expect(snapshot.state).toBe(CODE_STATE[code]);
    expect(snapshot.code).toBe(code);
    expect(SAVE_LABEL[snapshot.state]).not.toBe("");
    expect(SAVE_LABEL[snapshot.state]).not.toBe("ساقلاندى");
    expect(SAVE_MESSAGES[code]).toMatch(/[ئ-ۆ]/);
    // Whatever the refusal, the writing is on this device.
    expect(t.env.draft?.html).toBe("<p>a</p>");
  });

  it("a blocked note does not retry by itself; the next edit does", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.answer(saveFailure("needs_account"));
    await t.wait(10 * 60_000);
    expect(t.requests).toHaveLength(0);
    t.write("<p>ab</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests).toHaveLength(1);
  });
});

describe("two versions of one note (N5)", () => {
  async function inConflict() {
    const t = setup();
    t.write("<p>مېنىڭ</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.answer(saveFailure("conflict", V2));
    return t;
  }

  it("a conflict pauses sending but keeps the copy up to date", async () => {
    const t = await inConflict();
    expect(t.loop.getSnapshot()).toMatchObject({ state: "conflict", serverUpdatedAt: V2 });
    t.write("<p>مېنىڭ نۇسخام</p>");
    await t.wait(10 * 60_000);
    expect(t.requests).toHaveLength(0);
    expect(t.state()).toBe("conflict");
    // Written on the version it came from — a later open must ask again.
    expect(t.env.draft).toMatchObject({ html: "<p>مېنىڭ نۇسخام</p>", baseUpdatedAt: V0 });
  });

  it("«مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا قويۇش» saves over the server's version, at once", async () => {
    const t = await inConflict();
    t.loop.keepMine();
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].input.baseUpdatedAt).toBe(V2);
    await t.answer({ ok: true, updatedAt: "2026-10-08T10:01:00.2+00:00" });
    expect(t.label()).toBe("ساقلاندى");
  });

  it("adopting the server's version leaves the editor clean and the copy gone", async () => {
    const t = await inConflict();
    t.loop.adopt(V2);
    expect(t.label()).toBe("ساقلاندى");
    expect(t.env.draft).toBeNull();
    expect(t.loop.hasUnsent()).toBe(false);
    t.write("<p>يېڭى</p>");
    await t.wait(MIN_SAVE_GAP_MS);
    expect(t.requests[0].input.baseUpdatedAt).toBe(V2);
  });

  it("an answer to a save made before the document was replaced is ignored", async () => {
    const t = setup();
    t.write("<p>a</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    t.loop.adopt(V2);
    await t.answer({ ok: true, updatedAt: V1 });
    expect(t.loop.baseVersion()).toBe(V2);
    expect(t.requests).toHaveLength(0);
  });

  it("opened on a copy of an unknown version: shows it, sends nothing", async () => {
    // The loop starts on the server's version; the copy's own (unknown) base
    // is what its device copy keeps.
    const t = setup({ base: V1 });
    expect(t.loop.conflictOnOpen(V1, null)).toBe(true);
    expect(t.env.draft).toMatchObject({ baseUpdatedAt: null });
    await t.wait(10 * 60_000);
    expect(t.requests).toHaveLength(0);
    t.loop.keepMine();
    expect(t.requests[0].input.baseUpdatedAt).toBe(V1);
  });

  it("opened on a copy of an older version: the copy keeps that version", () => {
    const t = setup({ base: V2 });
    t.loop.conflictOnOpen(V2, V0);
    expect(t.env.draft).toMatchObject({ baseUpdatedAt: V0 });
    expect(t.loop.getSnapshot()).toMatchObject({ state: "conflict", serverUpdatedAt: V2 });
  });

  it("opened on a copy of the same version: sends it at once", () => {
    const t = setup();
    t.loop.restore();
    expect(t.requests).toHaveLength(1);
    expect(t.label()).toBe("ساقلىنىۋاتىدۇ…");
  });

  describe("coming back to a tab after a while", () => {
    async function hiddenFor(t: ReturnType<typeof setup>, ms: number) {
      t.env.visible = false;
      t.loop.visibility(false);
      await t.wait(ms);
      t.env.visible = true;
      t.loop.visibility(true);
      await t.wait(0);
    }

    it("asks for the version only after a minute away", async () => {
      const t = setup();
      t.env.remote = V2;
      await hiddenFor(t, VERSION_CHECK_AFTER_MS - 1000);
      expect(t.env.versionChecks).toBe(0);
      await hiddenFor(t, VERSION_CHECK_AFTER_MS);
      expect(t.env.versionChecks).toBe(1);
    });

    it("newer elsewhere and nothing unsaved here: the editor is told to load it", async () => {
      const t = setup();
      t.env.remote = V2;
      await hiddenFor(t, VERSION_CHECK_AFTER_MS);
      expect(t.env.remoteNewer).toEqual([V2]);
      expect(t.state()).not.toBe("conflict");
    });

    it("newer elsewhere and unsaved changes here: a conflict", async () => {
      const t = setup();
      t.write("<p>بۇ يەردە</p>");
      await t.wait(SAVE_DEBOUNCE_MS);
      // Signed out meanwhile: the text stays unsaved, and nothing retries.
      await t.answer(saveFailure("needs_account"));
      t.env.remote = V2;
      await hiddenFor(t, VERSION_CHECK_AFTER_MS);
      expect(t.loop.getSnapshot()).toMatchObject({ state: "conflict", serverUpdatedAt: V2 });
      expect(t.env.remoteNewer).toEqual([]);
    });

    it("a save in flight when the tab comes back answers for itself", async () => {
      const t = setup();
      t.write("<p>a</p>");
      await t.wait(SAVE_DEBOUNCE_MS);
      t.env.remote = V2;
      await hiddenFor(t, VERSION_CHECK_AFTER_MS);
      expect(t.env.versionChecks).toBe(0);
      await t.answer(saveFailure("conflict", V2));
      expect(t.state()).toBe("conflict");
    });

    it("the same version: nothing happens", async () => {
      const t = setup();
      t.env.remote = V0;
      await hiddenFor(t, VERSION_CHECK_AFTER_MS);
      expect(t.env.remoteNewer).toEqual([]);
      expect(t.state()).toBe("idle");
    });
  });
});

describe("one loop per note in a tab", () => {
  it("is found again, and idle ones make room", () => {
    const loops = Array.from({ length: 10 }, (_, index) => {
      const loop = setup().loop;
      loop.detach();
      keepSaveLoop(`u:${index}`, loop);
      return loop;
    });
    expect(findSaveLoop("u:9")).toBe(loops[9]);
    expect(findSaveLoop("u:0")).toBeUndefined();
  });

  it("a busy one is never forgotten to make room", () => {
    const busy = setup();
    busy.write("<p>a</p>");
    busy.loop.detach();
    keepSaveLoop("busy", busy.loop);
    for (let index = 0; index < 20; index++) {
      const loop = setup().loop;
      loop.detach();
      keepSaveLoop(`u:${index}`, loop);
    }
    expect(findSaveLoop("busy")).toBe(busy.loop);
  });
});

/**
 * The audit's four failures (AUDIT-2026-10-07, PROMPT-43's table), replayed
 * the way the old editor met them.
 */
describe("scenarios A–D from the audit", () => {
  it("A: a title typed letter by letter is saved whole", async () => {
    const t = setup();
    for (const title of ["ت", "تا", "تار", "تارى", "تارىخ"]) {
      t.retitle(title);
      await t.wait(80);
    }
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests[0].input.title).toBe("تارىخ");
  });

  it("B: a title set in one change is saved", async () => {
    const t = setup();
    t.retitle("دەرس پىلانى");
    await t.wait(SAVE_DEBOUNCE_MS);
    expect(t.requests[0].input.title).toBe("دەرس پىلانى");
  });

  it("C: typed, then the in-app back link 0.5 s later — sent, and kept on the device", async () => {
    const t = setup();
    t.write("<p>مۇھىم جۈملە</p>");
    await t.wait(500);
    t.loop.detach();
    expect(t.requests.map((request) => request.input.html)).toEqual(["<p>مۇھىم جۈملە</p>"]);
    expect(t.env.draft?.html).toBe("<p>مۇھىم جۈملە</p>");
  });

  it("D: the server said no, then the tab closed — the copy is there and a retry is due", async () => {
    const t = setup();
    t.write("<p>مۇھىم جۈملە</p>");
    await t.wait(SAVE_DEBOUNCE_MS);
    await t.answer(saveFailure("failed"));
    t.loop.flush(); // pagehide
    expect(t.state()).toBe("retrying");
    expect(t.env.draft?.html).toBe("<p>مۇھىم جۈملە</p>");
    await t.wait(RETRY_DELAYS_MS[0]);
    expect(t.requests).toHaveLength(1);
  });
});
