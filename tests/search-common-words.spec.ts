import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { SupabaseMock } from "./fixtures/supabase-mock";
import { assertNoHorizontalOverflow, assertTappable } from "./fixtures/auth-pages";

/**
 * The most common words (PROMPT-41) — at 375×667, 390×844 and 1280×800.
 *
 * On 2026-10-05 a whole-library search for «ئاللاھ» ended, every time, in
 * «ئىزدەش بەك ئۇزۇن ۋاقىت ئالدى». Migration 0029 answers it from the index in
 * well under a second; what a reader then sees is checked here: results with
 * the honest «too common» notice, and — for a phrase whose words fill so many
 * pages that only part of the library was opened — a notice that says so,
 * never «nothing found» and never the timeout.
 *
 * Against the FAKE Supabase on :3300 (tests/fixtures/supabase-mock.ts), which
 * answers search_books the way 0029 does. The search runs on the server, where
 * `page.route` cannot reach. The real function is proved against a real
 * Postgres in tests/unit/search-common-words-sql.test.ts and timed against a
 * copy of the real library by scripts/search-timing.mjs.
 */

const mock = new SupabaseMock();
const HARD = "ئاللاھ";
const PHRASE = "پەيغەمبەر ئاللاھ";
const TIMEOUT_TEXT = "ئىزدەش بەك ئۇزۇن ۋاقىت ئالدى";

type Flags = { capped: boolean; partial: boolean };

/** `count` page hits over a few books, as search_books returns them. */
function hits(count: number, flags: Flags) {
  return Array.from({ length: count }, (_, index) => ({
    book_id: 100 + (index % 4),
    title: `سىناق كىتابى ${index % 4}`,
    author: "سىناق",
    cover_path: null,
    page_no: index + 1,
    snippet: `بۇ ${index + 1}-بەتتە ${HARD} دېگەن سۆز بار.`,
    rank: 1 - index / 100,
    ...flags,
  }));
}

/** 0029's answer when the part searched held nothing: flags, no book. */
const NOTHING_IN_THE_PART_SEARCHED = [
  { book_id: null, title: null, author: null, cover_path: null, page_no: null, snippet: null, rank: null, capped: false, partial: true },
];

test.beforeAll(async () => {
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

test.beforeEach(async ({ page }) => {
  await mock.reset();
  // Its own address, so the site's per-address brake never decides a test.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.20.${randomInt(1, 255)}.${randomInt(1, 255)}` });
});

/** Nothing in the way, on any of the three screens, before or after scrolling. */
async function assertControlsReachable(page: Page) {
  await assertNoHorizontalOverflow(page);
  await assertTappable(page, page.getByTestId("search-input"), "the search box");
  await assertTappable(page, page.getByTestId("search-submit"), "«ئىزدەش»");
  await assertTappable(page, page.getByTestId("search-scope"), "the scope picker");
}

async function expectNoFailure(page: Page) {
  await expect(page.getByTestId("search-timeout")).toHaveCount(0);
  await expect(page.getByTestId("search-failed")).toHaveCount(0);
  await expect(page.getByText(TIMEOUT_TEXT)).toHaveCount(0);
}

test.describe("the most common words", () => {
  test(`«${HARD}» over the whole library: results and the «too common» notice, never the timeout`, async ({ page }) => {
    // 21 rows for a page of 20: there is a next page.
    mock.answerRpc("search_books", 200, hits(21, { capped: true, partial: false }));
    await page.goto(`/search?q=${encodeURIComponent(HARD)}`);

    await expect(page.getByTestId("search-meta")).toBeVisible();
    await expect(page.getByTestId("search-result").first()).toBeVisible();
    const notice = page.getByTestId("search-too-common");
    await expect(notice).toBeVisible();
    // The guidance: another word, or a category.
    await expect(notice).toContainText("يەنە بىر سۆز قوشۇڭ ياكى بىر تۈرنى تاللاڭ");
    await expect(page.getByTestId("search-partial")).toHaveCount(0);
    await expect(page.getByTestId("search-empty")).toHaveCount(0);
    await expectNoFailure(page);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");

    await assertControlsReachable(page);
    await assertTappable(page, page.getByRole("link", { name: "كېيىنكى" }), "«كېيىنكى»");
    expect(mock.rpcCalls).toContain("search_books");
  });

  test("a phrase whose words fill the library: what the part searched found, said as such", async ({ page }) => {
    mock.answerRpc("search_books", 200, hits(3, { capped: false, partial: true }));
    await page.goto(`/search?q=${encodeURIComponent(PHRASE)}`);

    await expect(page.getByTestId("search-result")).toHaveCount(3);
    const notice = page.getByTestId("search-partial");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("كۇتۇپخانىنىڭ بىر قىسمىلا");
    await expect(notice).toContainText("بىر تۈرنى تاللاڭ ياكى يەنە بىر سۆز قوشۇڭ");
    await expect(page.getByTestId("search-too-common")).toHaveCount(0);
    await expectNoFailure(page);

    await assertControlsReachable(page);
  });

  test("…and when the part searched held nothing, it says that — not «nothing found»", async ({ page }) => {
    mock.answerRpc("search_books", 200, NOTHING_IN_THE_PART_SEARCHED);
    await page.goto(`/search?q=${encodeURIComponent(PHRASE)}`);

    const notice = page.getByTestId("search-partial");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice).toContainText("ئۇ قىسىمدا بۇ ئىبارە تېپىلمىدى");
    await expect(page.getByTestId("search-empty")).toHaveCount(0);
    // The flags-only row is not a result.
    await expect(page.getByTestId("search-result")).toHaveCount(0);
    await expect(page.getByTestId("search-results")).toHaveCount(0);
    await expectNoFailure(page);

    await assertControlsReachable(page);
  });

  test("an answer from before 0029 — no `partial` column — reads as it always did", async ({ page }) => {
    const before = hits(5, { capped: false, partial: false }).map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== "partial")),
    );
    mock.answerRpc("search_books", 200, before);
    await page.goto(`/search?q=${encodeURIComponent(HARD)}`);

    await expect(page.getByTestId("search-result")).toHaveCount(5);
    await expect(page.getByTestId("search-partial")).toHaveCount(0);
    await expect(page.getByTestId("search-too-common")).toHaveCount(0);
    await expectNoFailure(page);
  });
});
