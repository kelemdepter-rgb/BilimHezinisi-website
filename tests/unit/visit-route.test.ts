import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/visit — «this device came today» (app/api/visit/route.ts). It must
 * count only what lib/visits/count.ts allows, brake bursts per address, and
 * answer the same empty 204 whatever happened.
 */

const state = vi.hoisted(() => ({ recorded: [] as string[], limited: false, keys: [] as string[] }));

vi.mock("@/lib/visits/record", () => ({
  recordDevice: (country: string) => {
    state.recorded.push(country);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  VISIT_BEACON_RULE: { limit: 30, windowMs: 3_600_000 },
  callerKey: async () => "203.0.113.9",
  isRateLimited: (key: string) => {
    state.keys.push(key);
    return state.limited;
  },
}));

import { POST } from "@/app/api/visit/route";

function beacon(headers: Record<string, string> = {}) {
  return new Request("https://bilimhezinisi.com/api/visit", {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      "x-vercel-ip-country": "TR",
      ...headers,
    },
  });
}

beforeEach(() => {
  state.recorded = [];
  state.keys = [];
  state.limited = false;
  vi.stubEnv("VERCEL_ENV", "production");
});

describe("the device signal route", () => {
  it("counts one device for the country and answers an empty 204", async () => {
    const response = await POST(beacon());
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.recorded).toEqual(["TR"]);
    expect(state.keys).toEqual(["visit:203.0.113.9"]);
  });

  it("answers the same when the address is braked, and counts nothing", async () => {
    state.limited = true;
    const response = await POST(beacon());
    expect(response.status).toBe(204);
    expect(state.recorded).toEqual([]);
  });

  it("answers the same for a staff browser, a program or a preview, and counts nothing", async () => {
    for (const request of [beacon({ cookie: "bh_nocount=1" }), beacon({ "user-agent": "curl/8.5.0" })]) {
      expect((await POST(request)).status).toBe(204);
    }
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(beacon())).status).toBe(204);
    expect(state.recorded).toEqual([]);
  });

  it("counts an old iPhone that sends no Sec-Fetch headers, by its Origin", async () => {
    const request = new Request("https://bilimhezinisi.com/api/visit", {
      method: "POST",
      headers: {
        origin: "https://bilimhezinisi.com",
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
        "x-vercel-ip-country": "KZ",
      },
    });
    expect((await POST(request)).status).toBe(204);
    expect(state.recorded).toEqual(["KZ"]);
  });

  it("counts East Turkistan as East Turkistan", async () => {
    await POST(beacon({ "x-vercel-ip-country": "CN", "x-vercel-ip-country-region": "XJ" }));
    expect(state.recorded).toEqual(["XJ"]);
  });
});
