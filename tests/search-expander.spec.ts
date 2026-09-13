import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  SEED_BOOK_TITLE,
  SEED_STRETCHED,
  SEED_STRETCHED_PAGE,
  SEED_STRETCHED_PLAIN,
  hasStaffTestEnv,
  loadEnvLocal,
} from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * «بۇ كىتابتىكى بارلىق ئورۇنلارنى كۆرۈش» — the expander under each result.
 *
 * It used to narrow a book's pages with a raw `ilike` on the stored text
 * before the matcher ever ran, so a word written with tatweel or a diacritic
 * — half the library's pages — was listed by search and answered «باشقا
 * ئورۇن تېپىلمىدى» directly beneath the result; and a book with more than
 * 120 matching pages was counted short with no «+» (PROMPT-34). It is built
 * on book_match_pages now, the same answer the reader's ↑ ↓ counter starts
 * from, so the two cannot disagree.
 *
 * The seeded word is written ONLY stretched; every search here types it plain.
 */

/** The seeded book's group — never `.first()`, in case the word is elsewhere too. */
function seededGroup(page: Page): Locator {
  return page.getByTestId("search-book-group").filter({ hasText: SEED_BOOK_TITLE });
}

async function searchAndExpand(page: Page): Promise<Locator> {
  await page.goto(`/search?q=${encodeURIComponent(SEED_STRETCHED_PLAIN)}`);
  const group = seededGroup(page);
  await expect(group).toBeVisible({ timeout: 20_000 });
  await group.getByTestId("expand-book-matches").click();
  await expect(group.getByTestId("expanded-match").first()).toBeVisible({ timeout: 20_000 });
  return group;
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
async function topMostTestIdAt(page: Page, control: Locator): Promise<string | null> {
  const box = await control.boundingBox();
  expect(box, "the control must have a box").not.toBeNull();
  return page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
    },
    [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
  );
}

test.describe("a word the book writes only stretched", () => {
  test("the plain spelling finds the book, and the expander lists the place", async ({ page }) => {
    const group = await searchAndExpand(page);

    const entry = group.getByTestId("expanded-match").first();
    await expect(entry.getByTestId("page-chip")).toHaveText(`${SEED_STRETCHED_PAGE}-بەت`);
    // Highlighted as the book writes it — tatweel and all — the way the reader marks it.
    await expect(entry.locator("mark")).toHaveText(SEED_STRETCHED);
    await expect(entry).toHaveAttribute(
      "href",
      new RegExp(`/read\\?page=${SEED_STRETCHED_PAGE}&q=${encodeURIComponent(SEED_STRETCHED_PLAIN)}&m=0`),
    );
  });

  test("the expander's count is the reader's n/total counter for the same phrase", async ({ page }) => {
    const group = await searchAndExpand(page);

    const counted = /(\d+)(\+?)/.exec(await group.getByTestId("expanded-count").innerText());
    expect(counted, "the count line names a number").not.toBeNull();
    const [, total, plus] = counted!;

    await group.getByTestId("expanded-match").first().click();
    await expect(page).toHaveURL(new RegExp(`/books/\\d+/read\\?page=${SEED_STRETCHED_PAGE}`));
    // Same number, same «+» — both come from book_match_pages.
    await expect(page.getByTestId("match-count")).toHaveText(
      new RegExp(`^\\d+/${total}${plus ? "\\+" : ""}$`),
      { timeout: 20_000 },
    );
  });

  test("at 360 px nothing overflows and the button survives a scroll down and back up", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    const group = await searchAndExpand(page);
    await assertNoHorizontalOverflow(page);

    await scrollDownAndBackUp(page);
    await assertNoHorizontalOverflow(page);
    const button = group.getByTestId("expand-book-matches");
    await expect(button).toBeInViewport();
    expect(await topMostTestIdAt(page, button), "the button must not be covered").toBe(
      "expand-book-matches",
    );
    const box = await button.boundingBox();
    expect(box!.height, "touch target must be at least 44 px").toBeGreaterThanOrEqual(44);
  });
});
