import "server-only";
import { headers } from "next/headers";

/**
 * A small fixed-window limiter: the outer burst brake in front of the auth
 * actions and the other endpoints below.
 *
 * In-process, so it costs nothing and holds per server instance. It counts
 * EVERY request, successes included, and stops a burst from one address
 * before it reaches the network at all — which is what keeps Vercel's
 * function budget and Supabase's allowances intact.
 *
 * It is not the three-chances rule. «Three failed attempts, then an hour's
 * lock» on /login and /register has to hold across every instance at once,
 * so it lives in Postgres (lib/auth/attempts.ts, migration 0026) and counts
 * failures only. It writes at most one row per hashed key, only on a failed
 * attempt, and its own per-address backstop stops writing once an address is
 * locked — so an unauthenticated visitor cannot use it to fill the 500 MB free
 * tier either. The auth rules here are set so they can never trip before that
 * rule's third failure (tests/unit/auth-attempts.test.ts holds them to it).
 *
 * Supabase Auth applies its own limits centrally too (the
 * `over_request_rate_limit` code the actions handle).
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Drop expired entries so a long-lived instance cannot grow without bound. */
function sweep(now: number) {
  if (windows.size < 500) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitRule = { limit: number; windowMs: number };

/**
 * Sign-in: enough for a forgetful person, far short of a password guesser.
 * The third wrong password locks the form for an hour anyway
 * (lib/auth/attempts.ts); this only brakes a burst.
 */
export const SIGN_IN_RULE: RateLimitRule = { limit: 8, windowMs: 10 * 60_000 };
/**
 * Sign-up: each success costs an email send, so it is tighter than sign-in —
 * but it counts successes too, and must leave room for a whole honest hour:
 * a registration, a server-side typo suggestion with JavaScript off, and the
 * three failed attempts the owner's rule allows, before it ever says no. Six,
 * raised from four for exactly that (PROMPT-38).
 */
export const SIGN_UP_RULE: RateLimitRule = { limit: 6, windowMs: 60 * 60_000 };
/**
 * Resending the confirmation email: another send per request, and on the
 * sign-in page, where it answers the same whether or not the address has an
 * account. A reader waiting for a link needs one or two; the page itself
 * holds the button back for a minute after each.
 */
export const RESEND_RULE: RateLimitRule = { limit: 3, windowMs: 15 * 60_000 };
/**
 * Password reset: also an email send, and the one endpoint that will happily
 * mail a stranger on request. Someone who genuinely forgot their password
 * needs it once or twice; anyone asking more often from one address is
 * spending the project's free email allowance on somebody else's inbox.
 */
export const PASSWORD_RESET_RULE: RateLimitRule = { limit: 4, windowMs: 60 * 60_000 };

/**
 * Downloading a whole book.
 *
 * One download reads every page of a book out of Supabase — the single most
 * expensive thing an anonymous visitor can ask this site to do, and the free
 * plan allows 5 GB of egress a month.
 *
 * Twenty in ten minutes, not five, because of who reads this library: a great
 * many of them share one address behind a mobile carrier's NAT, where a tight
 * per-address cap stops strangers rather than abusers. This is a brake on a
 * burst, and it is honest about being only that — an in-process counter holds
 * per server instance and cannot enforce a real monthly total. What it does
 * stop is one script walking the whole library in an afternoon.
 */
export const BOOK_DOWNLOAD_RULE: RateLimitRule = { limit: 20, windowMs: 10 * 60_000 };

/**
 * Searching the library from inside a note.
 *
 * Every keystroke is debounced into at most one search, and a writer looking
 * for a passage tries several wordings before finding it — so this is loose
 * where the others are tight. It is also the one rule keyed on the USER rather
 * than the address (see `notebookKey`): the notebook needs an account, and a
 * writer behind a carrier's NAT must not spend a stranger's allowance.
 *
 * What it stops is a signed-in account driving the search RPC in a loop, which
 * is the only thing here that costs the free tier real work.
 */
export const NOTE_SOURCE_RULE: RateLimitRule = { limit: 90, windowMs: 10 * 60_000 };

/**
 * Searching the library: /search with a word, and the «show every place in
 * this book» expander beneath its results (one shared bucket per address).
 *
 * THE MIDDLE LAYER OF THREE, and the weakest on purpose. On 2026-10-05 a load
 * tool fired ~70 whole-library searches in a second and took the whole site
 * down (PROMPT-40). What holds against that is, from the outside in:
 *   1. the Vercel firewall's per-address rate limit on /search (dashboard,
 *      docs/search-flood.md) — counted at the edge, across every instance;
 *   2. this — counted per server INSTANCE, so a busy deployment with several
 *      instances lets an address through several times over. It still costs
 *      nothing, needs no network, and answers before the database is asked;
 *   3. the database's own slots (migration 0028), the only layer that holds
 *      against a flood spread over many addresses: a search that finds every
 *      slot taken is refused in milliseconds.
 *
 * Sixty a minute, not thirty: the YouTube tutorial means whole groups — a
 * classroom, a family, a mosque community — searching together behind ONE
 * shared Wi-Fi address, and the firewall rule is raised to 60 a minute for
 * exactly that reason once layer 3 is live. A tighter limit here would quietly
 * undo that on whichever instance the group lands on. One person searching by
 * hand makes a handful a minute; sixty is one a second, sustained.
 */
export const SEARCH_RULE: RateLimitRule = { limit: 60, windowMs: 60_000 };

/**
 * The caller's address, from the proxy header Vercel sets. Falls back to a
 * single shared bucket, which is the safe direction: unknown callers share a
 * limit rather than escaping it.
 */
export async function callerKey(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headerList.get("x-real-ip")?.trim();
  return ip || "unknown";
}

/** True when the caller is over its allowance and should be turned away. */
export function isRateLimited(key: string, rule: RateLimitRule): boolean {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return false;
  }
  existing.count += 1;
  return existing.count > rule.limit;
}

/** Test seam — the limiter is module state, which a test must be able to clear. */
export function resetRateLimits(): void {
  windows.clear();
}
