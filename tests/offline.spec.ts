import { test, expect, type Page } from "@playwright/test";
import { readMarkdownSeed, readSeed, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Installability, offline reading, and the one rule that outranks everything
 * else in public/sw.js: nothing private is ever stored.
 *
 * Anonymous by default — reading with no account is the point of this library
 * — with the private-cache block signing in itself, so it can prove that even
 * a reader with a session leaves nothing of their own behind.
 */

function seededBookId(): number {
  const seed = readSeed();
  if (!seed) throw new Error("seed book missing — the setup project must run first");
  return seed.bookId;
}

function markdownBookId(): number {
  const seed = readMarkdownSeed();
  if (!seed) throw new Error("markdown seed book missing — the setup project must run first");
  return seed.bookId;
}

/** Wait for a worker to be installed AND in charge of this page. */
async function serviceWorkerReady(page: Page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 30_000 },
  );
}

/** Everything the site has stored, cache by cache. */
function storedUrls(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((request) => request.url);
    }
    return out;
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

test.describe("installable", () => {
  test("serves a manifest that meets the install criteria", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );

    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      lang: string;
      dir: string;
      display: string;
      start_url: string;
      background_color: string;
      theme_color: string;
      icons: Array<{ sizes: string; purpose?: string; src: string }>;
    };

    // The checklist a browser actually applies before offering to install.
    expect(manifest.name).toBe("بىلىم خەزىنىسى");
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("ug");
    expect(manifest.dir).toBe("rtl");
    // The palette has to be the design tokens, not invented values.
    expect(manifest.background_color).toBe("#FBF6EC");
    expect(manifest.theme_color).toBe("#B0832F");

    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);

    for (const icon of manifest.icons) {
      const image = await request.get(icon.src);
      expect(image.ok(), `${icon.src} must exist`).toBe(true);
      expect((await image.body()).length).toBeGreaterThan(1000);
    }
  });

  test("gives iOS what it needs to install by hand", async ({ page, request }) => {
    await page.goto("/");
    // iOS never offers installation itself; without these an added shortcut
    // opens Safari with its chrome instead of the library full screen.
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    const icon = await request.get("/icons/apple-touch-icon.png");
    expect(icon.ok()).toBe(true);
  });

  test("registers a worker that takes charge and precaches the offline page", async ({ page }) => {
    await page.goto("/");
    await serviceWorkerReady(page);

    const caches_ = await storedUrls(page);
    const shell = Object.entries(caches_).find(([name]) => name.startsWith("bh-sw-shell"));
    expect(shell, "the shell cache must exist").toBeDefined();
    expect(shell![1].some((url) => url.endsWith("/offline"))).toBe(true);
    expect(shell![1].some((url) => url.endsWith("/fonts/ukijekran.woff2"))).toBe(true);
  });
});

test.describe("with the network off", () => {
  test("a book that was opened before still opens, at the page it was left on", async ({
    page,
    context,
  }) => {
    const bookId = seededBookId();
    await page.goto("/");
    await serviceWorkerReady(page);

    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();

    // Read on, so there is both a stored position and stored book text.
    await page.getByTestId("page-jump").fill("9");
    await page.getByTestId("page-jump-go").click();
    await expect(page.locator('[data-page-no="9"]')).toBeVisible();
    // The position is written on a debounce; give it its 800 ms.
    await page.waitForTimeout(1500);

    /**
     * Whatever the reader's own record says, rather than the page that was
     * asked for: loading the pages around page 9 moves the viewport a little,
     * and the point of this test is that the stored position is honoured, not
     * that it lands on one particular number.
     */
    const left = await page.evaluate((id) => {
      const raw = window.localStorage.getItem(`bh-reading-position:${id}`);
      return raw ? (JSON.parse(raw) as { pageNo: number }).pageNo : null;
    }, bookId);
    expect(left, "the reader must have written down where it was").toBeGreaterThan(1);

    await context.setOffline(true);
    await page.goto(`/books/${bookId}/read`);

    // The book, not the offline page.
    await expect(page.getByTestId("reader-toolbar")).toBeVisible();
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await expect(page.getByTestId("offline-heading")).toHaveCount(0);

    // And at the page the reader left, not back at the beginning.
    await expect(page.getByTestId("restored-note")).toContainText(String(left));

    // It has to scroll, too — a frozen page is not a readable one.
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await assertNoHorizontalOverflow(page);
    await context.setOffline(false);
  });

  test("the reader's own type size and theme still apply", async ({ page, context }) => {
    const bookId = seededBookId();
    await page.goto("/");
    await serviceWorkerReady(page);
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();

    // Two taps up from the default, and a theme that is not the default.
    await page.getByTestId("font-increase").click();
    await page.getByTestId("font-increase").click();
    await page.getByTestId("theme-toggle").click();
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    );
    const size = await page.evaluate(
      () => getComputedStyle(document.querySelector("[data-testid=reader-content]")!).fontSize,
    );
    await page.waitForTimeout(500);

    await context.setOffline(true);
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();

    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector("[data-testid=reader-content]")!).fontSize,
      ),
    ).toBe(size);
    expect(
      await page.evaluate(() => document.documentElement.getAttribute("data-theme")),
    ).toBe(theme);
    await context.setOffline(false);
  });

  test("a book that was never opened says so in Uyghur", async ({ page, context }) => {
    await page.goto("/");
    await serviceWorkerReady(page);

    await context.setOffline(true);
    await page.goto(`/books/${markdownBookId()}/read`);

    await expect(page.getByTestId("offline-heading")).toContainText("ساقلانمىغان");
    await expect(page.getByTestId("offline-explanation")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await context.setOffline(false);
  });

  test("search says it needs a connection rather than showing nothing", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await serviceWorkerReady(page);

    await context.setOffline(true);
    await page.goto("/search?q=%D8%A6%D8%A7%D9%84%D8%AA%D9%88%D9%86");

    await expect(page.getByTestId("offline-heading")).toContainText("ئىزدەش");
    await assertNoHorizontalOverflow(page);
    await context.setOffline(false);
  });

  test("signing in fails with an Uyghur message, not a browser error", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await serviceWorkerReady(page);

    // Reaching the page at all, with no connection.
    await context.setOffline(true);
    await page.goto("/login");
    await expect(page.getByTestId("offline-heading")).toContainText("كىرىش");

    // And having got there before the connection dropped: the form says why
    // it will not work, and refuses to take a password going nowhere.
    await context.setOffline(false);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "كىرىش" })).toBeEnabled();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByTestId("auth-offline")).toBeVisible();
    await expect(page.getByRole("button", { name: "كىرىش" })).toBeDisabled();
    await context.setOffline(false);
  });

  test("the offline page lists the books that are actually on the device", async ({
    page,
    context,
  }) => {
    const bookId = seededBookId();
    await page.goto("/");
    await serviceWorkerReady(page);
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();

    await context.setOffline(true);
    await page.goto("/search?q=x");
    const links = page.getByTestId("offline-book-link");
    await expect(links.first()).toBeVisible();
    await expect(links.first()).toContainText("سىناق كىتابى");

    // And the link works — offering one that leads back here would be worse
    // than offering none.
    await links.first().click();
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe("updating", () => {
  test("a waiting worker surfaces the toast, and tapping it takes over", async ({ page }) => {
    await page.goto("/");
    await serviceWorkerReady(page);

    /**
     * A second worker is installed from a different script URL, which is what
     * a deploy looks like from the browser's side: it installs, finds one
     * already in charge, and waits. Registering the byte-identical /sw.js
     * again would be a no-op, so the query string makes it a new script.
     */
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js?dev=1&build=2", {
        scope: "/",
        updateViaCache: "none",
      });
      await new Promise<void>((resolve) => {
        if (registration.waiting) return resolve();
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed") resolve();
          });
        });
      });
    });

    const toast = page.getByTestId("sw-update-toast");
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(toast).toContainText("يېڭى نۇسخا");

    // Nothing in the toast may sit on top of a control the reader needs.
    await assertNoHorizontalOverflow(page);

    await page.getByTestId("sw-update-apply").click();
    // Activating reloads the page through the new worker.
    await page.waitForFunction(
      () => navigator.serviceWorker.controller?.scriptURL.includes("build=2") === true,
      undefined,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("sw-update-toast")).toHaveCount(0);
  });
});

test.describe("nothing private is ever stored", () => {
  test("no admin route and no per-user data is in any cache", async ({ page }) => {
    const bookId = seededBookId();
    await page.goto("/");
    await serviceWorkerReady(page);

    // Walk the site the way a reader does, including the pages that are only
    // reachable with an account, so there is something private to leak.
    for (const path of [
      "/",
      `/books/${bookId}`,
      `/books/${bookId}/read`,
      "/quran",
      "/about",
      "/privacy",
      "/login",
      "/register",
      "/my/account",
      "/notes",
      "/admin",
      "/admin/books",
      "/api/health",
    ]) {
      await page.goto(path).catch(() => undefined);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1500);

    const stored = await storedUrls(page);
    const all = Object.values(stored).flat();
    expect(all.length, "something must have been cached, or this proves nothing").toBeGreaterThan(0);

    const forbidden = [
      "/admin",
      "/api/",
      "/auth/",
      "/my/",
      "/notes",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      // Supabase tables that belong to one person.
      "/rest/v1/bookmarks",
      "/rest/v1/book_notes",
      "/rest/v1/reading_progress",
      "/rest/v1/recent_reads",
      "/rest/v1/note_documents",
      "/rest/v1/profiles",
      // Auth itself: tokens, sessions, sign-in.
      "/auth/v1/",
    ];
    for (const url of all) {
      const path = new URL(url).pathname;
      for (const prefix of forbidden) {
        expect(path.startsWith(prefix), `${url} must never be cached`).toBe(false);
      }
    }

    // Flight data is rendered per session too, and is just as private.
    for (const url of all) expect(url).not.toContain("_rsc=");
  });

  test("a signed-in reader's pages are not left behind for the next person", async ({
    browser,
  }) => {
    const bookId = seededBookId();
    // A real session, from the setup project's stored state.
    const context = await browser.newContext({ storageState: "tests/.auth/staff.json" });
    const page = await context.newPage();

    await page.goto("/");
    await serviceWorkerReady(page);
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    // The bookmark button only exists for someone signed in — proof the page
    // being cached below really was rendered for a session.
    await expect(page.getByTestId("add-bookmark")).toBeVisible();
    await page.waitForTimeout(2000);

    const stored = await storedUrls(page);
    const docs = Object.entries(stored).find(([name]) => name.startsWith("bh-sw-docs"));
    const cached = docs?.[1] ?? [];
    const readerCopy = cached.find((url) => url.includes(`/books/${bookId}/read`));

    if (readerCopy) {
      // Whatever was kept must be the PUBLIC copy: fetched without cookies,
      // so it carries no reading position and no signed-in controls.
      const body = await page.evaluate(async (url) => {
        const hit = await caches.match(url);
        return hit ? hit.text() : null;
      }, readerCopy);
      expect(body, "the cached document must be readable").toBeTruthy();
      expect(body!).not.toContain('data-testid="add-bookmark"');
    }

    // And nothing of theirs anywhere else.
    for (const url of Object.values(stored).flat()) {
      const path = new URL(url).pathname;
      expect(path.startsWith("/my/"), `${url}`).toBe(false);
      expect(path.startsWith("/rest/v1/reading_progress"), `${url}`).toBe(false);
      expect(path.startsWith("/rest/v1/bookmarks"), `${url}`).toBe(false);
    }

    await context.close();
  });
});

test.describe("reclaiming the space", () => {
  test("the account page shows what is stored and can clear it", async ({ browser }) => {
    const bookId = seededBookId();
    const context = await browser.newContext({ storageState: "tests/.auth/staff.json" });
    const page = await context.newPage();

    await page.goto("/");
    await serviceWorkerReady(page);
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await page.waitForTimeout(1500);

    await page.goto("/my/account");
    const size = page.getByTestId("offline-storage-size");
    await expect(size).toBeVisible();
    // A real number, not a placeholder.
    await expect(size).toContainText(/\d/);

    const clear = page.getByTestId("offline-storage-clear");
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect(page.getByTestId("offline-storage-cleared")).toBeVisible({ timeout: 20_000 });

    // Everything the site created is gone, apart from what the worker puts
    // straight back so the offline page still exists.
    const left = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith("bh-"));
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls;
    });
    expect(left.every((url) => url.endsWith("/offline") || url.includes("/fonts/") || url.includes(".css"))).toBe(true);

    await assertNoHorizontalOverflow(page);
    await context.close();
  });
});
