import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { CANONICAL_ORIGIN } from "../lib/seo";
import { LEGACY_HOST } from "../lib/legacy-host";
import { CRON_TEST_SECRET, loadEnvLocal, readSeed } from "./env";

loadEnvLocal();

/**
 * The move to bilimhezinisi.com, checked through the real proxy.
 *
 * tests/unit/legacy-host.test.ts already covers the decision exhaustively as
 * a pure function. What is left, and what only a running server can show, is
 * that proxy.ts actually applies it: that the old host really answers 308,
 * that a preview host and localhost really do not, and that the route the
 * daily cron depends on is not swallowed on the way.
 */

/**
 * Vercel sets x-forwarded-host itself on the way in, so this is the header
 * the proxy reads and the honest way to arrive as another host from here.
 * Nothing is trusted with it: the redirect target is a constant in lib/seo.ts.
 */
function asHost(host: string) {
  return { headers: { "x-forwarded-host": host }, maxRedirects: 0 };
}

const PREVIEW_HOST = "bilim-hezinisi-website-git-main-kelemdepter-s-projects.vercel.app";

test.describe("the old address redirects to the new one", () => {
  test("308, permanently, keeping the path", async ({ request }) => {
    const response = await request.get("/books/72", asHost(LEGACY_HOST));
    expect(response.status(), "a permanent move is a 308, not a 302").toBe(308);
    expect(response.headers().location).toBe(`${CANONICAL_ORIGIN}/books/72`);
  });

  test("the query string survives, so a shared deep link still lands", async ({ request }) => {
    const response = await request.get("/books/72/read?page=40&q=x", asHost(LEGACY_HOST));
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(`${CANONICAL_ORIGIN}/books/72/read?page=40&q=x`);
  });

  test("the home page too", async ({ request }) => {
    const response = await request.get("/", asHost(LEGACY_HOST));
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(`${CANONICAL_ORIGIN}/`);
  });
});

test.describe("what the redirect must never touch", () => {
  /**
   * If previews redirected there would be nothing left to preview: every one
   * of them is a *.vercel.app host as well, which is why the match is exact.
   */
  test("a preview deployment serves normally", async ({ request }) => {
    const response = await request.get("/", asHost(PREVIEW_HOST));
    expect(response.status(), "a preview must serve its own copy").toBe(200);
    expect(response.headers().location).toBeUndefined();
  });

  test("localhost serves normally — this suite runs on it", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });

  /**
   * The PKCE verifier is a cookie on the origin that asked for the email, so
   * a link already in somebody's inbox has to finish where it started.
   */
  test("a Supabase auth link on the old host is not sent elsewhere", async ({ request }) => {
    for (const path of ["/auth/callback?code=abc123", "/auth/confirm?token_hash=x&type=recovery"]) {
      const response = await request.get(path, asHost(LEGACY_HOST));
      expect(response.status(), `${path} must be handled here`).not.toBe(308);
      expect(
        response.headers().location ?? "",
        `${path} must not be sent to the new origin`,
      ).not.toContain(CANONICAL_ORIGIN);
    }
  });
});

/**
 * The one request the library cannot afford to lose.
 *
 * vercel.json schedules /api/health daily, and that ping is the only thing
 * keeping the free Supabase project from pausing after ~7 idle days — which
 * would take the whole library offline. It authenticates with a Bearer token,
 * and a redirect is where an Authorization header gets dropped, so the route
 * is exempt and must answer on WHICHEVER host Vercel invokes the cron on.
 */
test.describe("the daily cron's route", () => {
  function health(request: APIRequestContext, host: string | null, token?: string) {
    return request.get("/api/health", {
      headers: {
        ...(host ? { "x-forwarded-host": host } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      maxRedirects: 0,
    });
  }

  test("answers 200 with the token, on both hosts", async ({ request }) => {
    for (const host of [null, LEGACY_HOST]) {
      const response = await health(request, host, process.env.CRON_SECRET ?? CRON_TEST_SECRET);
      expect(response.status(), `health on ${host ?? "the new host"}`).toBe(200);
      expect((await response.json()).ok).toBe(true);
    }
  });

  test("refuses 401 without it, on both hosts", async ({ request }) => {
    const unauthenticated = await health(request, null);
    /**
     * A server started by this suite always has CRON_SECRET (playwright.config.ts).
     * One left running from before this change does not, and then the route is
     * open by design — say so rather than fail for the wrong reason.
     */
    test.skip(
      unauthenticated.status() === 200,
      "reused dev server has no CRON_SECRET; restart it to check the 401",
    );
    expect(unauthenticated.status()).toBe(401);
    expect((await health(request, LEGACY_HOST)).status(), "old host too").toBe(401);
  });
});

test.describe("nothing tells a reader the old address", () => {
  async function bodyOf(request: APIRequestContext, path: string): Promise<string> {
    const response = await request.get(path);
    expect(response.ok(), `${path} must be served`).toBe(true);
    return response.text();
  }

  test("not the crawler files, the feed or the manifest", async ({ request }) => {
    const home = await bodyOf(request, "/");
    const found = /<link rel="manifest" href="([^"]+)"/.exec(home);
    const manifestPath = found ? found[1] : "/manifest.webmanifest";

    for (const path of ["/", "/robots.txt", "/sitemap.xml", "/feed.xml", manifestPath]) {
      const body = path === "/" ? home : await bodyOf(request, path);
      expect(body, `${path} must not name a vercel.app host`).not.toContain("vercel.app");
    }
  });

  test("not a book's canonical tag or its share card", async ({ request }) => {
    const seed = readSeed();
    test.skip(!seed, "no seeded book to read the canonical off");

    const html = await bodyOf(request, `/books/${seed!.bookId}`);
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
    expect(canonical, "a book must carry a canonical tag").not.toBeNull();
    expect(canonical![1]).not.toContain("vercel.app");
    for (const tag of html.matchAll(/<meta property="og:[^"]+" content="([^"]*)"/g)) {
      expect(tag[1], "an Open Graph tag must not name a vercel.app host").not.toContain(
        "vercel.app",
      );
    }
  });
});

/**
 * The narrowest width CLAUDE.md names. The suite's own projects start at
 * 375 px, so this block sets its own viewport rather than adding a fourth
 * one: the mobile rules are a hard requirement, and a proxy that now runs an
 * extra check on every single request is exactly the sort of change worth
 * re-proving them against.
 */
test.describe("360 px, the hard floor", () => {
  async function assertNoHorizontalOverflow(page: Page, where: string) {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth, `${where} must not scroll horizontally`).toBeLessThanOrEqual(
      metrics.innerWidth + 1,
    );
  }

  test("no horizontal scroll, and the controls survive a scroll down and back up", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });

    for (const path of ["/", "/quran", "/about", "/search"]) {
      await page.goto(path);
      await assertNoHorizontalOverflow(page, path);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await assertNoHorizontalOverflow(page, `${path} (scrolled to the bottom)`);
      await page.evaluate(() => window.scrollTo(0, 0));

      const toggle = page.getByTestId("theme-toggle");
      await expect(toggle, `${path}: the theme toggle must come back`).toBeVisible();
      const box = await toggle.boundingBox();
      expect(box, `${path}: the theme toggle must have a box`).not.toBeNull();
      expect(box!.height, `${path}: touch target must be at least 44 px`).toBeGreaterThanOrEqual(44);
      // Visible is not enough — a sticky bar could be sitting on top of it.
      await toggle.click();
    }
  });
});
