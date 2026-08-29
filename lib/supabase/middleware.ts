import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";

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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
   */
  const { data: verified } = await supabase.auth.getClaims();
  // Whether anyone is signed in decides whether the service worker may keep
  // this page for offline reading — see the header proxy.ts stamps on it.
  return { response, signedIn: Boolean(verified?.claims?.sub) };
}
