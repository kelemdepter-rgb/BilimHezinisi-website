import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

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
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets; run on all pages and API routes. Files in public/
    // get their headers from next.config.ts instead.
    "/((?!_next/static|_next/image|favicon.ico|fonts/|brand.png|spellcheck/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|otf|woff2?)$).*)",
  ],
};
