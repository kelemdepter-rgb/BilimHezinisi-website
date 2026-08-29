import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./lib/security/csp";

/**
 * Covers are served through next/image so Vercel's CDN optimises and caches
 * them. Supabase is then hit once per cover instead of once per visitor,
 * which is what keeps the 5 GB/month egress allowance intact.
 */
const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  /**
   * Where the build output goes.
   *
   * Overridable so the Playwright suite can hold a production build beside a
   * running dev server: the offline specs have to run against a real build
   * (the dev server's HMR client chunk is renamed on every load, so a cached
   * document can never find it again), and both servers writing .next would
   * pull the ground out from under each other.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /**
   * The dev-only route indicator is pinned to a viewport corner, where it
   * lands on top of the reader's and the mushaf's sticky bottom bars at phone
   * widths — it swallows taps on the jump button both for whoever is testing
   * on a real phone and for Playwright's "no control may be covered" checks.
   * Compile and runtime errors are still surfaced without it.
   */
  devIndicators: false,
  images: {
    formats: ["image/webp"],
    // Covers are small; these are the only widths worth generating.
    imageSizes: [96, 128, 160, 200, 256, 320, 400],
    deviceSizes: [640, 828, 1080],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  async headers() {
    return [
      {
        /**
         * Applies to everything, static files included — which is why these
         * live here and not in proxy.ts, whose matcher deliberately skips
         * public/. The Content-Security-Policy is the one header that cannot
         * be here: it carries a per-request nonce.
         */
        source: "/:path*",
        headers: [...STATIC_SECURITY_HEADERS],
      },
      {
        /**
         * The service worker script itself must never be served from a stale
         * HTTP cache: it is the thing that decides how everything else is
         * cached, so a browser holding on to an old copy would be stuck on an
         * old caching policy with no way to hear about the new one. The
         * registration also asks for updateViaCache: "none"; this is the same
         * instruction from the other end, for proxies in between.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        /**
         * The spellcheck dictionary is a build artifact: it only changes when
         * scripts/build-spelldict.mjs is re-run, and the worker caches it in
         * Cache Storage under a versioned name anyway. Vercel's default for
         * files in public/ is `max-age=0, must-revalidate`, which costs a
         * round trip on every cold start for a file that never changes.
         */
        source: "/spellcheck/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        /**
         * A tab icon that never changes, revalidated on every visit: Vercel's
         * default for it is `max-age=0, must-revalidate`, which costs a round
         * trip per cold page load for a file nobody edits. A day is long
         * enough to be worth having and short enough that a new icon is never
         * stranded — it is served from a path with no hash in it.
         */
        source: "/favicon.ico",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        /**
         * Fonts are content-stable: a new cut means a new filename, because
         * scripts/build-fonts.mjs writes one file per face. Without this they
         * inherit public/'s `max-age=0, must-revalidate` and every visitor
         * revalidates ~70 KB of UKIJ Ekran before the first paint.
         */
        source: "/fonts/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
