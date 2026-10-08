import { afterEach, describe, expect, it } from "vitest";
import {
  DRAFT_PREFIX,
  clearAccountDrafts,
  draftKey,
  finishPendingDeletion,
  legacyDraftKey,
  readDraft,
  readLegacyDraft,
  rememberPendingDeletion,
  removeDraft,
  writeDraft,
  type DraftRecord,
  type DraftStorage,
} from "@/lib/notes/drafts";
import { decideOpening, type OpeningInput } from "@/lib/notes/opening";
import {
  SAVE_CODES,
  CODE_STATE,
  SAVE_MESSAGES,
  compareVersions,
  normalizeTitle,
  utf8Bytes,
  versionMicros,
} from "@/lib/notes/save-protocol";

/**
 * The notebook's device copies, the decision of what a note opens on, and
 * the small rules both depend on (PROMPT-43). Every text is invented.
 */

class MemoryStorage implements DraftStorage {
  private map = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException("quota", "QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()].sort();
  }
}

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const V0 = "2026-10-08T10:00:00.123456+00:00";
const V1 = "2026-10-08T10:00:05.12+00:00";

function draft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    v: 2,
    userId: USER,
    noteId: 7,
    title: "سەپەر خاتىرىسى",
    html: "<p>يول</p>",
    baseUpdatedAt: V0,
    revision: 3,
    writtenAt: 1,
    tab: "a",
    ...overrides,
  };
}

describe("device copies", () => {
  it("are keyed by account and note", () => {
    expect(draftKey(USER, 7)).toBe(`bh-note-draft-v2:${USER}:7`);
    expect(DRAFT_PREFIX).toBe("bh-note-draft-v2:");
    expect(legacyDraftKey(7)).toBe("bh-note-draft-7");
  });

  it("round-trip, and another account's key never reads as this one", () => {
    const storage = new MemoryStorage();
    expect(writeDraft(storage, draft())).toBe(true);
    expect(readDraft(storage, USER, 7)).toEqual(draft());
    expect(readDraft(storage, OTHER, 7)).toBeNull();
    expect(readDraft(storage, USER, 8)).toBeNull();
  });

  it("refuse a record of the wrong shape", () => {
    const storage = new MemoryStorage();
    storage.setItem(draftKey(USER, 7), JSON.stringify({ ...draft(), v: 1 }));
    expect(readDraft(storage, USER, 7)).toBeNull();
    storage.setItem(draftKey(USER, 7), "{not json");
    expect(readDraft(storage, USER, 7)).toBeNull();
    // A record copied under another account's key is not that account's.
    storage.setItem(draftKey(OTHER, 7), JSON.stringify(draft()));
    expect(readDraft(storage, OTHER, 7)).toBeNull();
  });

  it("a copy from before accounts were in the key is still found by its old key", () => {
    const storage = new MemoryStorage();
    storage.setItem(legacyDraftKey(7), "<p>کونا</p>");
    expect(readLegacyDraft(storage, 7)).toBe("<p>کونا</p>");
    expect(readLegacyDraft(storage, 8)).toBeNull();
    expect(readLegacyDraft(null, 7)).toBeNull();
  });

  it("say so when storage refuses a write, and never throw", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(writeDraft(storage, draft())).toBe(false);
    expect(writeDraft(null, draft())).toBe(false);
    expect(readDraft(null, USER, 7)).toBeNull();
  });

  it("are removed only by the tab that wrote them, when it names itself", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, draft({ tab: "b" }));
    removeDraft(storage, USER, 7, "a");
    expect(readDraft(storage, USER, 7)).not.toBeNull();
    removeDraft(storage, USER, 7, "b");
    expect(readDraft(storage, USER, 7)).toBeNull();
    writeDraft(storage, draft({ tab: "b" }));
    removeDraft(storage, USER, 7);
    expect(readDraft(storage, USER, 7)).toBeNull();
  });

  it("an account's deletion removes its copies and every legacy one — nobody else's", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, draft());
    writeDraft(storage, draft({ noteId: 9 }));
    writeDraft(storage, draft({ userId: OTHER, noteId: 7 }));
    storage.setItem(legacyDraftKey(3), "<p>کونا</p>");
    storage.setItem("bh-personal-dictionary", "[]");
    storage.setItem("bh-note-draft-v2-something-else", "x");

    expect(clearAccountDrafts(storage, USER)).toBe(3);
    expect(storage.keys()).toEqual(
      ["bh-note-draft-v2-something-else", "bh-personal-dictionary", draftKey(OTHER, 7)].sort(),
    );
  });

  describe("after an account deletion", () => {
    const original = (globalThis as { window?: unknown }).window;
    afterEach(() => {
      (globalThis as { window?: unknown }).window = original;
    });

    function browser() {
      const local = new MemoryStorage();
      const session = new MemoryStorage();
      (globalThis as { window?: unknown }).window = { localStorage: local, sessionStorage: session };
      return { local, session };
    }

    it("the confirmation page clears the noted account's copies, once", () => {
      const { local, session } = browser();
      writeDraft(local, draft());
      writeDraft(local, draft({ userId: OTHER }));
      rememberPendingDeletion(USER);
      expect(session.getItem("bh-account-deletion")).toBe(USER);

      finishPendingDeletion();
      expect(readDraft(local, USER, 7)).toBeNull();
      expect(readDraft(local, OTHER, 7)).not.toBeNull();
      expect(session.getItem("bh-account-deletion")).toBeNull();
    });

    it("without a noted deletion nothing is touched (sign-out never clears)", () => {
      const { local } = browser();
      writeDraft(local, draft());
      finishPendingDeletion();
      expect(readDraft(local, USER, 7)).not.toBeNull();
    });
  });
});

describe("what a note opens on", () => {
  const server = { title: "سەپەر خاتىرىسى", html: "<p>يول</p>", updatedAt: V1 };
  const base: OpeningInput = {
    server,
    loop: null,
    draft: null,
    legacyHtml: null,
    sameHtml: (a, b) => a.replace(/\s+/g, "") === b.replace(/\s+/g, ""),
  };

  it("nothing on this device: the server's version", () => {
    expect(decideOpening(base)).toEqual({
      opening: { kind: "server", adopt: false },
      dropDraft: false,
      dropLegacy: false,
    });
  });

  it("a copy of the same version: restored (and saved at once by the editor)", () => {
    const result = decideOpening({ ...base, draft: draft({ baseUpdatedAt: V1, html: "<p>يول، يېڭى</p>" }) });
    expect(result.opening).toEqual({
      kind: "restore",
      content: { title: "سەپەر خاتىرىسى", html: "<p>يول، يېڭى</p>" },
    });
  });

  it("the same version printed differently still counts as the same", () => {
    const sameInstant = "2026-10-08T10:00:05.120000+00:00";
    const result = decideOpening({ ...base, draft: draft({ baseUpdatedAt: sameInstant }) });
    expect(result.opening.kind).toBe("restore");
  });

  it("a copy of an older version that differs: the conflict choice", () => {
    const result = decideOpening({ ...base, draft: draft({ baseUpdatedAt: V0, html: "<p>باشقا</p>" }) });
    expect(result.opening).toEqual({
      kind: "conflict",
      content: { title: "سەپەر خاتىرىسى", html: "<p>باشقا</p>" },
      base: V0,
      fromLegacy: false,
    });
    expect(result.dropDraft).toBe(false);
  });

  it("a copy of an older version that the server already holds: dropped quietly", () => {
    // A save that landed while its answer was lost to a closed tab.
    const result = decideOpening({ ...base, draft: draft({ baseUpdatedAt: V0, html: "<p> يول </p>" }) });
    expect(result).toEqual({ opening: { kind: "server", adopt: false }, dropDraft: true, dropLegacy: false });
  });

  it("a different title alone is still a different version", () => {
    const result = decideOpening({ ...base, draft: draft({ baseUpdatedAt: V0, title: "باشقا ماۋزۇ" }) });
    expect(result.opening.kind).toBe("conflict");
  });

  it("a legacy copy identical to the server: deleted silently", () => {
    expect(decideOpening({ ...base, legacyHtml: "<p>يول</p>" })).toEqual({
      opening: { kind: "server", adopt: false },
      dropDraft: false,
      dropLegacy: true,
    });
  });

  it("a legacy copy that differs: the conflict choice, with no base, kept until it is safe", () => {
    const result = decideOpening({ ...base, legacyHtml: "<p>کونا يېزىق</p>" });
    expect(result).toEqual({
      opening: {
        kind: "conflict",
        content: { title: server.title, html: "<p>کونا يېزىق</p>" },
        base: null,
        fromLegacy: true,
      },
      dropDraft: false,
      dropLegacy: false,
    });
  });

  it("a legacy copy beside a v2 one goes only when it adds nothing", () => {
    const v2 = draft({ baseUpdatedAt: V1, html: "<p>يېڭى</p>" });
    expect(decideOpening({ ...base, draft: v2, legacyHtml: "<p>يېڭى</p>" }).dropLegacy).toBe(true);
    expect(decideOpening({ ...base, draft: v2, legacyHtml: "<p>ئۈچىنچى</p>" }).dropLegacy).toBe(false);
  });

  it("a live loop from earlier in this tab is joined, whatever the page says", () => {
    const stalePage = { ...base, server: { ...server, updatedAt: V0 } };
    expect(decideOpening({ ...stalePage, loop: { busy: false, base: V1 } }).opening).toEqual({ kind: "resume" });
    expect(decideOpening({ ...base, loop: { busy: true, base: V0 } }).opening).toEqual({ kind: "resume" });
    // Clean, and the server moved on elsewhere: the server's version.
    expect(decideOpening({ ...base, loop: { busy: false, base: V0 } }).opening).toEqual({
      kind: "server",
      adopt: true,
    });
  });
});

describe("the rules underneath", () => {
  it("every result code has a state and an Uyghur message", () => {
    for (const code of SAVE_CODES) {
      expect(CODE_STATE[code]).toBeDefined();
      expect(SAVE_MESSAGES[code]).toMatch(/[ئ-ۆ]/);
    }
  });

  it("versions keep their microseconds, and Postgres's trimmed zeros compare right", () => {
    expect(versionMicros("2026-10-08T10:00:05.12+00:00")).toBe(
      versionMicros("2026-10-08T10:00:05.120000+00:00"),
    );
    expect(compareVersions("2026-10-08T10:00:05.123456+00:00", "2026-10-08T10:00:05.123457+00:00")).toBeLessThan(0);
    expect(compareVersions("2026-10-08T10:00:05+00:00", "2026-10-08T10:00:05.000001+00:00")).toBeLessThan(0);
    expect(compareVersions("2026-10-08T13:00:05.5+03:00", "2026-10-08T10:00:05.5+00:00")).toBe(0);
    expect(compareVersions("2026-10-08T10:00:06Z", "2026-10-08T10:00:05.999999+00")).toBeGreaterThan(0);
  });

  it("measures UTF-8 the way the request body will", () => {
    for (const text of ["abc", "ئۇيغۇر", "€", "😀", "a\u{1F600}ب", "\uD800x"]) {
      expect(utf8Bytes(text), text).toBe(Buffer.byteLength(text, "utf8"));
    }
  });

  it("stores the title the way the server does", () => {
    expect(normalizeTitle("  ماۋزۇ  ")).toBe("ماۋزۇ");
    expect(normalizeTitle("   ")).toBe("يېڭى خاتىرە");
    expect(normalizeTitle("ئ".repeat(250))).toHaveLength(200);
  });
});
