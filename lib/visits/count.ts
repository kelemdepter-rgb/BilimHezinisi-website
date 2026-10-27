/**
 * Which countries the library is opened from — the counting rules (2026-10-22;
 * East Turkistan apart from China since 2026-10-23; counted from the browser
 * since 2026-10-27).
 *
 * The owner wants to know where the site is used, and nothing more. Every
 * full page load of the library sends ONE empty signal from the reader's own
 * browser to /api/visit (lib/visits/beacon.ts). The server reduces it to the
 * two-letter country code Vercel puts on the request and adds one to a daily
 * tally (migrations 0033, 0034). The IP address, the user agent, the page, the
 * cookies and the session are looked at here only to decide whether to count,
 * and are never stored or logged.
 *
 * Why from the browser and not, as at first, in proxy.ts: a page fetched by a
 * program that never runs it was counted as an opening — from 2026-10-22 to
 * 10-26 Brazil, Argentina, Colombia and a dozen more countries showed tens of
 * openings and not one device. A signal the page itself sends exists only
 * when the page really ran in a browser.
 *
 * A plain module — no server-only import — so the browser half can share its
 * constants and the unit tests can drive it with fake headers and a fake clock.
 */

/** The header Vercel sets on every request: ISO 3166-1 alpha-2, capitals. */
export const VISIT_COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * The region part of the ISO 3166-2 code for the request's first-level
 * region (e.g. "XJ" of CN-XJ). Read ONLY to tell East Turkistan apart from
 * China, never stored — the tally still keeps one two-letter code.
 */
export const VISIT_REGION_HEADER = "x-vercel-ip-country-region";

/**
 * East Turkistan, counted apart from China (the owner's decision,
 * 2026-10-23). "XJ" lies in ISO 3166-1's user-assigned range (XA–XZ), which
 * is never given to a country, so it cannot collide with a code Vercel sends;
 * it also matches the region code ISO 3166-2 uses there (CN-XJ). The table's
 * two-capital-letters check accepts it, so no migration is needed.
 */
export const EAST_TURKISTAN = "XJ";

/** CN-XJ since 2017; the older numeric form CN-65 is still seen in IP databases. */
const EAST_TURKISTAN_REGIONS = new Set(["XJ", "65"]);

/**
 * Programs, not readers. A program that runs pages in a real browser engine
 * would send the signal, so this list catches the ones that say what they are.
 */
const NOT_A_READER =
  /bot\b|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|libwww|httpclient/i;

/**
 * Set by the admin area in a staff member's own browser
 * (components/admin/no-count-mark.tsx), so the owner and the uploaders do not
 * count their own visits. A flag and nothing else — "1" — readable by script
 * on purpose: setting it only ever takes a browser OUT of the tally.
 */
export const NO_COUNT_COOKIE = "bh_nocount";

/** Whether the request carries the staff no-count flag. */
export function hasNoCountCookie(headers: Headers): boolean {
  return (headers.get("cookie") ?? "").split(";").some((part) => part.trim() === `${NO_COUNT_COOKIE}=1`);
}

/** A program rather than a person's browser — or no user agent at all. */
function isProgram(headers: Headers): boolean {
  const agent = headers.get("user-agent") ?? "";
  return !agent || NOT_A_READER.test(agent);
}

/**
 * The code to tally for where this request comes from: Vercel's country code,
 * or EAST_TURKISTAN for a Chinese address in that region. Null when Vercel
 * could not place it.
 */
function placeOf(headers: Headers): string | null {
  const country = headers.get(VISIT_COUNTRY_HEADER) ?? "";
  if (!/^[A-Z]{2}$/.test(country)) return null;
  if (country === "CN" && EAST_TURKISTAN_REGIONS.has((headers.get(VISIT_REGION_HEADER) ?? "").toUpperCase())) {
    return EAST_TURKISTAN;
  }
  return country;
}

/**
 * Fetch Metadata (`Sec-Fetch-Site` and its siblings) reached Safari only in
 * 16.4 (March 2023). iPhones that cannot update past it — the 6s, the 7, the
 * first SE, a real share of this audience — and Safari on Macs before 16.4
 * send none of it (found 2026-10-23). For exactly those browsers, and only
 * when a request carries NO Fetch Metadata whatsoever, the Origin or Referer
 * stands in (`fromThisSite`). Any other browser that arrives without Fetch
 * Metadata is imitating one, and stays uncounted.
 */
const FETCH_METADATA = ["sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"];

const before164 = (major: number, minor: number) => major < 16 || (major === 16 && minor < 4);

/** Safari or any iOS browser (all WebKit underneath) from before Fetch Metadata. */
export function isPreFetchMetadataWebKit(agent: string): boolean {
  // iPhone, iPod, and iPad in mobile mode: the iOS version decides the WebKit.
  const ios = /\((?:iPhone|iPad|iPod)[^)]*\bOS (\d+)_(\d+)/.exec(agent);
  if (ios) return before164(Number(ios[1]), Number(ios[2]));
  // Safari on a Mac — and an iPad asking for the desktop site, which says the same.
  if (/Macintosh/.test(agent) && !/Chrome|Chromium|Firefox|Edg|OPR/.test(agent)) {
    const safari = /Version\/(\d+)\.(\d+)(?:\.\d+)? Safari\//.exec(agent);
    if (safari) return before164(Number(safari[1]), Number(safari[2]));
  }
  return false;
}

/** A browser that predates Fetch Metadata, on a request that indeed has none. */
function isOldBrowserWithoutMetadata(headers: Headers): boolean {
  return FETCH_METADATA.every((name) => !headers.has(name)) && isPreFetchMetadataWebKit(headers.get("user-agent") ?? "");
}

/** Whether the Referer is a page of the admin area — never a reader's page. */
function fromAdminArea(headers: Headers): boolean {
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    const path = new URL(referer).pathname;
    return path === "/admin" || path.startsWith("/admin/");
  } catch {
    return false;
  }
}

/** The request came from a page of this site, by its Origin or, failing that, its Referer. */
function fromThisSite(headers: Headers, url: string): boolean {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  const declared = headers.get("origin");
  if (declared) return declared === origin;
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === origin;
  } catch {
    return false;
  }
}

export type SignalRequest = {
  method: string;
  headers: Headers;
  /** `process.env.VERCEL_ENV` — only the production site is counted. */
  environment: string | undefined;
  /** The request's own URL, for the Origin check old Safari needs. */
  url: string;
};

/**
 * The code to tally for a page-load signal, or null when it is not counted.
 *
 * The signal is the empty POST components/visit-beacon.tsx sends with
 * `navigator.sendBeacon` each time a page of the library fully loads (marked
 * `?d=1` the first time that browser does so on a UTC day — the device). It
 * is counted on the production deployment only, from the site's own pages
 * (`Sec-Fetch-Site: same-origin`; for Safari before 16.4, which sends no such
 * header, a matching Origin or Referer), never from a program, a staff browser
 * or a page of the admin area. The route in front of it also brakes bursts
 * per address (app/api/visit/route.ts).
 */
export function countedSignalCountry({ method, headers, environment, url }: SignalRequest): string | null {
  if (environment !== "production") return null;
  if (method !== "POST") return null;
  const sameOrigin =
    headers.get("sec-fetch-site") === "same-origin" || (isOldBrowserWithoutMetadata(headers) && fromThisSite(headers, url));
  if (!sameOrigin) return null;
  // The browser skips the admin area itself (lib/visits/beacon.ts); this holds
  // for a page still running an older script. The site's Referrer-Policy
  // sends the full same-origin page address with the signal.
  if (fromAdminArea(headers)) return null;
  if (isProgram(headers) || hasNoCountCookie(headers)) return null;
  return placeOf(headers);
}

/** Whether a signal says it is this browser's first page load of the UTC day. */
export function isFirstOfDay(url: string): boolean {
  try {
    return new URL(url).searchParams.get("d") === "1";
  } catch {
    return false;
  }
}

/** Openings waiting to be sent: country code → how many. */
export type VisitBatch = Record<string, number>;

export type VisitBatcherOptions = {
  /** Sends one batch. A rejection is swallowed: a lost count is not worth a failed page. */
  send: (batch: VisitBatch) => Promise<void>;
  /** Send at least this often while openings keep coming. */
  flushEveryMs?: number;
  /** …or as soon as this many are waiting. */
  flushAtCount?: number;
  now?: () => number;
};

/**
 * Gathers openings and sends them together, so a busy minute is a few
 * database calls instead of one per page on a single hot row.
 *
 * The first opening after a quiet spell is sent at once — on a library this
 * size that is nearly all of them. Openings that arrive inside the window
 * wait for the next one, and are sent with it. A server instance recycled
 * with a few seconds' openings still waiting loses them: a handful out of
 * thousands, which is the price of not writing on every request.
 */
export function createVisitBatcher({
  send,
  flushEveryMs = 5_000,
  flushAtCount = 25,
  now = Date.now,
}: VisitBatcherOptions) {
  let pending: VisitBatch = {};
  let waiting = 0;
  let lastSent = Number.NEGATIVE_INFINITY;

  return {
    /**
     * Count one. Returns the send to wait for when this one triggered it,
     * and null when it is waiting its turn.
     */
    add(country: string): Promise<void> | null {
      pending[country] = (pending[country] ?? 0) + 1;
      waiting += 1;

      const at = now();
      if (waiting < flushAtCount && at - lastSent < flushEveryMs) return null;

      const batch = pending;
      pending = {};
      waiting = 0;
      lastSent = at;
      return send(batch).catch(() => undefined);
    },
  };
}
