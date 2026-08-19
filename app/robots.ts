import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * Everything a visitor can read without an account is open to crawlers.
 * The admin area, personal pages and the API are not — they hold either
 * unpublished work or one person's own data.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/admin/",
        "/my/",
        "/api/",
        "/auth/",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
