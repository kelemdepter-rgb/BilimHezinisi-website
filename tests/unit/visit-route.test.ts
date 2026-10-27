import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/visit — one page load of the library (app/api/visit/route.ts). It must
 * count only what lib/visits/count.ts allows, add a device only on the
 * first-of-the-day mark, brake bursts per address, and answer the same empty
 * 204 whatever happened.
 */

const state = vi.hoisted(() => ({
  openings: [] as string[],
  devices: [] as string[],
  limited: new Set<string>(),
  keys: [] as string[],
}));

vi.mock("@/lib/visits/record", () => ({
  recordVisit: (country: string) => {
    state.openings.push(country);
    return Promise.resolve();
  },
  recordDevice: (country: string) => {
    state.devices.push(country);
    return null;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  VISIT_OPENING_RULE: { limit: 120, windowMs: 3_600_000 },
  VISIT_DEVICE_RULE: { limit: 30, windowMs: 3_600_000 },
  callerKey: async () => "203.0.113.9",
  isRateLimited: (key: string) => {
    state.keys.push(key);
    return state.limited.has(key.split(":")[0]);
  },
}));

import { POST } from "@/app/api/visit/route";

const IPHONE_18 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function beacon(path = "/api/visit", headers: Record<string, string> = {}) {
  return new Request(`https://bilimhezinisi.com${path}`, {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      "user-agent": IPHONE_18,
      "x-vercel-ip-country": "TR",
      referer: "https://bilimhezinisi.com/",
      ...headers,
    },
  });
}

beforeEach(() => {
  state.openings = [];
  state.devices = [];
  state.keys = [];
  state.limited = new Set();
  vi.stubEnv("VERCEL_ENV", "production");
});

describe("the page-load signal route", () => {
  it("counts a page opening and answers an empty 204", async () => {
    const response = await POST(beacon());
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.openings).toEqual(["TR"]);
    expect(state.devices).toEqual([]);
    expect(state.keys).toEqual(["visit:203.0.113.9"]);
  });

  it("adds a device on the first-of-the-day mark", async () => {
    await POST(beacon("/api/visit?d=1"));
    expect(state.openings).toEqual(["TR"]);
    expect(state.devices).toEqual(["TR"]);
    expect(state.keys).toEqual(["visit:203.0.113.9", "visit-device:203.0.113.9"]);
  });

  it("counts nothing when the address is braked, and answers the same", async () => {
    state.limited.add("visit");
    const response = await POST(beacon("/api/visit?d=1"));
    expect(response.status).toBe(204);
    expect(state.openings).toEqual([]);
    expect(state.devices).toEqual([]);
  });

  it("still counts the opening when only the device brake is on", async () => {
    state.limited.add("visit-device");
    await POST(beacon("/api/visit?d=1"));
    expect(state.openings).toEqual(["TR"]);
    expect(state.devices).toEqual([]);
  });

  it("answers the same for a staff browser, a program, the admin area or a preview, and counts nothing", async () => {
    for (const request of [
      beacon("/api/visit?d=1", { cookie: "bh_nocount=1" }),
      beacon("/api/visit?d=1", { "user-agent": "curl/8.5.0" }),
      beacon("/api/visit?d=1", { referer: "https://bilimhezinisi.com/admin/visits" }),
      beacon("/api/visit?d=1", { "sec-fetch-site": "cross-site" }),
    ]) {
      expect((await POST(request)).status).toBe(204);
    }
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(beacon("/api/visit?d=1"))).status).toBe(204);
    expect(state.openings).toEqual([]);
    expect(state.devices).toEqual([]);
  });

  it("counts an old iPhone that sends no Sec-Fetch headers, by its Origin", async () => {
    const request = new Request("https://bilimhezinisi.com/api/visit?d=1", {
      method: "POST",
      headers: {
        origin: "https://bilimhezinisi.com",
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
        "x-vercel-ip-country": "KZ",
      },
    });
    expect((await POST(request)).status).toBe(204);
    expect(state.openings).toEqual(["KZ"]);
    expect(state.devices).toEqual(["KZ"]);
  });

  it("counts East Turkistan as East Turkistan", async () => {
    await POST(beacon("/api/visit?d=1", { "x-vercel-ip-country": "CN", "x-vercel-ip-country-region": "XJ" }));
    expect(state.openings).toEqual(["XJ"]);
    expect(state.devices).toEqual(["XJ"]);
  });
});
