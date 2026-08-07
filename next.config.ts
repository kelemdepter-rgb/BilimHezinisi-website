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
