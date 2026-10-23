import { describe, expect, it } from "vitest";
import {
  EAST_TURKISTAN,
  countedDeviceCountry,
  countedVisitCountry,
  createVisitBatcher,
  hasNoCountCookie,
  isPreFetchMetadataWebKit,
  type VisitBatch,
} from "@/lib/visits/count";

/**
 * The rules for «which countries is the library opened from» (migration 0033):
 * what counts as a page opening, and how openings are gathered into few
 * database calls. Nothing here may ever need more than a country code.
 */

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36";

function request(overrides: {
  method?: string;
  pathname?: string;
  environment?: string | undefined;
  headers?: Record<string, string | null>;
} = {}) {
  const headers = new Headers();
  const given: Record<string, string | null> = {
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "user-agent": BROWSER,
    "x-vercel-ip-country": "TR",
    ...overrides.headers,
  };
  for (const [name, value] of Object.entries(given)) if (value !== null) headers.set(name, value);
  return {
    method: overrides.method ?? "GET",
    pathname: overrides.pathname ?? "/",
    headers,
    environment: "environment" in overrides ? overrides.environment : "production",
  };
}

describe("which requests count", () => {
  it("counts a browser opening a page, under its country", () => {
    expect(countedVisitCountry(request())).toBe("TR");
    expect(countedVisitCountry(request({ pathname: "/book/12", headers: { "x-vercel-ip-country": "DE" } }))).toBe("DE");
  });

  it("counts only the production deployment", () => {
    for (const environment of [undefined, "preview", "development"]) {
      expect(countedVisitCountry(request({ environment }))).toBeNull();
    }
  });

  it("does not count anything but a GET", () => {
    expect(countedVisitCountry(request({ method: "POST" }))).toBeNull();
    expect(countedVisitCountry(request({ method: "HEAD" }))).toBeNull();
  });

  it.each(["/api/health", "/api/books/1/download", "/auth/callback", "/admin", "/admin/books"])(
    "does not count %s",
    (pathname) => {
      expect(countedVisitCountry(request({ pathname }))).toBeNull();
    },
  );

  it("does not mistake a page that merely starts with those letters for them", () => {
    expect(countedVisitCountry(request({ pathname: "/administration" }))).toBe("TR");
    expect(countedVisitCountry(request({ pathname: "/authors" }))).toBe("TR");
    expect(countedVisitCountry(request({ pathname: "/apix" }))).toBe("TR");
  });

  it("counts a full navigation only — not the app's own fetches", () => {
    expect(countedVisitCountry(request({ headers: { "sec-fetch-dest": "empty" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { "sec-fetch-mode": "cors" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { "sec-fetch-dest": null, "sec-fetch-mode": null } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { "sec-fetch-dest": "iframe" } }))).toBeNull();
  });

  it("does not count a page a browser fetched ahead of time", () => {
    expect(countedVisitCountry(request({ headers: { "sec-purpose": "prefetch;prerender" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { "sec-purpose": "prefetch" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { purpose: "prefetch" } }))).toBeNull();
  });

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1)",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/151.0 Safari/537.36",
    "facebookexternalhit/1.1",
    "curl/8.5.0",
    "python-requests/2.32",
    "Mozilla/5.0 Chrome-Lighthouse",
    "UptimeRobot/2.0",
    "",
  ])("does not count the program %j", (agent) => {
    expect(countedVisitCountry(request({ headers: { "user-agent": agent } }))).toBeNull();
  });

  it.each(["iPhone", "Android", "Firefox", "Edge"])("counts a real %s browser", (name) => {
    const agents: Record<string, string> = {
      iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      Android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36",
      Firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0",
      Edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36 Edg/151.0",
    };
    expect(countedVisitCountry(request({ headers: { "user-agent": agents[name] } }))).toBe("TR");
  });

  it("needs a country it can trust: two capital letters, nothing else", () => {
    for (const value of [null, "", "tr", "T1", "XXX", "T", "<script>", "T R"]) {
      expect(countedVisitCountry(request({ headers: { "x-vercel-ip-country": value } }))).toBeNull();
    }
  });
});

describe("staff are not counted", () => {
  it("skips a browser carrying the no-count flag", () => {
    expect(countedVisitCountry(request({ headers: { cookie: "bh_nocount=1" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { cookie: "theme=sepia; bh_nocount=1; x=y" } }))).toBeNull();
  });

  it("counts everyone else, whatever other cookies they carry", () => {
    expect(countedVisitCountry(request({ headers: { cookie: "theme=dark; bh_nocount=0; bh_nocountx=1" } }))).toBe("TR");
    expect(hasNoCountCookie(new Headers())).toBe(false);
  });
});

describe("the daily device signal", () => {
  function signal(overrides: { method?: string; environment?: string | undefined; headers?: Record<string, string | null> } = {}) {
    const headers = new Headers();
    const given: Record<string, string | null> = {
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-dest": "empty",
      "user-agent": BROWSER,
      "x-vercel-ip-country": "TR",
      ...overrides.headers,
    };
    for (const [name, value] of Object.entries(given)) if (value !== null) headers.set(name, value);
    return {
      method: overrides.method ?? "POST",
      headers,
      environment: "environment" in overrides ? overrides.environment : "production",
      url: "https://bilimhezinisi.com/api/visit",
    };
  }

  it("counts the beacon from the site's own page", () => {
    expect(countedDeviceCountry(signal())).toBe("TR");
  });

  it("splits East Turkistan from China the same way", () => {
    expect(
      countedDeviceCountry(signal({ headers: { "x-vercel-ip-country": "CN", "x-vercel-ip-country-region": "XJ" } })),
    ).toBe(EAST_TURKISTAN);
  });

  it("counts only a POST, only in production", () => {
    expect(countedDeviceCountry(signal({ method: "GET" }))).toBeNull();
    expect(countedDeviceCountry(signal({ environment: "preview" }))).toBeNull();
    expect(countedDeviceCountry(signal({ environment: undefined }))).toBeNull();
  });

  it("refuses a signal from another site, or with no origin information", () => {
    expect(countedDeviceCountry(signal({ headers: { "sec-fetch-site": "cross-site" } }))).toBeNull();
    expect(countedDeviceCountry(signal({ headers: { "sec-fetch-site": "same-site" } }))).toBeNull();
    expect(countedDeviceCountry(signal({ headers: { "sec-fetch-site": null } }))).toBeNull();
  });

  it("refuses programs and staff browsers", () => {
    expect(countedDeviceCountry(signal({ headers: { "user-agent": "curl/8.5.0" } }))).toBeNull();
    expect(countedDeviceCountry(signal({ headers: { "user-agent": null } }))).toBeNull();
    expect(countedDeviceCountry(signal({ headers: { cookie: "bh_nocount=1" } }))).toBeNull();
  });

  it("needs a country", () => {
    expect(countedDeviceCountry(signal({ headers: { "x-vercel-ip-country": null } }))).toBeNull();
  });
});

describe("Safari before 16.4, which sends no Sec-Fetch headers", () => {
  const IPHONE_15 =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_9 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1";
  const IPHONE_16_3_CHROME =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/112.0 Mobile/15E148 Safari/604.1";
  const IPAD_14 = "Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1";
  const MAC_SAFARI_15 =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";
  const IPHONE_16_4 =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";
  const IPHONE_18 =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const MAC_CHROME_OLD =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0 Safari/537.36";
  const NAVIGATION_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const NO_METADATA = { "sec-fetch-dest": null, "sec-fetch-mode": null, "sec-fetch-site": null };

  it("recognises exactly the browsers that predate Fetch Metadata", () => {
    for (const agent of [IPHONE_15, IPHONE_16_3_CHROME, IPAD_14, MAC_SAFARI_15]) expect(isPreFetchMetadataWebKit(agent)).toBe(true);
    for (const agent of [IPHONE_16_4, IPHONE_18, MAC_CHROME_OLD, BROWSER, ""]) expect(isPreFetchMetadataWebKit(agent)).toBe(false);
  });

  it("counts an old iPhone opening a page", () => {
    for (const agent of [IPHONE_15, IPHONE_16_3_CHROME, IPAD_14, MAC_SAFARI_15]) {
      expect(
        countedVisitCountry(request({ headers: { ...NO_METADATA, "user-agent": agent, accept: NAVIGATION_ACCEPT } })),
      ).toBe("TR");
    }
  });

  it("does not count the service worker's background copy, page data or a prefetch", () => {
    const old = { ...NO_METADATA, "user-agent": IPHONE_15 };
    expect(countedVisitCountry(request({ headers: { ...old, accept: "text/html" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { ...old, accept: "*/*", rsc: "1" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { ...old, accept: NAVIGATION_ACCEPT, rsc: "1" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { ...old, accept: NAVIGATION_ACCEPT, "next-router-prefetch": "1" } }))).toBeNull();
    expect(countedVisitCountry(request({ headers: { ...old, accept: NAVIGATION_ACCEPT, purpose: "prefetch" } }))).toBeNull();
  });

  it("still refuses everyone else who arrives without Sec-Fetch headers", () => {
    for (const agent of [IPHONE_16_4, IPHONE_18, BROWSER, MAC_CHROME_OLD]) {
      expect(
        countedVisitCountry(request({ headers: { ...NO_METADATA, "user-agent": agent, accept: NAVIGATION_ACCEPT } })),
      ).toBeNull();
    }
  });

  it("does not fall back when some Sec-Fetch header is there", () => {
    expect(
      countedVisitCountry(
        request({ headers: { ...NO_METADATA, "sec-fetch-site": "none", "user-agent": IPHONE_15, accept: NAVIGATION_ACCEPT } }),
      ),
    ).toBeNull();
  });

  it("still skips staff and the admin area on an old iPhone", () => {
    const old = { ...NO_METADATA, "user-agent": IPHONE_15, accept: NAVIGATION_ACCEPT };
    expect(countedVisitCountry(request({ headers: { ...old, cookie: "bh_nocount=1" } }))).toBeNull();
    expect(countedVisitCountry(request({ pathname: "/admin", headers: old }))).toBeNull();
  });

  describe("the device signal from an old iPhone", () => {
    function oldSignal(headers: Record<string, string>, agent = IPHONE_15) {
      return {
        method: "POST",
        headers: new Headers({ "user-agent": agent, "x-vercel-ip-country": "TR", ...headers }),
        environment: "production",
        url: "https://bilimhezinisi.com/api/visit",
      };
    }

    it("is counted when its Origin is this site", () => {
      expect(countedDeviceCountry(oldSignal({ origin: "https://bilimhezinisi.com" }))).toBe("TR");
    });

    it("is counted by its Referer when it sends no Origin", () => {
      expect(countedDeviceCountry(oldSignal({ referer: "https://bilimhezinisi.com/books/12" }))).toBe("TR");
    });

    it("is refused from another site, or with nothing to show where it came from", () => {
      expect(countedDeviceCountry(oldSignal({ origin: "https://example.com" }))).toBeNull();
      expect(countedDeviceCountry(oldSignal({ origin: "https://example.com", referer: "https://bilimhezinisi.com/" }))).toBeNull();
      expect(countedDeviceCountry(oldSignal({ referer: "https://bilimhezinisi.com.example.com/" }))).toBeNull();
      expect(countedDeviceCountry(oldSignal({ referer: "not a url" }))).toBeNull();
      expect(countedDeviceCountry(oldSignal({}))).toBeNull();
    });

    it("is refused for a modern browser that leaves Sec-Fetch-Site out", () => {
      expect(countedDeviceCountry(oldSignal({ origin: "https://bilimhezinisi.com" }, IPHONE_18))).toBeNull();
      expect(countedDeviceCountry(oldSignal({ origin: "https://bilimhezinisi.com" }, BROWSER))).toBeNull();
    });
  });
});

describe("East Turkistan, apart from China", () => {
  it.each(["XJ", "xj", "65"])("counts a Chinese address in region %s as East Turkistan", (region) => {
    const counted = countedVisitCountry(
      request({ headers: { "x-vercel-ip-country": "CN", "x-vercel-ip-country-region": region } }),
    );
    expect(counted).toBe(EAST_TURKISTAN);
    expect(counted).toBe("XJ");
  });

  it.each([null, "", "BJ", "GD", "XZ", "11"])("keeps the rest of China as CN (region %j)", (region) => {
    expect(
      countedVisitCountry(request({ headers: { "x-vercel-ip-country": "CN", "x-vercel-ip-country-region": region } })),
    ).toBe("CN");
  });

  it("looks at the region only for China", () => {
    expect(
      countedVisitCountry(request({ headers: { "x-vercel-ip-country": "KZ", "x-vercel-ip-country-region": "XJ" } })),
    ).toBe("KZ");
  });

  it("is a code the tally accepts, and one Vercel never sends for a country", () => {
    expect(EAST_TURKISTAN).toMatch(/^[A-Z]{2}$/);
    // ISO 3166-1 user-assigned range: XA–XZ.
    expect(EAST_TURKISTAN).toMatch(/^X[A-Z]$/);
  });
});

describe("the batcher", () => {
  function setup(options: { flushEveryMs?: number; flushAtCount?: number } = {}) {
    const sent: VisitBatch[] = [];
    let clock = 1_000_000;
    let fail = false;
    const batcher = createVisitBatcher({
      send: async (batch) => {
        sent.push(batch);
        if (fail) throw new Error("database away");
      },
      now: () => clock,
      ...options,
    });
    return {
      sent,
      batcher,
      advance: (ms: number) => void (clock += ms),
      breakDatabase: () => void (fail = true),
    };
  }

  it("sends the first opening at once", async () => {
    const { batcher, sent } = setup();
    const send = batcher.add("TR");
    expect(send).not.toBeNull();
    await send;
    expect(sent).toEqual([{ TR: 1 }]);
  });

  it("holds openings that arrive within the window and sends them with the next one", async () => {
    const { batcher, sent, advance } = setup({ flushEveryMs: 5_000 });
    await batcher.add("TR");
    advance(1_000);
    expect(batcher.add("TR")).toBeNull();
    advance(1_000);
    expect(batcher.add("DE")).toBeNull();
    expect(sent).toHaveLength(1);

    advance(4_000);
    await batcher.add("TR");
    expect(sent).toEqual([{ TR: 1 }, { TR: 2, DE: 1 }]);
  });

  it("sends early once enough are waiting", async () => {
    const { batcher, sent, advance } = setup({ flushEveryMs: 60_000, flushAtCount: 3 });
    await batcher.add("TR");
    advance(10);
    expect(batcher.add("TR")).toBeNull();
    expect(batcher.add("KZ")).toBeNull();
    await batcher.add("TR");
    expect(sent).toEqual([{ TR: 1 }, { TR: 2, KZ: 1 }]);
  });

  it("counts every opening exactly once, however the batches fall", async () => {
    const { batcher, sent, advance } = setup({ flushEveryMs: 5_000, flushAtCount: 4 });
    const countries = ["TR", "DE", "TR", "US", "TR", "KZ", "TR", "TR", "DE", "SA", "TR", "US"];
    for (const country of countries) {
      await batcher.add(country);
      advance(700);
    }
    advance(5_000);
    await batcher.add("TR");

    const total: Record<string, number> = {};
    for (const batch of sent) for (const [country, n] of Object.entries(batch)) total[country] = (total[country] ?? 0) + n;
    expect(total).toEqual({ TR: 7, DE: 2, US: 2, KZ: 1, SA: 1 });
  });

  it("never lets a failed send fail the page", async () => {
    const { batcher, breakDatabase } = setup();
    breakDatabase();
    await expect(batcher.add("TR")).resolves.toBeUndefined();
  });
});
