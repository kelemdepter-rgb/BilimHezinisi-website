import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { PROXY_AUTH_DEADLINE_MS, fetchWithTimeout, withDeadline } from "@/lib/supabase/timeouts";

/** The session cookie @supabase/ssr writes, chunked as `.0`, `.1` … when long. */
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

const TIMED_OUT = Symbol("timed out");

/**
 * Refresh the auth session on every request (called from proxy.ts).
 *
 * `requestHeaders` carries what the proxy added before the page renders — the
 * CSP header Next reads the nonce out of, and the `x-nonce` copy our own
 * inline JSON-LD reads. Every NextResponse.next() below has to pass them on,
 * or a session refresh would silently drop the nonce and the page would
 * render scripts the browser then refuses to run.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<{ response: NextResponse; signedIn: boolean }> {
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!hasSupabaseEnv()) return { response, signedIn: false };

  // Read before getClaims, which may rewrite the request's cookies.
  const hasSessionCookie = request.cookies.getAll().some((cookie) => SESSION_COOKIE.test(cookie.name));

  /**
   * One deadline for everything this request's session check sends. auth-js
   * retries a failed refresh for up to 30 s on its own; once the proxy has
   * stopped waiting, nothing it started may keep running behind the page.
   */
  const deadline = new AbortController();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: fetchWithTimeout({ timeoutMs: PROXY_AUTH_DEADLINE_MS, deadline: deadline.signal }),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  /**
   * Rotates the token when it has expired, and verifies it.
   *
   * getClaims and not getUser: this project signs its access tokens with
   * ES256 and publishes the public key at /auth/v1/.well-known/jwks.json, so
   * the signature is checked here with WebCrypto instead of by asking the
   * Auth server — a round trip to London that used to happen on every single
   * request a signed-in reader made. The refresh still happens: getClaims
   * goes through getSession, which calls the refresh endpoint when the token
   * is inside its expiry margin and writes the new cookies through setAll
   * above. If the project ever moves back to a shared HS256 secret, auth-js
   * falls back to getUser on its own and this becomes what it was.
   *
   * Never allowed to hold the request up (PROMPT-40): past
   * PROXY_AUTH_DEADLINE_MS the request simply goes on. The page then asks for
   * itself (getSessionInfo, with its own deadline) and renders for an
   * anonymous reader if it cannot tell — anonymous reading must always work.
   * This decides NOTHING about permissions: /admin and every mutating action
   * re-verify the role from the database themselves (lib/admin/guards.ts),
   * and fail closed.
   *
   * The price, said plainly: a token refresh still running at the deadline
   * is lost — its new cookies cannot reach a response that has already gone —
   * and if Auth then counts the old token as reused, the reader has to sign
   * in again. A refresh normally takes a few hundred milliseconds, so this
   * happens only while Auth itself is failing, when the alternative was the
   * whole site hanging.
   */
  const outcome = await withDeadline(
    supabase.auth.getClaims().then(({ data, error }) => ({ sub: data?.claims?.sub, error })),
    PROXY_AUTH_DEADLINE_MS,
    TIMED_OUT,
  );
  deadline.abort();

  // Whether anyone is signed in decides whether the service worker may keep
  // this page for offline reading — see the header proxy.ts stamps on it. So
  // the doubt falls on the side of "signed in": a request carrying a session
  // cookie whose check timed out or failed may have been rendered for that
  // reader, and must not be kept where the next user of the browser finds it.
  // Only a check that completed and found no session is anonymous.
  if (outcome !== TIMED_OUT && typeof outcome.sub === "string" && outcome.sub) {
    return { response, signedIn: true };
  }
  const definitelyAnonymous = outcome !== TIMED_OUT && !outcome.error;
  return { response, signedIn: hasSessionCookie && !definitelyAnonymous };
}
