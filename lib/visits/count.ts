/**
 * Which countries the library is opened from — the counting rules (2026-10-22;
 * East Turkistan counted apart from China since 2026-10-23).
 *
 * The owner wants to know where the site is used, and nothing more. So a
 * visit is reduced, in proxy.ts, to ONE thing — the two-letter country code
 * Vercel puts on the request — and added to a tally in the database
 * (supabase/migrations/0033_country_visits.sql). The IP address, the user
 * agent, the page, the cookies and the session are looked at here only to
 * decide whether to count, and are never stored or logged.
 *
 * A plain module — no server-only import — because proxy.ts uses it and the
 * unit tests drive it with fake headers and a fake clock.
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

/** Never counted: not a reader opening a page of the library. */
const SKIPPED = ["/api", "/auth", "/admin"];

/**
 * Programs, not readers. Real browsers also fail the Sec-Fetch test below, so
 * this list only has to catch the headless and scripted ones that imitate them.
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

function isSkippedPath(pathname: string): boolean {
  return SKIPPED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type VisitRequest = {
  method: string;
  pathname: string;
  headers: Headers;
  /** `process.env.VERCEL_ENV` — only the production site is counted. */
  environment: string | undefined;
};

/**
 * The country to count for this request, or null when it is not to be counted.
 *
 * Counted: a person's browser opening a page — a full navigation
 * (`Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`) on the production
 * deployment. Not counted: the app's own background fetches (page data,
 * prefetches, the service worker's), a browser pre-rendering a page nobody
 * has opened, scripts and crawlers, the admin area, the API and the auth
 * callbacks, a local server or a preview deployment, and a request Vercel
 * could not place in a country. Note this is page OPENINGS, not people.
 *
 * A Chinese address whose region is East Turkistan is counted as
 * EAST_TURKISTAN, not as CN. A browser carrying the staff no-count flag is
 * not counted.
 */
export function countedVisitCountry({ method, pathname, headers, environment }: VisitRequest): string | null {
  if (environment !== "production") return null;
  if (method !== "GET") return null;
  if (isSkippedPath(pathname)) return null;

  if (headers.get("sec-fetch-dest") !== "document" || headers.get("sec-fetch-mode") !== "navigate") return null;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return null;

  if (isProgram(headers) || hasNoCountCookie(headers)) return null;
  return placeOf(headers);
}

export type DeviceRequest = Omit<VisitRequest, "pathname">;

/**
 * The code to tally for a «one device, once a day» signal, or null.
 *
 * The signal is the POST components/visit-beacon.tsx sends with
 * `navigator.sendBeacon` the first time a browser opens the library on a UTC
 * day; the browser remembers the day in its own localStorage, and nothing is
 * remembered here. Counted on the production deployment only, from the site's
 * own pages (`Sec-Fetch-Site: same-origin`), never from a program or a staff
 * browser. The route in front of it also brakes bursts per address
 * (app/api/visit/route.ts).
 */
export function countedDeviceCountry({ method, headers, environment }: DeviceRequest): string | null {
  if (environment !== "production") return null;
  if (method !== "POST") return null;
  if (headers.get("sec-fetch-site") !== "same-origin") return null;
  if (isProgram(headers) || hasNoCountCookie(headers)) return null;
  return placeOf(headers);
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
     * Count one opening. Returns the send to wait for (`event.waitUntil`)
     * when this opening triggered one, and null when it is waiting its turn.
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
