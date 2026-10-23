import { describe, expect, it } from "vitest";
import { VISIT_BEACON_URL, VISIT_DAY_KEY, sendDailySignal, type BeaconEnvironment } from "@/lib/visits/beacon";

/**
 * «One device, once a day» in the browser (lib/visits/beacon.ts): at most one
 * signal per UTC day, nothing kept but the date, nothing sent when the
 * browser cannot remember that it already sent.
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
    today: "2026-10-23",
    cookie: "",
    online: true,
    send: (url) => {
      sent.push(url);
      return accept;
    },
    ...overrides,
  };
  return { env, sent, storage };
}

describe("the daily signal", () => {
  it("is sent on the first page of the day, to /api/visit, and the date is written down", () => {
    const { env, sent, storage } = setup();
    expect(sendDailySignal(env)).toBe(true);
    expect(sent).toEqual([VISIT_BEACON_URL]);
    expect(storage.data.get(VISIT_DAY_KEY)).toBe("2026-10-23");
  });

  it("is not sent again the same day", () => {
    const { env, sent } = setup();
    sendDailySignal(env);
    sendDailySignal(env);
    sendDailySignal(env);
    expect(sent).toHaveLength(1);
  });

  it("is sent again on the next day", () => {
    const { env, sent } = setup();
    sendDailySignal(env);
    sendDailySignal({ ...env, today: "2026-10-24" });
    expect(sent).toHaveLength(2);
  });

  it("keeps nothing but the date", () => {
    const { env, storage } = setup();
    sendDailySignal(env);
    expect([...storage.data.keys()]).toEqual([VISIT_DAY_KEY]);
  });

  it("is not sent from a staff browser", () => {
    const { env, sent } = setup({ cookie: "theme=dark; bh_nocount=1" });
    expect(sendDailySignal(env)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("is not sent offline, and is tried again once online", () => {
    const { env, sent } = setup({ online: false });
    expect(sendDailySignal(env)).toBe(false);
    expect(sendDailySignal({ ...env, online: true })).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("is not sent where storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const { env, sent } = setup({ storage });
    expect(sendDailySignal(env)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("is not sent where storage accepts the date but does not keep it", () => {
    const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    const { env, sent } = setup({ storage });
    expect(sendDailySignal(env)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("puts the old date back when the browser refuses to queue the signal, so it is tried again", () => {
    const { env, storage } = setup({}, false);
    storage.data.set(VISIT_DAY_KEY, "2026-10-22");
    expect(sendDailySignal(env)).toBe(false);
    expect(storage.data.get(VISIT_DAY_KEY)).toBe("2026-10-22");

    const fresh = setup({}, false);
    expect(sendDailySignal(fresh.env)).toBe(false);
    expect(fresh.storage.data.has(VISIT_DAY_KEY)).toBe(false);
  });
});
