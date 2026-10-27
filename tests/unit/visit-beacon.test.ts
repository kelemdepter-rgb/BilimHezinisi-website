import { describe, expect, it } from "vitest";
import {
  VISIT_BEACON_FIRST_URL,
  VISIT_BEACON_URL,
  VISIT_DAY_KEY,
  sendPageSignal,
  type BeaconEnvironment,
} from "@/lib/visits/beacon";

/**
 * The browser's half of the tally (lib/visits/beacon.ts): one signal per page
 * load, marked as a device at most once per UTC day, nothing kept but that
 * date, nothing at all from staff or the admin area.
 */

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function setup(overrides: Partial<BeaconEnvironment> = {}, accept = true) {
  const sent: string[] = [];
  const storage = memoryStorage();
  const env: BeaconEnvironment = {
    storage,
    today: "2026-10-27",
    cookie: "",
    path: "/",
    online: true,
    send: (url) => {
      sent.push(url);
      return accept;
    },
    ...overrides,
  };
  return { env, sent, storage };
}

describe("the page signal", () => {
  it("is sent on every page load; only the first of the day is marked as a device", () => {
    const { env, sent, storage } = setup();
    expect(sendPageSignal(env)).toEqual({ sent: true, device: true });
    expect(sendPageSignal(env)).toEqual({ sent: true, device: false });
    expect(sendPageSignal(env)).toEqual({ sent: true, device: false });
    expect(sent).toEqual([VISIT_BEACON_FIRST_URL, VISIT_BEACON_URL, VISIT_BEACON_URL]);
    expect(storage.data.get(VISIT_DAY_KEY)).toBe("2026-10-27");
  });

  it("is marked as a device again on the next day", () => {
    const { env, sent } = setup();
    sendPageSignal(env);
    sendPageSignal({ ...env, today: "2026-10-28" });
    expect(sent).toEqual([VISIT_BEACON_FIRST_URL, VISIT_BEACON_FIRST_URL]);
  });

  it("keeps nothing but the date", () => {
    const { env, storage } = setup();
    sendPageSignal(env);
    sendPageSignal(env);
    expect([...storage.data.keys()]).toEqual([VISIT_DAY_KEY]);
  });

  it("is not sent from a staff browser", () => {
    const { env, sent } = setup({ cookie: "theme=dark; bh_nocount=1" });
    expect(sendPageSignal(env)).toEqual({ sent: false, device: false });
    expect(sent).toHaveLength(0);
  });

  it.each(["/admin", "/admin/visits", "/admin/books/new"])("is not sent from the admin area (%s), nor marks the day", (path) => {
    const { env, sent, storage } = setup({ path });
    expect(sendPageSignal(env)).toEqual({ sent: false, device: false });
    expect(sent).toHaveLength(0);
    expect(storage.data.has(VISIT_DAY_KEY)).toBe(false);
  });

  it("is sent from a reader's page whose name merely starts like it", () => {
    const { env, sent } = setup({ path: "/administration" });
    expect(sendPageSignal(env).sent).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("is not sent offline, and the day stays unclaimed", () => {
    const { env, sent, storage } = setup({ online: false });
    expect(sendPageSignal(env)).toEqual({ sent: false, device: false });
    expect(sent).toHaveLength(0);
    expect(storage.data.has(VISIT_DAY_KEY)).toBe(false);
  });

  it("still counts the opening where storage is out of reach, never as a device", () => {
    const { env, sent } = setup({ storage: null });
    expect(sendPageSignal(env)).toEqual({ sent: true, device: false });
    expect(sendPageSignal(env)).toEqual({ sent: true, device: false });
    expect(sent).toEqual([VISIT_BEACON_URL, VISIT_BEACON_URL]);
  });

  it("never marks a device where storage throws, or accepts the date but does not keep it", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const forgetful = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    for (const storage of [throwing, forgetful]) {
      const { env, sent } = setup({ storage });
      expect(sendPageSignal(env)).toEqual({ sent: true, device: false });
      expect(sent).toEqual([VISIT_BEACON_URL]);
    }
  });

  it("puts the old date back when the browser refuses to queue the signal, so the device is tried again", () => {
    const { env, storage } = setup({}, false);
    storage.data.set(VISIT_DAY_KEY, "2026-10-26");
    expect(sendPageSignal(env)).toEqual({ sent: false, device: false });
    expect(storage.data.get(VISIT_DAY_KEY)).toBe("2026-10-26");

    const fresh = setup({}, false);
    expect(sendPageSignal(fresh.env)).toEqual({ sent: false, device: false });
    expect(fresh.storage.data.has(VISIT_DAY_KEY)).toBe(false);
  });

  it("survives a send that throws", () => {
    const { env } = setup({
      send: () => {
        throw new Error("no beacon here");
      },
    });
    expect(sendPageSignal(env)).toEqual({ sent: false, device: false });
  });
});
