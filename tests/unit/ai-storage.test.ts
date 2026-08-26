/**
 * The reader's key, where it is kept and what it looks like at rest.
 *
 * Node has no localStorage, so one is stubbed here — which is honest enough,
 * because the module only ever asks for getItem/setItem/removeItem and is
 * written to survive a browser that refuses all three.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  private map = new Map<string, string>();
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
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  /** Everything on disk, as one string — what a casual dump would show. */
  dump() {
    return JSON.stringify([...this.map.entries()]);
  }
}

const storage = new MemoryStorage();
vi.stubGlobal("window", { localStorage: storage });
vi.stubGlobal("localStorage", storage);

const {
  AI_STORAGE_KEYS,
  KEY_SLOT_COUNT,
  bumpUsage,
  clearAiState,
  deobfuscateKey,
  hasAnyKey,
  maskKey,
  obfuscateKey,
  readEnabled,
  readKeySlots,
  readKeys,
  readLastGoodSlot,
  readModel,
  readUsage,
  writeEnabled,
  writeKeys,
  writeLastGoodSlot,
  writeModel,
} = await import("@/lib/ai/storage");

const KEY_A = "AIzaSyExampleKeyNumberOne00000000000001";
const KEY_B = "AQ.ExampleKeyNumberTwo0000000000000002";

beforeEach(() => {
  storage.clear();
  clearAiState();
});

describe("the key at rest", () => {
  it("survives a round trip through the obfuscation", () => {
    expect(deobfuscateKey(obfuscateKey(KEY_A))).toBe(KEY_A);
    expect(deobfuscateKey(obfuscateKey(KEY_B))).toBe(KEY_B);
  });

  it("is not sitting in plain sight in storage", () => {
    writeKeys([KEY_A, KEY_B, null, null]);
    // Not encryption, and never claimed to be — but a glance at the storage
    // panel must not simply read the key off the screen.
    expect(storage.dump()).not.toContain(KEY_A);
    expect(storage.dump()).not.toContain(KEY_B);
    expect(readKeys()[0]).toBe(KEY_A);
    expect(readKeys()[1]).toBe(KEY_B);
  });

  it("is only ever shown as its first four and last four characters", () => {
    const masked = maskKey(KEY_A);
    expect(masked).toBe("AIza…0001");
    expect(masked).not.toContain("Example");
    expect(maskKey("short")).toBe("••••");
    expect(maskKey("")).toBe("");
  });

  it("writes nothing outside the keys it declares", () => {
    writeEnabled(true);
    writeKeys([KEY_A, null, null, null]);
    writeModel("gemini-3.5-flash-lite");
    writeLastGoodSlot(2);
    bumpUsage({ in: 5, out: 9 });

    const written = [...Array(storage.length).keys()].map((index) => storage.key(index));
    for (const key of written) {
      expect(AI_STORAGE_KEYS, `${key} must be declared so erasing can find it`).toContain(key);
    }
  });
});

describe("the four slots", () => {
  it("leaves a slot alone when the field was not retyped", () => {
    writeKeys([KEY_A, KEY_B, null, null]);
    // What the form sends when only the third field was touched.
    writeKeys([null, null, "AIzaThirdKey000000000000000000000003", null]);
    expect(readKeys()[0]).toBe(KEY_A);
    expect(readKeys()[1]).toBe(KEY_B);
    expect(readKeys()[2]).toContain("ThirdKey");
  });

  it("clears a slot on an explicit empty string", () => {
    writeKeys([KEY_A, KEY_B, null, null]);
    writeKeys([null, "", null, null]);
    expect(readKeys()[0]).toBe(KEY_A);
    expect(readKeys()[1]).toBe("");
    expect(readKeySlots()).toHaveLength(1);
  });

  it("ignores duplicates, so a repeated key is not tried twice", () => {
    writeKeys([KEY_A, KEY_A, KEY_B, null]);
    expect(readKeySlots().map((entry) => entry.slot)).toEqual([0, 2]);
  });

  it("forgets the remembered slot when the keys change under it", () => {
    writeKeys([KEY_A, KEY_B, null, null]);
    writeLastGoodSlot(1);
    expect(readLastGoodSlot()).toBe(1);
    // Slot 1 may now hold something else entirely; a stale hint would send the
    // next request at the wrong key first.
    writeKeys([null, "AIzaReplacementKey0000000000000000009", null, null]);
    expect(readLastGoodSlot()).toBeNull();
  });

  it("refuses a slot number that is not one of the four", () => {
    writeLastGoodSlot(KEY_SLOT_COUNT);
    expect(readLastGoodSlot()).toBeNull();
    writeLastGoodSlot(-1);
    expect(readLastGoodSlot()).toBeNull();
  });
});

describe("the defaults", () => {
  it("is off, on the recommended model, with nothing stored", () => {
    expect(readEnabled()).toBe(false);
    expect(hasAnyKey()).toBe(false);
    expect(readModel()).toBe("gemini-3.7-flash");
    expect(readUsage().requests).toBe(0);
  });

  it("falls back to the default model when a stored one is no longer offered", () => {
    storage.setItem("bh-ai-model", "gemini-1.5-flash");
    expect(readModel()).toBe("gemini-3.7-flash");
  });

  it("reads a corrupt key blob as no keys rather than throwing", () => {
    storage.setItem("bh-ai-keys", "{not json at all");
    expect(readKeys()).toEqual(["", "", "", ""]);
    expect(hasAnyKey()).toBe(false);
  });
});

describe("usage", () => {
  it("counts requests and only the tokens Google actually reported", () => {
    bumpUsage({ in: 10, out: 4 });
    bumpUsage({ in: null, out: null });
    const usage = readUsage();
    expect(usage.requests).toBe(2);
    expect(usage.tokensIn).toBe(10);
    expect(usage.tokensOut).toBe(4);
  });

  it("starts again on a new day", () => {
    bumpUsage({ in: 3, out: 3 });
    const stale = JSON.parse(storage.getItem("bh-ai-usage")!) as Record<string, unknown>;
    storage.setItem("bh-ai-usage", JSON.stringify({ ...stale, day: "2000-01-01" }));
    expect(readUsage().requests).toBe(0);
  });
});

describe("erasing", () => {
  it("takes every last thing out", () => {
    writeEnabled(true);
    writeKeys([KEY_A, KEY_B, KEY_A, KEY_B]);
    writeModel("gemini-3.1-pro-preview");
    writeLastGoodSlot(0);
    bumpUsage({ in: 1, out: 1 });

    clearAiState();

    expect(storage.length).toBe(0);
    expect(readEnabled()).toBe(false);
    expect(hasAnyKey()).toBe(false);
    expect(readKeys()).toEqual(["", "", "", ""]);
    expect(readLastGoodSlot()).toBeNull();
    expect(readUsage().requests).toBe(0);
  });
});

describe("a browser that refuses storage", () => {
  it("keeps working instead of breaking the settings page", () => {
    const hostile = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("window", { localStorage: hostile });

    expect(() => writeKeys([KEY_A, null, null, null])).not.toThrow();
    expect(readEnabled()).toBe(false);
    expect(readKeys()).toEqual(["", "", "", ""]);
    expect(() => clearAiState()).not.toThrow();

    vi.stubGlobal("window", { localStorage: storage });
  });
});
