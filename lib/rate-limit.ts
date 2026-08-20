import "server-only";
import { headers } from "next/headers";

/**
 * A small fixed-window limiter for the auth actions.
 *
 * Deliberately in-process: the alternative, a Postgres counter, would mean an
 * unauthenticated visitor could make the site write a row on every guess —
 * turning the defence into its own abuse vector on a 500 MB free tier. This
 * costs nothing and holds per server instance.
 *
 * It is not the only guard, and does not pretend to be: Supabase Auth applies
 * its own limits centrally (the `over_request_rate_limit` code the actions
 * already handle). This one stops a burst from one address before it reaches
 * the network at all, which is what keeps Vercel's function budget intact.
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

/** Sign-in: enough for a forgetful person, far short of a password guesser. */
export const SIGN_IN_RULE: RateLimitRule = { limit: 8, windowMs: 10 * 60_000 };
/** Sign-up: each one costs an email send, so it is tighter. */
export const SIGN_UP_RULE: RateLimitRule = { limit: 4, windowMs: 60 * 60_000 };
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
