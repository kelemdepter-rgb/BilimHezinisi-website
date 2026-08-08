import type { NextConfig } from "next";

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
};

export default nextConfig;
