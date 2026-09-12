import { test, expect, type Page } from "@playwright/test";
import { SEED_NEEDLE, SEED_NEEDLE_PAGE, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Searching the WHOLE library, as a reader without an account.
 *
 * With the scope left at «بارلىق كىتابلار» — the default on every page —
 * every search on the live site answered «ئىزدەشتە خاتالىق كۆرۈلدى» on
 * 2026-09-11: the database walked all 17,601 pages instead of reading the
 * index and hit the 3 s statement timeout anonymous visitors get. The
 * existing specs searched signed in (8 s) or inside a category, and passed.
 *
 * These run anonymously against the owner's live Supabase through the dev
 * server, at every width, so they only pass once migration 0025 is applied.
 *
 * A word that occurs nowhere is the sharpest probe: the index answers it at
 * once, a scan of every page cannot.
 */
const NOWHERE = "قققزززخخخ";

/** The header box is hidden below md; there the magnifier opens its own panel. */
function narrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 768;
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

async function scrollDownAndBackUp(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

/** The element actually on top at a control's centre — catches covered buttons. */
async function topMostTestIdAt(page: Page, testId: string): Promise<string | null> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} must have a box`).not.toBeNull();
  return page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
    },
    [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
  );
}

/**
 * No failure notice on the page. Scoped to <main>: Next mounts its own route
 * announcer with role="alert" at the end of every body, so a bare
 * getByRole("alert") always finds one element.
 */
async function expectNoSearchFailure(page: Page) {
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("search-timeout")).toHaveCount(0);
  await expect(page.getByTestId("search-failed")).toHaveCount(0);
}

/** Type into the header's search box — the desktop field or the phone panel. */
async function searchFromHeader(page: Page, term: string) {
  if (narrow(page)) {
    const opener = page.getByRole("button", { name: "ئىزدەش رامكىسىنى ئېچىش" });
    if ((await opener.getAttribute("aria-expanded")) !== "true") await opener.click();
  }
  const scope = page.getByTestId(narrow(page) ? "header-scope-mobile" : "header-scope");
  await expect(scope, "the scope is left where every reader finds it").toHaveAttribute("data-scope", "all");
  const input = page.getByTestId(narrow(page) ? "header-search-mobile" : "header-search");
  await input.fill(term);
  await input.press("Enter");
  await page.waitForURL(/\/search\?/);
}

test.describe("the whole library, anonymously", () => {
  test("the header box finds the seeded word with «بارلىق كىتابلار»", async ({ page }) => {
    await page.goto("/");
    await searchFromHeader(page, SEED_NEEDLE);

    expect(new URL(page.url()).searchParams.has("cat"), "no category was chosen").toBe(false);
    await expect(page.getByTestId("search-result").first()).toBeVisible({ timeout: 20_000 });
    await expectNoSearchFailure(page);
    await expect(page.getByTestId("search-scope")).toHaveAttribute("data-scope", "all");
    await assertNoHorizontalOverflow(page);
  });

  test("a word that occurs nowhere answers «ھېچنېمە تېپىلمىدى», not an error", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(NOWHERE)}`);
    await expect(page.getByTestId("search-empty")).toBeVisible({ timeout: 20_000 });
    await expectNoSearchFailure(page);
  });

  test("a result opens the reader with the ↑ ↓ navigator and its counter", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await page.getByTestId("search-result").first().click();
    await expect(page).toHaveURL(new RegExp(`/books/\\d+/read\\?page=${SEED_NEEDLE_PAGE}`));
    // book_match_pages answered: the counter exists, and counts something.
    await expect(page.getByTestId("match-count")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("match-count")).toHaveText(/^\d+\/[1-9]\d*\+?$/);
    await expect(page.getByTestId("match-none")).toHaveCount(0);
  });

  test("every control on the results page survives a scroll down and back up", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await expect(page.getByTestId("search-result").first()).toBeVisible({ timeout: 20_000 });
    await scrollDownAndBackUp(page);
    for (const testId of ["search-input", "search-scope", "search-submit"]) {
      await expect(page.getByTestId(testId)).toBeVisible();
      expect(await topMostTestIdAt(page, testId), `${testId} must not be covered`).toBe(testId);
    }
    const scope = await page.getByTestId("search-scope").boundingBox();
    expect(scope!.height, "touch target must be at least 44 px").toBeGreaterThanOrEqual(44);
  });
});

test.describe("at 360 px, the narrowest phone this library is read on", () => {
  test("results and the empty state fit without a horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });

    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await expect(page.getByTestId("search-result").first()).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);
    await scrollDownAndBackUp(page);
    await assertNoHorizontalOverflow(page);
    for (const testId of ["search-input", "search-scope", "search-submit"]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }

    await page.goto(`/search?q=${encodeURIComponent(NOWHERE)}`);
    await expect(page.getByTestId("search-empty")).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);
  });
});
