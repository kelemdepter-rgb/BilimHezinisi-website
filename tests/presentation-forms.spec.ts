import { test, expect, request, type Page } from "@playwright/test";
import { loadEnvLocal } from "./env";

loadEnvLocal();

/**
 * The book that was invisible.
 *
 * Book 989 was stored as Arabic PRESENTATION FORMS — one codepoint per drawn
 * shape of a letter — so it looked right on the shelf and matched nothing:
 * «قاراخانىيلار» found three books and not this one, its author's name found
 * nothing at all, and /authors carried him as his own broken entry. Repaired by
 * scripts/normalize-presentation-forms.mjs; this is what stops it coming back.
 *
 * Anonymous throughout. Reading and searching need no account, and the reader
 * who could not find this book had none.
 */
const BOOK_ID = 989;
const TITLE = "قاراخانىيلار خانلىقى ۋە قارلۇقلار";
const AUTHOR = "غەيرەتجان ئوسمان";
/** A word from the title, a word from the body, and the author's name. */
const QUERIES = ["قاراخانىيلار", "قارلۇقلار", AUTHOR];

/** Anything left in these ranges is a glyph codepoint that escaped the repair. */
const PRESENTATION_FORMS = new RegExp("[\\uFE70-\\uFEFF\\uFB50-\\uFBFF]");

/**
 * The library is the owner's, not a fixture. If he ever takes this book back to
 * draft that is his call and not a failing test, so the suite asks once.
 */
let published: Promise<boolean> | null = null;
function bookIsPublished(baseURL: string): Promise<boolean> {
  published ??= (async () => {
    const context = await request.newContext({ baseURL });
    try {
      return (await context.get(`/books/${BOOK_ID}`)).ok();
    } finally {
      await context.dispose();
    }
  })();
  return published;
}

test.beforeEach(async ({ baseURL }) => {
  test.skip(!(await bookIsPublished(baseURL ?? "")), `book ${BOOK_ID} is not published`);
});

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

test.describe("the repaired book", () => {
  for (const query of QUERIES) {
    test(`is found by searching «${query}»`, async ({ page }) => {
      await page.goto(`/search?q=${encodeURIComponent(query)}`);
      const titles = page.getByTestId("search-book-title");
      await expect(titles.first()).toBeVisible();
      await expect(titles.filter({ hasText: TITLE })).toHaveCount(1);
    });
  }

  test("is listed under its author, spelled in ordinary Uyghur letters", async ({ page }) => {
    await page.goto("/authors");
    // One entry — not the separate one the glyph spelling used to make.
    const card = page.getByTestId("author-card").filter({ hasText: AUTHOR });
    await expect(card).toHaveCount(1);
    await expect(page.getByTestId("author-list")).not.toHaveText(PRESENTATION_FORMS);
    await card.click();
    await expect(page.getByText(TITLE).first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("opens and reads as letters, not as glyph codepoints", async ({ page }) => {
    await page.goto(`/books/${BOOK_ID}/read`);
    const first = page.getByTestId("reader-page").first();
    await expect(first).toBeVisible();

    const text = (await first.innerText()).trim();
    expect(text.length).toBeGreaterThan(100);
    // None of the shapes the letters are drawn as…
    expect(text).not.toMatch(PRESENTATION_FORMS);
    // …and the first words of the book, spelled the way a reader would type
    // them. «دۆلەت» carries the ە that plain NFKC would have turned into an
    // Arabic ه, so this is the whole repair in one word.
    expect(text).toContain("دۆلەت");
    expect(text).toContain("قارلۇقلار");
    await assertNoHorizontalOverflow(page);
  });

  test("has no horizontal overflow on the narrowest phone", async ({ page }) => {
    // 360 px is the floor CLAUDE.md sets, narrower than any project viewport.
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of [
      `/books/${BOOK_ID}`,
      `/books/${BOOK_ID}/read`,
      `/search?q=${encodeURIComponent(TITLE)}`,
    ]) {
      await page.goto(path);
      await assertNoHorizontalOverflow(page);
    }
  });
});
