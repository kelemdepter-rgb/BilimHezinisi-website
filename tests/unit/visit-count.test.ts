import { describe, expect, it } from "vitest";
import {
  EAST_TURKISTAN,
  countedSignalCountry,
  createVisitBatcher,
  hasNoCountCookie,
  isFirstOfDay,
  isPreFetchMetadataWebKit,
  type VisitBatch,
} from "@/lib/visits/count";

/**
 * The rules for «which countries is the library opened from»: which page-load
 * signals count (lib/visits/count.ts), and how they are gathered into few
 * database calls. Nothing here may ever need more than a country code.
 */

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36";
const URL_PLAIN = "https://bilimhezinisi.com/api/visit";

function signal(
  overrides: { method?: string; environment?: string | undefined; url?: string; headers?: Record<string, string | null> } = {},
) {
  const headers = new Headers();
  const given: Record<string, string | null> = {
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-dest": "empty",
    "user-agent": BROWSER,
    "x-vercel-ip-country": "TR",
    referer: "https://bilimhezinisi.com/books/12",
    ...overrides.headers,
  };
  for (const [name, value] of Object.entries(given)) if (value !== null) headers.set(name, value);
  return {
    method: overrides.method ?? "POST",
    headers,
    environment: "environment" in overrides ? overrides.environment : "production",
    url: overrides.url ?? URL_PLAIN,
  };
}

describe("which signals count", () => {
  it("counts the signal from a page of the site, under its country", () => {
    expect(countedSignalCountry(signal())).toBe("TR");
    expect(countedSignalCountry(signal({ headers: { "x-vercel-ip-country": "DE" } }))).toBe("DE");
  });

  it("counts only a POST, only on the production deployment", () => {
    expect(countedSignalCountry(signal({ method: "GET" }))).toBeNull();
    for (const environment of [undefined, "preview", "development"]) {
      expect(countedSignalCountry(signal({ environment }))).toBeNull();
    }
  });

  it("refuses a signal from another site, or with no origin information", () => {
    expect(countedSignalCountry(signal({ headers: { "sec-fetch-site": "cross-site" } }))).toBeNull();
    expect(countedSignalCountry(signal({ headers: { "sec-fetch-site": "same-site" } }))).toBeNull();
    expect(countedSignalCountry(signal({ headers: { "sec-fetch-site": "none" } }))).toBeNull();
    expect(countedSignalCountry(signal({ headers: { "sec-fetch-site": null } }))).toBeNull();
  });

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1)",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/151.0 Safari/537.36",
    "curl/8.5.0",
    "python-requests/2.32",
    "Mozilla/5.0 Chrome-Lighthouse",
    "",
  ])("refuses the program %j", (agent) => {
    expect(countedSignalCountry(signal({ headers: { "user-agent": agent } }))).toBeNull();
  });

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0",
  ])("counts a real browser %#", (agent) => {
    expect(countedSignalCountry(signal({ headers: { "user-agent": agent } }))).toBe("TR");
  });

  it("refuses staff browsers", () => {
    expect(countedSignalCountry(signal({ headers: { cookie: "bh_nocount=1" } }))).toBeNull();
    expect(countedSignalCountry(signal({ headers: { cookie: "theme=sepia; bh_nocount=1; x=y" } }))).toBeNull();
    expect(countedSignalCountry(signal({ headers: { cookie: "theme=dark; bh_nocount=0; bh_nocountx=1" } }))).toBe("TR");
    expect(hasNoCountCookie(new Headers())).toBe(false);
  });

  it("refuses a signal sent from the admin area, and counts one from a reader's page", () => {
    for (const referer of ["https://bilimhezinisi.com/admin", "https://bilimhezinisi.com/admin/visits?x=1"]) {
      expect(countedSignalCountry(signal({ headers: { referer } }))).toBeNull();
    }
    expect(countedSignalCountry(signal({ headers: { referer: "https://bilimhezinisi.com/administration" } }))).toBe("TR");
    expect(countedSignalCountry(signal({ headers: { referer: null } }))).toBe("TR");
  });

  it("needs a country it can trust: two capital letters, nothing else", () => {
    for (const value of [null, "", "tr", "T1", "XXX", "T", "<script>", "T R"]) {
      expect(countedSignalCountry(signal({ headers: { "x-vercel-ip-country": value } }))).toBeNull();
    }
  });

  it("reads the first-of-the-day mark from the URL only", () => {
    expect(isFirstOfDay("https://bilimhezinisi.com/api/visit?d=1")).toBe(true);
    expect(isFirstOfDay(URL_PLAIN)).toBe(false);
    expect(isFirstOfDay("https://bilimhezinisi.com/api/visit?d=2")).toBe(false);
    expect(isFirstOfDay("not a url")).toBe(false);
  });
});

describe("East Turkistan, apart from China", () => {
  it.each(["XJ", "xj", "65"])("counts a Chinese address in region %s as East Turkistan", (region) => {
    const counted = countedSignalCountry(
      signal({ headers: { "x-vercel-ip-country": "CN", "x-vercel-ip-country-region": region } }),
    );
    expect(counted).toBe(EAST_TURKISTAN);
    expect(counted).toBe("XJ");
  });

  it.each([null, "", "BJ", "GD", "XZ", "11"])("keeps the rest of China as CN (region %j)", (region) => {
    expect(
      countedSignalCountry(signal({ headers: { "x-vercel-ip-country": "CN", "x-vercel-ip-country-region": region } })),
    ).toBe("CN");
  });

  it("looks at the region only for China", () => {
    expect(
      countedSignalCountry(signal({ headers: { "x-vercel-ip-country": "KZ", "x-vercel-ip-country-region": "XJ" } })),
    ).toBe("KZ");
  });

  it("is a code the tally accepts, and one Vercel never sends for a country", () => {
    expect(EAST_TURKISTAN).toMatch(/^[A-Z]{2}$/);
    // ISO 3166-1 user-assigned range: XA–XZ.
    expect(EAST_TURKISTAN).toMatch(/^X[A-Z]$/);
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

  function oldSignal(headers: Record<string, string>, agent = IPHONE_15) {
    return {
      method: "POST",
      headers: new Headers({ "user-agent": agent, "x-vercel-ip-country": "TR", ...headers }),
      environment: "production",
      url: URL_PLAIN,
    };
  }

  it("recognises exactly the browsers that predate Fetch Metadata", () => {
    for (const agent of [IPHONE_15, IPHONE_16_3_CHROME, IPAD_14, MAC_SAFARI_15]) expect(isPreFetchMetadataWebKit(agent)).toBe(true);
    for (const agent of [IPHONE_16_4, IPHONE_18, MAC_CHROME_OLD, BROWSER, ""]) expect(isPreFetchMetadataWebKit(agent)).toBe(false);
  });

  it("counts an old iPhone whose Origin is this site", () => {
    for (const agent of [IPHONE_15, IPHONE_16_3_CHROME, IPAD_14, MAC_SAFARI_15]) {
      expect(countedSignalCountry(oldSignal({ origin: "https://bilimhezinisi.com" }, agent))).toBe("TR");
    }
  });

  it("counts it by its Referer when it sends no Origin", () => {
    expect(countedSignalCountry(oldSignal({ referer: "https://bilimhezinisi.com/books/12" }))).toBe("TR");
  });

  it("refuses it from another site, or with nothing to show where it came from", () => {
    expect(countedSignalCountry(oldSignal({ origin: "https://example.com" }))).toBeNull();
    expect(countedSignalCountry(oldSignal({ origin: "https://example.com", referer: "https://bilimhezinisi.com/" }))).toBeNull();
    expect(countedSignalCountry(oldSignal({ referer: "https://bilimhezinisi.com.example.com/" }))).toBeNull();
    expect(countedSignalCountry(oldSignal({ referer: "not a url" }))).toBeNull();
    expect(countedSignalCountry(oldSignal({}))).toBeNull();
  });

  it("refuses a modern browser that leaves Sec-Fetch out", () => {
    for (const agent of [IPHONE_16_4, IPHONE_18, BROWSER, MAC_CHROME_OLD]) {
      expect(countedSignalCountry(oldSignal({ origin: "https://bilimhezinisi.com" }, agent))).toBeNull();
    }
  });

  it("does not fall back when some Sec-Fetch header is there", () => {
    expect(countedSignalCountry(oldSignal({ origin: "https://bilimhezinisi.com", "sec-fetch-site": "cross-site" }))).toBeNull();
  });

  it("still refuses staff and the admin area on an old iPhone", () => {
    const fromSite = { origin: "https://bilimhezinisi.com" };
    expect(countedSignalCountry(oldSignal({ ...fromSite, cookie: "bh_nocount=1" }))).toBeNull();
    expect(countedSignalCountry(oldSignal({ ...fromSite, referer: "https://bilimhezinisi.com/admin/books" }))).toBeNull();
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

  it("sends the first one at once", async () => {
    const { batcher, sent } = setup();
    const send = batcher.add("TR");
    expect(send).not.toBeNull();
    await send;
    expect(sent).toEqual([{ TR: 1 }]);
  });

  it("holds those that arrive within the window and sends them with the next one", async () => {
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

  it("counts every one exactly once, however the batches fall", async () => {
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

  it("never lets a failed send fail the request", async () => {
    const { batcher, breakDatabase } = setup();
    breakDatabase();
    await expect(batcher.add("TR")).resolves.toBeUndefined();
  });
});
