import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { SupabaseMock } from "./fixtures/supabase-mock";
import { assertNoHorizontalOverflow, assertTappable } from "./fixtures/auth-pages";

/**
 * What a reader sees when search is flooded or the database does not answer
 * (PROMPT-40) — at 375×667, 390×844 and 1280×800.
 *
 * Against the FAKE Supabase on :3300 (tests/fixtures/supabase-mock.ts), never
 * the real project, and never a real flood: the fake answers the search RPCs
 * exactly as migration 0028 does when every slot is in use (HTTP 429,
 * `PT429 bh:search_busy`), and fails a table the way a stalled database does.
 * The searches are rendered on the server, where `page.route` cannot reach,
 * which is why this runs against the fake rather than with routes.
 *
 * The flood itself — the slots holding, the reading pages staying fast — is
 * measured against a real local Postgres by scripts/flood/ (docs/search-flood.md).
 */

const mock = new SupabaseMock();
const WORD = "ناماز";
const BUSY_TEXT = "ھازىر ئىزدەۋاتقانلار كۆپ";

test.beforeAll(async () => {
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

test.beforeEach(async ({ page }) => {
  await mock.reset();
  // Its own address, so the site's per-address brake (SEARCH_RULE) never
  // decides these tests: what is under test is the database's answer.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.19.${randomInt(1, 255)}.${randomInt(1, 255)}` });
});

const calls = (fn: string) => mock.rpcCalls.filter((name) => name === fn).length;

async function expectRightToLeft(page: Page) {
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
}

test.describe("search, when every slot is in use", () => {
  test("says so calmly, and the retry keeps the word, the scope and the page", async ({ page }) => {
    mock.answerRpcBusy("search_books");
    await page.goto(`/search?q=${encodeURIComponent(WORD)}&cat=7&p=2`);

    const busy = page.getByTestId("search-busy");
    await expect(busy).toBeVisible();
    await expect(busy).toContainText(BUSY_TEXT);
    // Not dressed as a failure: no alert, none of the error messages.
    await expect(busy).toHaveAttribute("role", "status");
    await expect(page.getByTestId("search-failed")).toHaveCount(0);
    await expect(page.getByTestId("search-timeout")).toHaveCount(0);
    await expectRightToLeft(page);

    const retry = page.getByTestId("search-busy-retry");
    const target = new URL((await retry.getAttribute("href"))!, "http://localhost");
    expect(target.pathname).toBe("/search");
    expect(target.searchParams.get("q")).toBe(WORD);
    expect(target.searchParams.get("cat")).toBe("7");
    expect(target.searchParams.get("p")).toBe("2");
    await assertTappable(page, retry, "the busy message's «قايتا سىناش»");

    // A slot comes free; the same button asks the database again.
    mock.clearRpc("search_books");
    const before = calls("search_books");
    await retry.click();
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await expect(page.getByTestId("search-busy")).toHaveCount(0);
    expect(calls("search_books")).toBeGreaterThan(before);
  });

  test("a result page is noindex, follow; the search page itself stays indexable", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(WORD)}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await page.goto("/search");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  });

  test("the «every place in this book» expander says busy, and its button asks again", async ({ page }) => {
    mock.answerRpc("search_books", 200, [
      {
        book_id: 1,
        title: "سىناق كىتابى",
        author: "سىناق",
        cover_path: null,
        page_no: 3,
        snippet: `بۇ بەتتە ${WORD} دېگەن سۆز بار.`,
        rank: 0.5,
        capped: false,
      },
    ]);
    mock.answerRpcBusy("book_match_pages");
    await page.goto(`/search?q=${encodeURIComponent(WORD)}`);

    const expand = page.getByTestId("expand-book-matches");
    await expand.click();
    const busy = page.getByTestId("expand-busy");
    await expect(busy).toBeVisible();
    await expect(busy).toContainText(BUSY_TEXT);
    // Still the "show" button, not "collapse": tapping it again is the retry.
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await assertTappable(page, expand, "the expander after a busy answer");

    mock.answerRpc("book_match_pages", 200, []);
    await expand.click();
    await expect(page.getByText("باشقا ئورۇن تېپىلمىدى.")).toBeVisible();
    await expect(busy).toHaveCount(0);
  });

  test("the Qur'an search says busy too, with its own retry", async ({ page }) => {
    mock.answerRpcBusy("search_quran");
    await page.goto(`/quran?q=${encodeURIComponent("الله")}`);

    const busy = page.getByTestId("quran-search-busy");
    await expect(busy).toBeVisible();
    await expect(busy).toContainText(BUSY_TEXT);
    await expectRightToLeft(page);
    const retry = page.getByTestId("quran-search-busy-retry");
    expect(new URL((await retry.getAttribute("href"))!, "http://localhost").searchParams.get("q")).toBe("الله");
    await assertTappable(page, retry, "the Qur'an busy message's «قايتا سىناش»");
  });
});

test.describe("when the database does not answer", () => {
  test("the home page shows the Uyghur error page within seconds, and recovers on retry", async ({ page }) => {
    // The books table is what the home page's shelf — and the sidebar's
    // counts — read. Whether the root layout or the page fails first depends
    // on what the shared cache already holds; either way the reader gets the
    // same message (app/error.tsx or app/global-error.tsx).
    mock.failTable("books");
    const started = Date.now();
    await page.goto("/");

    const error = page.getByTestId("error-page");
    await expect(error).toBeVisible({ timeout: 20_000 });
    expect(Date.now() - started, "the error page must come within seconds").toBeLessThan(20_000);
    await expect(error).toContainText("كۇتۇپخانا ھازىر جاۋاب بەرمىدى");
    await expectRightToLeft(page);
    await assertNoHorizontalOverflow(page);
    await assertTappable(page, page.getByTestId("error-retry"), "the error page's «قايتا سىناش»");
    await assertTappable(page, page.getByTestId("error-home"), "the error page's «باش بەت»");

    mock.clearTable("books");
    await page.getByTestId("error-retry").click();
    await expect(page.getByTestId("error-page")).toHaveCount(0, { timeout: 20_000 });
  });
});
