import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { legacyHostRedirect } from "@/lib/legacy-host";
import { CACHEABLE_HEADER } from "@/lib/pwa/constants";
import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { markRequest, timed } from "@/lib/perf/timing";

/**
 * Runs on every page and API request: refreshes the Supabase session and
 * stamps a fresh CSP nonce on the response.
 *
 * The nonce goes on the REQUEST headers as well as the response, because
 * that is how Next finds it — it parses `Content-Security-Policy` off the
 * incoming request and applies the nonce to its own scripts. `x-nonce` is
 * the copy our own JSON-LD blocks read through `headers()`.
 */
export default async function proxy(request: NextRequest) {
  /**
   * The old address, answered permanently at the new one.
   *
   * First, and before anything else: a redirect needs no Supabase round trip,
   * no CSP nonce and no session cookie written on a host the reader is about
   * to leave. What is and is not redirected lives in lib/legacy-host.ts,
   * where it is unit tested — the previews and the localhost this suite runs
   * on must never be caught by it, and /api/health and /auth/ must keep
   * answering on the old host itself.
   */
  const moved = legacyHostRedirect(request.headers, request.nextUrl);
  if (moved) return NextResponse.redirect(moved, 308);

  markRequest(request.nextUrl.pathname + request.nextUrl.search);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { response, signedIn } = await timed("proxy.updateSession", () =>
    updateSession(request, requestHeaders),
  );
  response.headers.set("Content-Security-Policy", csp);
  /**
   * Tells the service worker whether this response is safe to keep offline.
   *
   * A page rendered for a signed-in reader has their reading position — and
   * on some pages their name — baked into it, and Cache Storage is shared by
   * everyone who uses the browser profile. Deciding it here, where the
   * session is already known, means public/sw.js never has to guess.
   */
  response.headers.set(CACHEABLE_HEADER, signedIn ? "0" : "1");
  return response;
}

export const config = {
  matcher: [
    // Skip static assets; run on all pages and API routes. Files in public/
    // get their headers from next.config.ts instead.
    //
    // sw.js is excluded deliberately: browsers re-check the service worker
    // script on navigation, and running the session refresh there would cost
    // an extra auth round trip per page load for a file that never varies by
    // reader. Its security headers still come from next.config.ts.
    "/((?!_next/static|_next/image|favicon.ico|fonts/|brand.png|spellcheck/|sw\.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|otf|woff2?)$).*)",
  ],
};
