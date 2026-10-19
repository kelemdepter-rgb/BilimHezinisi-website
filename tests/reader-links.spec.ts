import { expect, test, type Locator, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal, readLinksSeed } from "./env";
import {
  LINKED_BODY_PHRASE,
  LINKED_BODY_PHRASE_PAGE,
  LINKED_FOOTNOTE,
  LINKED_SHORT_PAGES,
  LINKED_TOC,
  linkedBookRows,
} from "./fixtures/linked-book";
import { outlineFromPages } from "../lib/reader/outline";
import { countOccurrences } from "../lib/search/occurrences";
import { LINK_NOT_FOUND_TEXT } from "../lib/reader/link-messages";

loadEnvLocal();

/**
 * In-book links (PROMPT-51): a Word table of contents and its notes, followed
 * from the book's own text. The book is the seeded DRAFT from auth.setup.ts
 * (tests/fixtures/linked-book.ts), read as staff.
 *
 * Both database functions the reader calls are answered here, from the same
 * pages the setup seeded:
 *   - book_outline, by its TypeScript twin — so the spec does not depend on
 *     migration 0032 being applied; one case answers 404 instead, as a
 *     database without the migration does;
 *   - book_match_pages, which answers nothing for a draft by design (0029),
 *     by the client matcher over the seeded pages — what the phrase fallback
 *     is given, not how the database finds it, is what is tested here.
 * The service worker is blocked so every request is the page's own.
 */

test.skip(!hasStaffTestEnv(), "Supabase env not configured");
test.use({ serviceWorkers: "block" });

const ROWS = linkedBookRows();
const entry = (fragment: string) => LINKED_TOC.find((item) => item.fragment === fragment)!;

function bookId(): number {
  const seed = readLinksSeed();
  if (!seed) throw new Error("links seed missing — the setup project must run first");
  return seed.bookId;
}

async function stub(page: Page, outline: "answer" | "missing" = "answer") {
  await page.route("**/rest/v1/rpc/book_outline*", (route) =>
    outline === "answer"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(outlineFromPages(ROWS)) })
      : route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            code: "PGRST202",
            details: null,
            hint: null,
            message: "Could not find the function public.book_outline(p_book_id) in the schema cache",
          }),
        }),
  );
  await page.route("**/rest/v1/rpc/book_match_pages*", (route) => {
    const { q } = JSON.parse(route.request().postData() ?? "{}") as { q?: string };
    const pages = ROWS.map((row) => ({ page_no: row.page_no, hits: countOccurrences(row.content, q ?? "") })).filter(
      (row) => row.hits > 0,
    );
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pages) });
  });
}

/** Open the book at its first page, hydrated — a click before that would follow the bare #fragment. */
async function open(page: Page, outline: "answer" | "missing" = "answer") {
  await stub(page, outline);
  await page.goto(`/books/${bookId()}/read?page=1`);
  await expect(tocLink(page, "QBH1")).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => {
    const content = document.querySelector('[data-testid="reader-content"]');
    return Boolean(content && Object.keys(content).some((key) => key.startsWith("__reactProps")));
  });
}

/** The bottom bar's status line: «يۈكلىنىۋاتىدۇ…», or why a link could not be followed. */
function linkStatus(page: Page): Locator {
  return page.getByTestId("reader-bottom-bar").getByRole("status");
}

function tocLink(page: Page, fragment: string): Locator {
  return page.locator(`[data-page-no] .md-body a[href="#${fragment}"]`).first();
}

function headingOn(page: Page, pageNo: number, text: string): Locator {
  return page.locator(`[data-page-no="${pageNo}"] .md-body :is(h1, h2)`).filter({ hasText: text }).first();
}

/** The page under the toolbar — the one a reader is on. */
function currentPage(page: Page): Promise<number> {
  return page.evaluate(() => {
    const headerBottom = document.querySelector('[data-testid="reader-toolbar"]')!.getBoundingClientRect().bottom;
    for (const node of document.querySelectorAll<HTMLElement>("[data-page-no]")) {
      if (node.getBoundingClientRect().bottom > headerBottom + 1) return Number(node.dataset.pageNo);
    }
    return -1;
  });
}

/** Clear of the toolbar above and the bottom bar below. */
async function expectClear(page: Page, target: Locator) {
  await expect(target).toBeInViewport();
  const box = (await target.boundingBox())!;
  const header = (await page.getByTestId("reader-toolbar").boundingBox())!;
  const bar = (await page.getByTestId("reader-bottom-bar").boundingBox())!;
  expect(box.y, "below the toolbar").toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(box.y + box.height, "above the bottom bar").toBeLessThanOrEqual(bar.y + 1);
}

/** Follow a link and prove the address bar never moved. */
async function follow(page: Page, link: Locator) {
  const before = await page.evaluate(() => history.length);
  await link.scrollIntoViewIfNeeded();
  await link.click();
  expect(await page.evaluate(() => ({ hash: location.hash, length: history.length }))).toEqual({
    hash: "",
    length: before,
  });
}

/** Still in the same place once loading is over and a second has passed. */
async function expectSettled(page: Page, target: Locator) {
  const landed = (await target.boundingBox())!.y;
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  expect(Math.abs((await target.boundingBox())!.y - landed), "the landing must not move").toBeLessThanOrEqual(2);
}

async function expectChapter(page: Page, fragment: string) {
  const { heading, page: pageNo } = entry(fragment);
  await follow(page, tocLink(page, fragment));
  const target = headingOn(page, pageNo!, heading!);
  await expect(target).toBeVisible({ timeout: 20_000 });
  await expectClear(page, target);
  // Just under the toolbar, where a chapter starts.
  const header = (await page.getByTestId("reader-toolbar").boundingBox())!;
  expect((await target.boundingBox())!.y - (header.y + header.height)).toBeLessThan(40);
  expect(await currentPage(page), "the reader is on the chapter's page").toBe(pageNo);
  await expectSettled(page, target);
  await expectClear(page, target);
  return target;
}

async function expectNoOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, "no horizontal scroll").toBeLessThanOrEqual(innerWidth + 1);
}

test.describe("table of contents", () => {
  test("an entry on the contents' own last page lands on its chapter", async ({ page }) => {
    await open(page);
    await expectChapter(page, "QBH1");
    await expectNoOverflow(page);
  });

  test("a chapter far outside the loaded pages is loaded and held in place", async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-page-no="30"]')).toHaveCount(0);
    await expectChapter(page, "QBH7");
    // The short pages above it brought the reader to load the ones before
    // them while it landed — and the heading did not move (expectChapter).
    await expect(page.locator(`[data-page-no="${Math.min(...LINKED_SHORT_PAGES) - 1}"]`)).toHaveCount(1);
    // Each page once, in order: no load landed twice or beside the wrong window.
    const numbers = await page
      .locator("[data-page-no]")
      .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.pageNo)));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => numbers[0] + index));
  });

  test("a repeated title goes to the right one, and a joined subtitle to its heading", async ({ page }) => {
    await open(page);
    await expectChapter(page, "QBH5");
    await open(page);
    await expectChapter(page, "QBH6");
  });

  test("the keyboard follows an entry and puts focus on the chapter", async ({ page, browserName }) => {
    await open(page);
    await tocLink(page, "QBH1").focus();
    await page.keyboard.press("Tab");
    const next = tocLink(page, "QBH2");
    // WebKit only tabs to links when the platform's setting says so.
    if (browserName === "webkit" && !(await next.evaluate((element) => element === document.activeElement))) {
      await next.focus();
    }
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    const { heading, page: pageNo } = entry("QBH2");
    const target = headingOn(page, pageNo!, heading!);
    await expect(target).toBeFocused({ timeout: 20_000 });
    await expectClear(page, target);
    expect(await page.evaluate(() => location.hash)).toBe("");
  });
});

test.describe("notes", () => {
  test("a footnote is followed there and back", async ({ page }) => {
    await open(page);
    const mark = page.locator(`[data-page-no="${LINKED_FOOTNOTE.textPage}"] a[href="#${LINKED_FOOTNOTE.mark}"]`);
    await follow(page, mark);
    const note = page.locator(`[data-page-no="${LINKED_FOOTNOTE.notePage}"] a[href="#${LINKED_FOOTNOTE.back}"]`);
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expectClear(page, note);
    await expectSettled(page, note);

    await follow(page, note);
    await expect(mark).toBeInViewport({ timeout: 20_000 });
    await expectClear(page, mark);
  });
});

test.describe("when the book does not say", () => {
  test("an entry whose target is only body text is found by searching for it", async ({ page }) => {
    await open(page);
    await follow(page, tocLink(page, "QBH8"));
    const active = page.locator(`[data-page-no="${LINKED_BODY_PHRASE_PAGE}"] .match-active`);
    await expect(active).toBeVisible({ timeout: 20_000 });
    await expect(active).toHaveText(LINKED_BODY_PHRASE);
    await expectClear(page, active);
  });

  test("an entry that leads nowhere says so and leaves the reader where it was", async ({ page }) => {
    await open(page);
    const link = tocLink(page, "QBH9");
    await link.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await follow(page, link);
    await expect(linkStatus(page)).toHaveText(LINK_NOT_FOUND_TEXT, { timeout: 20_000 });
    await expect(linkStatus(page)).toBeInViewport();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(1);
  });

  test("before the migration, an entry still reaches its chapter by its words", async ({ page }) => {
    await open(page, "missing");
    const { heading, page: pageNo } = entry("QBH2");
    await follow(page, tocLink(page, "QBH2"));
    const active = page.locator(`[data-page-no="${pageNo}"] .md-body h1 .match-active`);
    await expect(active).toBeVisible({ timeout: 20_000 });
    await expect(active).toHaveText(heading!);
    await expectClear(page, active);
    expect(await page.evaluate(() => location.hash)).toBe("");
  });
});
