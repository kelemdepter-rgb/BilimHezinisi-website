/**
 * Which countries the library is opened from — the counting rules (2026-10-22).
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

/** Never counted: not a reader opening a page of the library. */
const SKIPPED = ["/api", "/auth", "/admin"];

/**
 * Programs, not readers. Real browsers also fail the Sec-Fetch test below, so
 * this list only has to catch the headless and scripted ones that imitate them.
 */
const NOT_A_READER =
  /bot\b|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|libwww|httpclient/i;

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
 */
export function countedVisitCountry({ method, pathname, headers, environment }: VisitRequest): string | null {
  if (environment !== "production") return null;
  if (method !== "GET") return null;
  if (isSkippedPath(pathname)) return null;

  if (headers.get("sec-fetch-dest") !== "document" || headers.get("sec-fetch-mode") !== "navigate") return null;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return null;

  const agent = headers.get("user-agent") ?? "";
  if (!agent || NOT_A_READER.test(agent)) return null;

  const country = headers.get(VISIT_COUNTRY_HEADER) ?? "";
  return /^[A-Z]{2}$/.test(country) ? country : null;
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
