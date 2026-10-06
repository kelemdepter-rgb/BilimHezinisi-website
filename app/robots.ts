import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * Everything a visitor can read without an account is open to crawlers.
 * The admin area, personal pages and the API are not — they hold either
 * unpublished work or one person's own data.
 *
 * `/search?` — every search RESULT page — is not either: each one is a
 * database search, there is an endless number of them, and they are
 * `noindex` anyway (app/search/page.tsx). `/search` itself, the empty search
 * page, stays allowed: the rule matches only addresses that carry a query
 * string. This keeps polite crawlers off the one expensive page and does
 * nothing about anyone else; the firewall, SEARCH_RULE and the database's
 * search slots are what handle a flood (PROMPT-40).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/search?",
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
