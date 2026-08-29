/**
 * The address the library used to answer on, and what it does now.
 *
 * «بىلىم خەزىنىسى» was published at bilim-hezinisi-website.vercel.app until
 * 2026-08-29 and lives at bilimhezinisi.com from that day on. The Vercel host
 * is deliberately NOT deleted — links that were already shared arrive there,
 * and it is still one of the redirect URLs Supabase will send an email link
 * to — so it answers with a permanent redirect rather than a dead name.
 *
 * The decision is a pure function so it can be tested exhaustively without a
 * server: a mistake here would either strand the old address or, far worse,
 * redirect the previews and localhost the whole test suite runs on.
 */
import { CANONICAL_ORIGIN } from "@/lib/seo";

/**
 * Matched EXACTLY, never as a `.vercel.app` suffix.
 *
 * Every preview deployment is a *.vercel.app host too —
 * bilim-hezinisi-website-git-<branch>-kelemdepter-s-projects.vercel.app and
 * bilim-hezinisi-website-<hash>-kelemdepter-s-projects.vercel.app were both
 * on the last deployment — and a suffix match would send every preview
 * straight to production, which is the same as having no previews at all.
 */
export const LEGACY_HOST = "bilim-hezinisi-website.vercel.app";

/**
 * The two paths that must keep answering on the old host itself.
 *
 * `/api/health` is what the daily Vercel cron (vercel.json) touches so the
 * free Supabase project never reaches the ~7 idle days that pause it — a
 * pause takes the whole library offline. It authenticates with a Bearer
 * token, and a redirect is the wrong thing to put in front of that: a browser
 * drops `Authorization` when a redirect crosses to another origin, and a
 * plain HTTP client may not follow the redirect at all. Whichever host Vercel
 * invokes the cron on, the request has to land.
 *
 * `/auth/` carries Supabase's PKCE exchange, and the code verifier is a
 * cookie belonging to the origin that asked for the email — see the comment
 * in app/auth/callback/route.ts. Sending an old confirmation or recovery link
 * to the new origin would leave the verifier behind on the old one and break
 * the link, which is precisely the thing this move must never do.
 */
export const LEGACY_HOST_EXEMPT_PATHS = ["/api/health", "/auth/"] as const;

/**
 * Which host this request actually arrived on, lower-cased and without a port.
 *
 * Vercel sets `x-forwarded-host` itself on the way in, so it is the honest
 * answer behind their proxy; `host` is the fallback for a plain Node server —
 * `next start`, and the production build the Playwright suite runs on :3100.
 * The port is dropped so localhost:3000 and localhost:3100 compare as
 * localhost; the old host never carried one.
 *
 * Nothing here is trusted with anything: the redirect target below is a
 * constant, so the worst a forged header can achieve is a redirect to this
 * site's own front door.
 */
function hostOf(headers: Headers): string | null {
  const raw = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!raw) return null;
  // More than one proxy in the chain appends rather than replaces; the first
  // entry is the host the request was actually made to.
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  return first ? first.replace(/:\d+$/, "") : null;
}

function isExempt(pathname: string): boolean {
  return LEGACY_HOST_EXEMPT_PATHS.some(
    (path) =>
      pathname === path || pathname.startsWith(path.endsWith("/") ? path : `${path}/`),
  );
}

/**
 * The absolute URL this request should be sent to, or null to serve it here.
 *
 * Path and query are carried across untouched, so a link somebody shared to
 * page 40 of a book still opens page 40 of that book.
 */
export function legacyHostRedirect(
  headers: Headers,
  url: { pathname: string; search: string },
): string | null {
  if (hostOf(headers) !== LEGACY_HOST) return null;
  if (isExempt(url.pathname)) return null;
  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;
}
