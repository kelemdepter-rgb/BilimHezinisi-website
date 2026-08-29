/**
 * Which requests the old address redirects, and — far more important — which
 * it does not.
 *
 * Getting this wrong in the permissive direction strands one dead hostname.
 * Getting it wrong in the greedy direction breaks every Vercel preview, every
 * developer's localhost and the whole Playwright suite at once, because all
 * of those are *.vercel.app or localhost hosts too. So the negative cases
 * below are the point of this file, not an afterthought.
 */
import { describe, expect, it } from "vitest";
import { CANONICAL_ORIGIN } from "@/lib/seo";
import { LEGACY_HOST, legacyHostRedirect } from "@/lib/legacy-host";

/** What proxy.ts hands the decision: the request headers and its URL. */
function ask(host: string, path = "/", { forwarded = true } = {}): string | null {
  const headers = new Headers(forwarded ? { "x-forwarded-host": host } : { host });
  const url = new URL(path, "http://placeholder.invalid");
  return legacyHostRedirect(headers, { pathname: url.pathname, search: url.search });
}

describe("the old address", () => {
  it("redirects to the new one", () => {
    expect(ask(LEGACY_HOST, "/")).toBe(`${CANONICAL_ORIGIN}/`);
  });

  it("keeps the path, so a shared link still opens its book", () => {
    expect(ask(LEGACY_HOST, "/books/72")).toBe(`${CANONICAL_ORIGIN}/books/72`);
    expect(ask(LEGACY_HOST, "/books/72/read")).toBe(`${CANONICAL_ORIGIN}/books/72/read`);
  });

  it("keeps the query string, so a link to a page inside a book still lands", () => {
    expect(ask(LEGACY_HOST, "/books/72?x=1")).toBe(`${CANONICAL_ORIGIN}/books/72?x=1`);
    expect(ask(LEGACY_HOST, "/books/72/read?page=40&q=%D8%A6")).toBe(
      `${CANONICAL_ORIGIN}/books/72/read?page=40&q=%D8%A6`,
    );
  });

  it("is read from the plain Host header when there is no proxy in front", () => {
    expect(ask(LEGACY_HOST, "/books/72", { forwarded: false })).toBe(
      `${CANONICAL_ORIGIN}/books/72`,
    );
  });

  it("matches however the host was capitalised", () => {
    expect(ask(LEGACY_HOST.toUpperCase(), "/")).toBe(`${CANONICAL_ORIGIN}/`);
  });

  it("points at the apex, over https, with nothing appended", () => {
    expect(CANONICAL_ORIGIN).toBe("https://bilimhezinisi.com");
  });
});

describe("what must never be redirected", () => {
  /**
   * Both shapes were on the last deployment. A `.vercel.app` suffix test
   * would swallow them and there would be no way to look at a preview.
   */
  it.each([
    "bilim-hezinisi-website-git-main-kelemdepter-s-projects.vercel.app",
    "bilim-hezinisi-website-8c32374881a1b2ec-kelemdepter-s-projects.vercel.app",
    "bilim-hezinisi-website-git-domain-move-kelemdepter-s-projects.vercel.app",
  ])("a preview deployment: %s", (host) => {
    expect(ask(host, "/books/72")).toBeNull();
  });

  /**
   * playwright.config.ts serves the dev server on :3000 and the production
   * build the offline and navigation specs need on :3100. If either were
   * redirected there would be no test suite left to notice.
   */
  it.each(["localhost:3000", "localhost:3100", "localhost", "127.0.0.1:3000", "[::1]:3000"])(
    "local development: %s",
    (host) => {
      expect(ask(host, "/books/72")).toBeNull();
    },
  );

  it("the new address itself, which would otherwise redirect to itself forever", () => {
    expect(ask("bilimhezinisi.com", "/books/72")).toBeNull();
    // www is Vercel's own 308 to the apex; nothing for this code to do.
    expect(ask("www.bilimhezinisi.com", "/books/72")).toBeNull();
  });

  it("a host that merely ends with the old one", () => {
    expect(ask("evil-bilim-hezinisi-website.vercel.app", "/")).toBeNull();
    expect(ask("bilim-hezinisi-website.vercel.app.example.com", "/")).toBeNull();
  });

  it("a request with no host at all", () => {
    expect(legacyHostRedirect(new Headers(), { pathname: "/", search: "" })).toBeNull();
  });
});

describe("what keeps answering on the old host itself", () => {
  /**
   * The daily cron in vercel.json is the only thing stopping the free
   * Supabase project pausing after ~7 idle days, which would take the library
   * offline. It sends a Bearer token, and a cross-origin redirect is exactly
   * where an Authorization header gets dropped — so the request is never
   * redirected, whichever host Vercel invokes it on.
   */
  it("the health route the cron calls", () => {
    expect(ask(LEGACY_HOST, "/api/health")).toBeNull();
    expect(ask(LEGACY_HOST, "/api/health?probe=1")).toBeNull();
  });

  /**
   * The PKCE verifier is a cookie on the origin that asked for the email
   * (app/auth/callback/route.ts). Sending an old link to the new origin would
   * leave that cookie behind and break a link somebody was already sent.
   */
  it("the Supabase auth callbacks", () => {
    expect(ask(LEGACY_HOST, "/auth/callback?code=abc123")).toBeNull();
    expect(ask(LEGACY_HOST, "/auth/confirm?token_hash=x&type=recovery")).toBeNull();
  });

  it("but nothing that merely starts with those letters", () => {
    expect(ask(LEGACY_HOST, "/api/healthcheck")).toBe(`${CANONICAL_ORIGIN}/api/healthcheck`);
    expect(ask(LEGACY_HOST, "/authors")).toBe(`${CANONICAL_ORIGIN}/authors`);
  });

  it("and every other API route does move", () => {
    expect(ask(LEGACY_HOST, "/api/books/7/download")).toBe(
      `${CANONICAL_ORIGIN}/api/books/7/download`,
    );
  });
});
