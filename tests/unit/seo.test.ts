/**
 * What address the site puts on itself.
 *
 * Every canonical tag Google reads, every Open Graph card, the sitemap, the
 * feed and the redirect in a Supabase recovery email all come out of
 * siteUrl(). Before the move it fell back to VERCEL_PROJECT_PRODUCTION_URL,
 * which Vercel documents as "the shortest production custom domain, or
 * vercel.app domain if no custom domain is available" — so a deployment that
 * lost SITE_URL, or a project whose custom domain came off, would quietly go
 * back to advertising bilim-hezinisi-website.vercel.app. These tests exist so
 * that cannot happen again silently.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_ORIGIN, absoluteUrl, siteUrl } from "@/lib/seo";

/** Start each case from a bare environment, whatever .env.local holds. */
function env(values: Record<string, string | undefined>): void {
  for (const key of [
    "SITE_URL",
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ]) {
    vi.stubEnv(key, values[key] ?? "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the canonical origin", () => {
  it("is the apex, over https, with no trailing slash", () => {
    expect(CANONICAL_ORIGIN).toBe("https://bilimhezinisi.com");
  });
});

describe("siteUrl", () => {
  it("uses SITE_URL when it is set", () => {
    env({ SITE_URL: "https://bilimhezinisi.com" });
    expect(siteUrl()).toBe("https://bilimhezinisi.com");
  });

  it("trims a trailing slash and surrounding space off it", () => {
    env({ SITE_URL: "  https://bilimhezinisi.com/  " });
    expect(siteUrl()).toBe("https://bilimhezinisi.com");
  });

  it("answers with the canonical domain when SITE_URL is missing on Vercel", () => {
    env({ VERCEL: "1", VERCEL_ENV: "production" });
    expect(siteUrl()).toBe(CANONICAL_ORIGIN);
  });

  /**
   * The failure this whole change is about: the deployment's own hostname must
   * never become the library's advertised address, however Vercel names it.
   */
  it("never falls back to a vercel.app host", () => {
    env({
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_URL: "bilim-hezinisi-website-abc123.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "bilim-hezinisi-website.vercel.app",
    });
    expect(siteUrl()).toBe(CANONICAL_ORIGIN);
    expect(siteUrl()).not.toContain("vercel.app");
    expect(absoluteUrl("/books/72")).toBe(`${CANONICAL_ORIGIN}/books/72`);
  });

  it("does the same on a preview deployment", () => {
    env({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_URL: "bilim-hezinisi-website-git-x-kelemdepter-s-projects.vercel.app",
    });
    expect(siteUrl()).toBe(CANONICAL_ORIGIN);
  });

  it("overrides a SITE_URL still left pointing at localhost on Vercel", () => {
    env({ SITE_URL: "http://localhost:3000", VERCEL: "1", VERCEL_ENV: "production" });
    expect(siteUrl()).toBe(CANONICAL_ORIGIN);
  });

  it("still says localhost on a developer's own machine", () => {
    env({});
    expect(siteUrl()).toBe("http://localhost:3000");
    env({ SITE_URL: "http://localhost:3100" });
    expect(siteUrl()).toBe("http://localhost:3100");
  });

  it("builds absolute URLs with or without the leading slash", () => {
    env({ SITE_URL: "https://bilimhezinisi.com" });
    expect(absoluteUrl("/feed.xml")).toBe("https://bilimhezinisi.com/feed.xml");
    expect(absoluteUrl("feed.xml")).toBe("https://bilimhezinisi.com/feed.xml");
  });
});
