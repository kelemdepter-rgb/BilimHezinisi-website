/**
 * How long anything on this site waits for Supabase (PROMPT-40).
 *
 * On 2026-10-05 a search flood stalled Supabase's API and every page of the
 * site waited for it: no client here had a timeout of its own, supabase-js
 * retries a failed GET three more times, and so a page waited until Vercel
 * killed it at 300 s — home, Qur'an, /admin, all of them. Every Supabase
 * client now carries one of the ceilings below through `global.fetch`, which
 * supabase-js hands to every part of a client: tables, RPCs, storage and auth.
 *
 * Each number has a reason, measured or inherited:
 *
 *   SERVER  10 s — every client on the server: the cookie-bound server client,
 *     the shared cache's anon client, the service-role client. Above the 8 s
 *     statement timeout Postgres gives a signed-in or service-role request
 *     (the anonymous role has 3 s), so a real timeout still arrives as
 *     Postgres's own 57014 and not as our abort. The slowest legitimate calls
 *     measured on a local copy throttled to free-tier CPU (2026-10-06): a
 *     500-row page insert 0.41 s, a whole-library search 0.56 s, deleting a
 *     700-page book a few ms; live, the slowest search that answers is about
 *     1.2 s, and the daily health check's calls the same. Ten seconds is
 *     several times all of those, and a thirtieth of what a stall used to cost.
 *   BROWSER 30 s — the clients in a reader's browser. A phone on a weak
 *     connection uploads a 200-page batch (~0.5 MB) far more slowly than a
 *     server does; a stall there costs a spinner, not a server.
 *   UPLOAD  10 min — a file going to Storage from the browser (a cover, or an
 *     original the admin chose to keep). It can be many megabytes over a
 *     mobile uplink, and nothing on the server waits for it.
 *   PROXY    3 s — proxy.ts verifying the session on every single request.
 *     Normally no network at all (the token is checked locally); a refresh is
 *     one round trip to London, a few hundred ms. Past this the request goes
 *     on as anonymous for rendering — see lib/supabase/middleware.ts.
 *   SESSION  5 s — a page or an action asking who is signed in. auth-js
 *     retries a failed token refresh for up to 30 s on its own, whatever the
 *     per-request timeout, so this is an overall deadline. Past it a page
 *     renders for an anonymous reader, and every role check FAILS CLOSED.
 *
 * A plain module, no server-only import: the browser clients use it too.
 */

export const SERVER_FETCH_TIMEOUT_MS = 10_000;
export const BROWSER_FETCH_TIMEOUT_MS = 30_000;
export const BROWSER_UPLOAD_TIMEOUT_MS = 10 * 60_000;
export const PROXY_AUTH_DEADLINE_MS = 3_000;
export const SESSION_DEADLINE_MS = 5_000;

type Fetch = typeof fetch;

export type TimeoutOptions = {
  /** A number, or a choice per request (the browser gives uploads longer). */
  timeoutMs: number | ((url: string, init?: RequestInit) => number);
  /**
   * A deadline shared by every request of one client — the proxy's, so that
   * once it has stopped waiting, nothing it started keeps running.
   */
  deadline?: AbortSignal;
  /** The fetch to wrap; the global one, read at call time, by default. */
  base?: Fetch;
};

function urlOf(input: Parameters<Fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * A fetch that gives up after `timeoutMs`, for supabase-js's `global.fetch`.
 *
 * Gives up with a plain abort — an AbortError — on purpose: postgrest-js
 * retries a GET that failed for any other reason three more times, which is
 * how a stalled read became four stalled reads; an abort it passes straight
 * back as `{ error: { message: "AbortError: …", code: "" } }`.
 *
 * The caller's own signal (supabase-js's `.abortSignal()`, the health check's
 * timer) still works and still wins: either one aborts the request. Combined
 * by hand rather than with AbortSignal.any, which iPhones older than iOS 17.4
 * — a large part of this audience — do not have.
 *
 * The clock covers the whole exchange, body included, and stops when it
 * fires or the request fails; firing after the body has been read changes
 * nothing.
 */
export function fetchWithTimeout({ timeoutMs, deadline, base }: TimeoutOptions): Fetch {
  return (input, init) => {
    const ms = typeof timeoutMs === "number" ? timeoutMs : timeoutMs(urlOf(input), init);
    const controller = new AbortController();
    const outer = [init?.signal ?? (input instanceof Request ? input.signal : null), deadline].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    );

    const abort = () => controller.abort();
    const release = () => {
      clearTimeout(timer);
      for (const signal of outer) signal.removeEventListener("abort", abort);
    };
    const timer = setTimeout(() => {
      release();
      abort();
    }, ms);
    // A timer must not hold a Node process open on its own; browsers have no unref.
    (timer as { unref?: () => void }).unref?.();

    // Already cancelled — the caller gave up, or the proxy's deadline has
    // passed and auth-js is retrying behind it: nothing goes out at all.
    if (outer.some((signal) => signal.aborted)) {
      release();
      return Promise.reject(new DOMException("This operation was aborted", "AbortError"));
    }
    for (const signal of outer) signal.addEventListener("abort", abort, { once: true });

    const call = base ?? globalThis.fetch;
    return call(input, { ...init, signal: controller.signal }).catch((error: unknown) => {
      release();
      throw error;
    });
  };
}

/**
 * Wait for `work`, but no longer than `ms`; past it, resolve to `fallback`.
 * For the auth calls whose own retries would outlast any per-request timeout.
 * A rejection resolves to `fallback` too — the callers' fallback is always
 * the safe answer ("not signed in", "not staff").
 */
export async function withDeadline<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work.catch(() => fallback), late]);
  } finally {
    clearTimeout(timer);
  }
}
