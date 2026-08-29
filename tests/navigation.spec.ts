import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { READER_STATE_PATH, STAFF_STATE_PATH, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

/**
 * What PROMPT-21 repaired, and the things that must not quietly come back.
 *
 * Most of it is about speed, and speed is the hardest thing to assert without
 * writing a flaky test. So none of these measures a duration. They assert the
 * STRUCTURE that makes a navigation feel instant — that a skeleton exists and
 * fits the screen, that the tapped control marks itself pending while the
 * destination is still on its way — and the correctness that the speed was not
 * allowed to cost.
 */

async function assertNoHorizontalOverflow(page: Page, where: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, `${where} must not scroll horizontally`).toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

/**
 * Hold the destination's server response open, so the loading state can be
 * looked at instead of raced past. Only the document and the RSC payload for
 * that path are delayed; the route's own JavaScript is let through, because
 * that is what renders the skeleton.
 */
async function holdRouteOpen(page: Page, path: RegExp, ms = 2500) {
  await page.route(
    (url) => !url.pathname.startsWith("/_next/static") && path.test(url.pathname + url.search),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    },
  );
}

/**
 * On a phone the sidebar lives in the drawer, and a closed drawer is inert.
 * Open it when there is one.
 */
async function openDrawerIfPresent(page: Page) {
  const menu = page.getByTestId("menu-button");
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByTestId("drawer-close")).toBeVisible();
  }
}

/**
 * The sidebar exists twice — once beside the page and once inside the
 * drawer — and which copy is on screen depends on the width. Take the one a
 * reader could actually touch.
 */
function visibleTestId(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`).first();
}

/**
 * Put the page on a slow connection, the way most of this audience reads.
 *
 * A loading state only renders while there is something to wait for, and on
 * localhost against a warm cache there often is not: the destination arrives
 * inside a frame and React goes straight to it. That is a good outcome, not a
 * missing skeleton — but it means the skeleton cannot be looked at unless the
 * response is given a distance to travel. Chromium only, which is what this
 * suite runs.
 */
async function onASlowConnection(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 800,
    // Slow enough that the payload arrives in several chunks. React paints a
    // fallback when it STARTS rendering the new tree and finds it pending; a
    // response that lands in one piece is rendered straight through, which is
    // the right outcome for a reader and an invisible one for a test.
    downloadThroughput: (24 * 1024) / 8,
    uploadThroughput: (24 * 1024) / 8,
  });
}

/**
 * Keep the router's prefetches from landing, so the loading boundary itself
 * is what gets exercised.
 *
 * With prefetching working — which it now is, and which the test below
 * asserts — a link a reader can see has often already been fetched by the
 * time they touch it, and the destination arrives with no fallback at all.
 * That is the best outcome there is, and it makes the skeleton unobservable.
 * These walks are about the OTHER case: the link that was not prefetched, the
 * phone that ran out of patience, the cold cache.
 */
async function withoutPrefetch(page: Page) {
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (headers["next-router-prefetch"] || headers["next-router-segment-prefetch"]) {
      return route.abort();
    }
    return route.continue();
  });
}

/**
 * Watch for the skeleton from inside the page, and note the width of the
 * document at the exact moment it appears.
 *
 * A skeleton is by design short-lived — that is the whole point of it — so
 * asking Playwright to find one after the fact is a race it deserves to lose.
 * This records the first sighting instead, which is both stable and the thing
 * actually being claimed: that between the click and the content there was a
 * frame in which the reader saw the shape of the page they had asked for, and
 * that it fitted their screen.
 */
async function watchForSkeleton(page: Page) {
  await page.evaluate(() => {
    const state: { seen: boolean; scrollWidth: number; innerWidth: number } = {
      seen: false,
      scrollWidth: 0,
      innerWidth: 0,
    };
    (window as unknown as { __skeleton: typeof state }).__skeleton = state;
    const look = () => {
      if (state.seen) return;
      if (!document.querySelector('[data-testid="page-skeleton"]')) return;
      state.seen = true;
      state.scrollWidth = document.documentElement.scrollWidth;
      state.innerWidth = window.innerWidth;
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
    look();
  });
}

async function readSkeletonSighting(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __skeleton?: { seen: boolean; scrollWidth: number; innerWidth: number } })
        .__skeleton ?? { seen: false, scrollWidth: 0, innerWidth: 0 },
  );
}

/**
 * Every skeleton is reached the way a reader reaches it: by clicking a real
 * <Link>, which is the case that was broken — a transition with no loading
 * boundary leaves the old page on screen, untouched, until the whole response
 * has arrived.
 *
 * Between them these cover every piece of the kit in components/skeletons.tsx
 * — the book grid with the library controls, the row stack, the prose page,
 * the two-column book detail and the bare reading surface — at all three
 * widths.
 *
 * A category is not among them, and deliberately: /?cat=N is the SAME route
 * segment as / with different search params, so React may reasonably go
 * straight to it without ever painting the fallback. It renders app/loading
 * .tsx, which the library walk above covers, and the thing that answers a
 * category tap is the dot, which has its own test below.
 */
type SkeletonWalk = {
  name: string;
  from: string;
  testId: string;
  to: RegExp;
  drawer: boolean;
  /**
   * Whether a fallback MUST appear. True everywhere but the book page — see
   * the note on that entry.
   */
  mustShow: boolean;
};

const SKELETON_WALKS: SkeletonWalk[] = [
  {
    name: "the library",
    from: "/about",
    testId: "category-all",
    to: /\/($|\?)/,
    drawer: true,
    mustShow: true,
  },
  {
    name: "what is new",
    from: "/",
    testId: "new-sidebar-link",
    to: /\/new($|\?)/,
    drawer: true,
    mustShow: true,
  },
  {
    name: "the authors",
    from: "/",
    testId: "authors-sidebar-link",
    to: /\/authors($|\?)/,
    drawer: true,
    mustShow: true,
  },
  {
    name: "the Quran index",
    from: "/",
    testId: "quran-link",
    to: /\/quran($|\?)/,
    drawer: false,
    mustShow: true,
  },
  /**
   * The one walk that may legitimately show nothing.
   *
   * A book page answers "does this book exist" in its layout, in front of the
   * boundary, because that is what keeps a missing book a real 404 — and its
   * payload is small, so React often has the whole page in hand before it
   * would have painted a fallback. Going straight to the book is the better
   * outcome. What must hold is that the skeleton fits the screen on the
   * occasions it does appear, and that the card answered the tap, which is
   * its own test below.
   */
  {
    name: "a book",
    from: "/",
    testId: "book-card",
    to: /\/books\/\d+($|\?)/,
    drawer: false,
    mustShow: false,
  },
  {
    name: "a prose page",
    from: "/",
    testId: "about-link",
    to: /\/about($|\?)/,
    drawer: false,
    mustShow: true,
  },
];

test.describe("loading states", () => {
  for (const walk of SKELETON_WALKS) {
    test(`${walk.name} shows a skeleton that fits the screen`, async ({ page }) => {
      await withoutPrefetch(page);
      await page.goto(walk.from);
      if (walk.drawer) await openDrawerIfPresent(page);
      const link = visibleTestId(page, walk.testId);
      await expect(link).toBeVisible();
      await onASlowConnection(page);
      await watchForSkeleton(page);
      await link.click();
      await page.waitForURL(walk.to);
      const sighting = await readSkeletonSighting(page);
      if (walk.mustShow) {
        expect(sighting.seen, `${walk.name} must show a loading state`).toBe(true);
      }
      if (sighting.seen) {
        expect(
          sighting.scrollWidth,
          `the skeleton for ${walk.name} must not scroll horizontally`,
        ).toBeLessThanOrEqual(sighting.innerWidth + 1);
      }
      await assertNoHorizontalOverflow(page, `${walk.name} once it has landed`);
    });
  }

  test("a reading surface gets its own skeleton, not the site header", async ({ page }) => {
    await withoutPrefetch(page);
    await page.goto("/quran");
    const sura = visibleTestId(page, "sura-link");
    await expect(sura).toBeVisible();
    await onASlowConnection(page);
    await page.evaluate(() => {
      const state = { headerWhileLoading: 0, seen: false };
      (window as unknown as { __bare: typeof state }).__bare = state;
      const look = () => {
        if (!document.querySelector('[data-testid="page-skeleton"]')) return;
        state.seen = true;
        // A bare surface carries its own toolbar. If the site header were
        // here it would appear and then vanish again the moment the real
        // mushaf took over.
        state.headerWhileLoading += document.querySelectorAll('[data-testid="menu-button"]').length;
      };
      new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
      look();
    });
    await sura.click();
    await page.waitForURL(/\/quran\/\d+/);
    const state = await page.evaluate(
      () =>
        (window as unknown as { __bare?: { headerWhileLoading: number; seen: boolean } }).__bare ?? {
          headerWhileLoading: 0,
          seen: false,
        },
    );
    expect(state.seen, "the mushaf must show a loading state").toBe(true);
    expect(state.headerWhileLoading, "a bare surface must not flash the site header").toBe(0);
    await assertNoHorizontalOverflow(page, "the mushaf once it has landed");
  });
});

test.describe("prefetching", () => {
  /**
   * Before this work there was nothing for a prefetch to fetch: every route
   * was dynamic and none had a loading boundary, so hovering a link bought
   * almost nothing. Now the shell of the destination can be had ahead of the
   * click, and on the links a reader is most likely to take next — a book
   * card — it is.
   */
  test("the destination a reader is most likely to open is fetched ahead of the click", async ({
    page,
  }) => {
    const prefetched: string[] = [];
    page.on("request", (request) => {
      const headers = request.headers();
      if (!headers["next-router-prefetch"] && !headers["next-router-segment-prefetch"]) return;
      prefetched.push(new URL(request.url()).pathname);
    });
    await page.goto("/");
    await expect(visibleTestId(page, "book-card")).toBeVisible();
    await expect
      .poll(() => prefetched.some((path) => path.startsWith("/books/")), {
        message: "a visible book card must be prefetched",
        timeout: 10_000,
      })
      .toBe(true);
  });
});

test.describe("a tap answers itself", () => {
  test("a category marks itself pending before any content arrives", async ({ page }) => {
    // Prefetch skips the pending state by design: there is nothing to wait
    // for. This is the other case, which is the one that needed answering.
    await withoutPrefetch(page);
    await page.goto("/");
    const before = await page.getByTestId("library-count").textContent();
    await openDrawerIfPresent(page);
    await holdRouteOpen(page, /^\/\?cat=/);
    const link = visibleTestId(page, "category-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(link.locator(".link-hint")).toHaveClass(/is-pending/, { timeout: 3000 });
    // Still pending means still the old content — the acknowledgement really
    // does arrive before the destination does.
    expect(await page.getByTestId("library-count").textContent()).toBe(before);
  });

  test("a nav item marks itself pending", async ({ page }) => {
    await withoutPrefetch(page);
    await page.goto("/");
    await openDrawerIfPresent(page);
    await holdRouteOpen(page, /^\/authors(\?|$)/);
    const link = visibleTestId(page, "authors-sidebar-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(link.locator(".link-hint")).toHaveClass(/is-pending/, { timeout: 3000 });
  });

  test("a book card marks itself pending", async ({ page }) => {
    await withoutPrefetch(page);
    await page.goto("/");
    await holdRouteOpen(page, /^\/books\/\d+(\?|$)/);
    const card = visibleTestId(page, "book-card");
    await expect(card).toBeVisible();
    await card.click();
    await expect(card.locator(".link-hint")).toHaveClass(/is-pending/, { timeout: 3000 });
  });

  test("the dot never moves the row it sits in", async ({ page }) => {
    await page.goto("/");
    await openDrawerIfPresent(page);
    const link = visibleTestId(page, "category-link");
    await expect(link).toBeVisible();
    const before = await link.boundingBox();
    await link.locator(".link-hint").evaluate((node) => node.classList.add("is-pending"));
    const after = await link.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
  });
});

test.describe("the streamed shell still knows who is reading", () => {
  test("a visitor with no account is offered the sign-in link", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("login-link")).toBeVisible();
    await expect(page.getByTestId("notes-link")).toHaveCount(0);
    await expect(page.getByTestId("account-link")).toHaveCount(0);
    await context.close();
  });

  test("a signed-in reader gets their own controls", async ({ browser }) => {
    test.skip(!hasStaffTestEnv(), "needs the Supabase test project");
    const context = await browser.newContext({ storageState: READER_STATE_PATH });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("login-link")).toHaveCount(0);
    await expect(page.getByTestId("account-link")).toBeVisible();
    await expect(page.getByTestId("notes-sidebar-link").first()).toBeAttached();
    await context.close();
  });
});

test.describe("nothing about speed loosened the guard on /admin", () => {
  test("a visitor with no account is sent to sign in", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("an ordinary reader is sent away", async ({ browser }) => {
    test.skip(!hasStaffTestEnv(), "needs the Supabase test project");
    const context = await browser.newContext({ storageState: READER_STATE_PATH });
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole("link", { name: "باشقۇرۇش سۇپىسى" })).toHaveCount(0);
    await context.close();
  });

  /**
   * The identity is verified where it is used and never travels on a request
   * header, so there is no header to forge. This asserts exactly that: every
   * plausible spelling of "trust me, I am the admin" is sent from outside and
   * changes nothing at all.
   */
  test("a forged identity header from outside is ignored", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: {
        "x-bh-user": "00000000-0000-0000-0000-000000000000",
        "x-bh-role": "admin",
        "x-user-id": "00000000-0000-0000-0000-000000000000",
        "x-user-role": "admin",
        "x-supabase-user": "00000000-0000-0000-0000-000000000000",
      },
    });
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page.getByTestId("login-link")).toBeVisible();
    await context.close();
  });
});

test.describe("what the cache may and may not hold", () => {
  test("publishing a book shows it at once, with no timer to wait for", async ({ browser }) => {
    test.skip(!hasStaffTestEnv(), "needs the Supabase test project");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const stamp = Date.now();
    const title = `__e2e_cache__ ${stamp}`;
    const { data: created, error } = await admin
      .from("books")
      .insert({
        title,
        author: "",
        format: "txt",
        status: "draft",
        page_count: 1,
        content_format: "text",
        file_hash: `__e2e_cache_${stamp}`,
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    const bookId = (created as { id: number }).id;

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const reader = await anonymous.newPage();
    try {
      // Warm the shared cache with a library that does NOT hold this book.
      await reader.goto("/new");
      await expect(reader.getByText(title)).toHaveCount(0);

      // Publish it the way the owner does: the admin list, the bulk action.
      const staff = await browser.newContext({ storageState: STAFF_STATE_PATH });
      const staffPage = await staff.newPage();
      await staffPage.goto(`/admin/books?q=${encodeURIComponent("__e2e_cache__")}`);
      await staffPage.getByRole("checkbox", { name: `${title} — تاللاش` }).check();
      await staffPage.getByRole("button", { name: "ئېلان قىلىش" }).click();
      await expect(staffPage.getByRole("status")).toBeVisible();
      await staff.close();

      // No wait, no reload loop, no hour: the next visitor sees it.
      await reader.goto("/new");
      await expect(reader.getByText(title).first()).toBeVisible();
    } finally {
      await anonymous.close();
      await admin.from("books").delete().eq("id", bookId);
    }
  });

  test("one reader's page is never handed to another", async ({ browser }) => {
    test.skip(!hasStaffTestEnv(), "needs the Supabase test project");
    // A signed-in reader's home page carries their own account controls and,
    // once they have opened a book, their own reading history. If any of that
    // were shared through a cache, it would arrive in the second context.
    const signedIn = await browser.newContext({ storageState: READER_STATE_PATH });
    const first = await signedIn.newPage();
    await first.goto("/");
    await expect(first.getByTestId("account-link")).toBeVisible();
    await signedIn.close();

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const second = await anonymous.newPage();
    await second.goto("/");
    await expect(second.getByTestId("login-link")).toBeVisible();
    await expect(second.getByTestId("account-link")).toHaveCount(0);
    await expect(second.getByTestId("recent-strip")).toHaveCount(0);
    await anonymous.close();
  });
});
