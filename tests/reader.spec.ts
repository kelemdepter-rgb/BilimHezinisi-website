import { test, expect, type Page } from "@playwright/test";
import {
  SEED_BOOK_TITLE,
  SEED_FRAGMENT_COUNT,
  SEED_FRAGMENT_DECOYS,
  SEED_FRAGMENT_PAGE,
  SEED_FRAGMENT_PHRASE,
  SEED_MD_NEEDLE_PAGE,
  SEED_NEEDLE,
  SEED_NEEDLE_PHRASE,
  SEED_NEEDLE_PAGE,
  hasStaffTestEnv,
  loadEnvLocal,
  readMarkdownSeed,
  readSeed,
} from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

function seededBookId(): number {
  const seed = readSeed();
  if (!seed) throw new Error("seed book missing — the setup project must run first");
  return seed.bookId;
}

function seededMarkdownBookId(): number {
  const seed = readMarkdownSeed();
  if (!seed) throw new Error("markdown seed book missing — the setup project must run first");
  return seed.bookId;
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

test.describe("library home", () => {
  test("toggles between grid and list and keeps the choice", async ({ page }) => {
    await page.goto("/");
    const list = page.getByTestId("book-list");
    await expect(list).toHaveAttribute("data-view", "grid");

    await page.getByTestId("view-list").click();
    await expect(list).toHaveAttribute("data-view", "list");

    // The cookie should survive a reload.
    await page.reload();
    await expect(page.getByTestId("book-list")).toHaveAttribute("data-view", "list");

    await page.getByTestId("view-grid").click();
    await expect(page.getByTestId("book-list")).toHaveAttribute("data-view", "grid");
    await assertNoHorizontalOverflow(page);
  });

  test("shows the seeded book and opens its detail page", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("book-card").filter({ hasText: SEED_BOOK_TITLE });
    await expect(card.first()).toBeVisible();
    await card.first().click();
    await expect(page.getByRole("heading", { name: SEED_BOOK_TITLE })).toBeVisible();
    await expect(page.getByTestId("start-reading").or(page.getByTestId("continue-reading"))).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("filters by category through the URL", async ({ page, isMobile }) => {
    await page.goto("/");
    // The sidebar renders twice — permanent on desktop, inside the drawer on
    // mobile — so scope to the one that is actually on screen.
    if (isMobile) await page.getByTestId("menu-button").click();
    const scope = isMobile ? page.getByTestId("drawer") : page.getByTestId("sidebar-desktop");

    const links = scope.getByTestId("category-link");
    if ((await links.count()) === 0) test.skip(true, "no categories seeded yet");

    const categoryId = await links.first().getAttribute("data-category-id");
    await links.first().click();
    await expect(page).toHaveURL(new RegExp(`cat=${categoryId}`));
    // Either results or the explicit empty state — never a broken page.
    await expect(page.getByTestId("book-list").or(page.getByTestId("library-empty"))).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("reader", () => {
  test("opens, loads more pages on scroll and keeps every control usable", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);

    await expect(page.getByTestId("reader-toolbar")).toBeVisible();
    const initialPages = await page.getByTestId("reader-page").count();
    expect(initialPages).toBeGreaterThan(0);

    // Fetch-ahead should append pages as the reader scrolls.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(async () => page.getByTestId("reader-page").count(), { timeout: 20_000 })
      .toBeGreaterThan(initialPages);

    await scrollDownAndBackUp(page);

    // Every toolbar control must still be visible AND the topmost hit target.
    for (const testId of ["reader-back", "font-decrease", "font-increase", "find-toggle", "panel-toggle"]) {
      await expect(page.getByTestId(testId), `${testId} must stay visible`).toBeVisible();
      expect(await topMostTestIdAt(page, testId), `${testId} must not be covered`).toBe(testId);
    }
    await assertNoHorizontalOverflow(page);
  });

  test("font size and theme controls take effect", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    const content = page.getByTestId("reader-content");

    const sizeOf = async () =>
      Number.parseFloat(
        await content.evaluate((node) => getComputedStyle(node as HTMLElement).fontSize),
      );

    const before = await sizeOf();
    await page.getByTestId("font-increase").click();
    await expect.poll(sizeOf).toBeGreaterThan(before);

    await page.getByTestId("font-decrease").click();
    await expect.poll(sizeOf).toBe(before);

    // Scoped: the site header carries its own toggle on non-reader pages.
    await page.getByTestId("reader-toolbar").getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /sepia|dark|light/);
  });

  test("page jump moves to the requested page", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await page.getByTestId("page-jump").fill("9");
    await page.getByTestId("page-jump-go").click();
    await expect(page.locator('[data-page-no="9"]')).toBeVisible({ timeout: 20_000 });
  });

  test("arriving from search, the arrows step through every occurrence", async ({ page }) => {
    // The gap this covers: the term was highlighted but nothing offered a way
    // to reach the next one, because the controls only existed inside the
    // collapsed find panel — and even there they skipped every occurrence
    // after the first on a page.
    await page.goto(
      `/books/${seededBookId()}/read?page=${SEED_NEEDLE_PAGE}&q=${encodeURIComponent(SEED_NEEDLE)}`,
    );

    const nav = page.getByTestId("match-nav");
    await expect(nav, "the arrows must be there without opening anything").toBeVisible({
      timeout: 20_000,
    });

    const counter = page.getByTestId("match-count");
    await expect(counter).toHaveText(/^1\/\d+$/);
    const total = Number((await counter.innerText()).split("/")[1]);
    test.skip(total < 2, "the seeded book holds only one occurrence");

    // Stepping forward moves the position and marks a different occurrence.
    await page.getByTestId("match-next").click();
    await expect(counter).toHaveText(`2/${total}`);
    const active = page.locator(".match-active");
    await expect(active).toHaveCount(1);
    await expect(active).toBeInViewport();

    // ...and back again, wrapping at the ends rather than dead-ending.
    await page.getByTestId("match-prev").click();
    await expect(counter).toHaveText(`1/${total}`);
    await page.getByTestId("match-prev").click();
    await expect(counter).toHaveText(`${total}/${total}`);
  });

  test("in-book search finds the seeded word", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await page.getByTestId("find-toggle").click();
    await page.getByTestId("find-input").fill(SEED_NEEDLE);
    await page.getByTestId("find-run").click();
    // The find box feeds the ONE navigator in the toolbar; it no longer keeps
    // a second counter of its own beside the input.
    await expect(page.getByTestId("match-count")).toHaveText(/^1\/\d+$/, { timeout: 20_000 });
    await expect(page.locator(`[data-page-no="${SEED_NEEDLE_PAGE}"] mark`).first()).toBeVisible();
  });
});

test.describe("reader panel", () => {
  test("opens and closes without trapping body scroll", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    const panel = page.getByTestId("reader-panel");
    await expect(panel).not.toBeVisible();

    await page.getByTestId("panel-toggle").click();
    await expect(panel).toBeVisible();
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");

    await page.getByTestId("panel-close").click();
    await expect(panel).not.toBeVisible();

    // Body scroll must be released again.
    const scrolled = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          window.scrollTo(0, 400);
          requestAnimationFrame(() => resolve(window.scrollY));
        }),
    );
    expect(scrolled, "page must scroll after the panel closes").toBeGreaterThan(0);
  });
});

test.describe("global search", () => {
  test("finds the seeded word and lands on the right page", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);

    const results = page.getByTestId("search-result");
    await expect(results.first()).toBeVisible({ timeout: 20_000 });
    // The snippet renders the RPC's highlight as real markup, not escaped text.
    await expect(results.first().locator("mark").first()).toBeVisible();

    await results.first().click();
    await expect(page).toHaveURL(new RegExp(`/books/\\d+/read\\?page=${SEED_NEEDLE_PAGE}`));
    await expect(page.locator(`[data-page-no="${SEED_NEEDLE_PAGE}"]`)).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);
  });

  test("shows an empty state for a word that is not there", async ({ page }) => {
    await page.goto("/search?q=قوندۇرۇلمىغانئالاھىدەسۆز");
    await expect(page.getByTestId("search-empty")).toBeVisible();
  });

  test("finds a word by its beginning, the way the desktop does", async ({ page }) => {
    // Uyghur glues suffixes onto stems, so a reader types the start of a word
    // far more often than its exact inflected form. Whole-lexeme matching used
    // to return nothing at all here.
    const prefix = SEED_NEEDLE.slice(0, 5);
    await page.goto(`/search?q=${encodeURIComponent(prefix)}`);
    await expect(page.getByTestId("search-result").first()).toBeVisible({ timeout: 20_000 });
  });

  test("several words mean a phrase — all of it highlighted, or no result", async ({ page }) => {
    // The bug this covers: «قىيامەت كۈنى پىلسىرات» reported a hit on a page that
    // held the three words scattered, highlighting only two of them. A partial
    // highlight presented as a match reads as "you mistyped".
    const words = SEED_NEEDLE_PHRASE.split(" ");

    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE_PHRASE)}`);
    const hit = page.getByTestId("search-result").first();
    await expect(hit).toBeVisible({ timeout: 20_000 });

    // Every word of the phrase is marked, not just the first.
    const marked = (await hit.locator("mark").allInnerTexts()).join(" ");
    for (const word of words) {
      expect(marked, `«${word}» must be highlighted too`).toContain(word);
    }

    // ...and a phrase that is NOT in the library says so instead of matching
    // on its words alone.
    const scattered = `${words[0]} قوندۇرۇلمىغانئالاھىدەسۆز`;
    await page.goto(`/search?q=${encodeURIComponent(scattered)}`);
    await expect(page.getByTestId("search-empty")).toBeVisible({ timeout: 20_000 });
  });

  test("clicking a result lands on the word, clear of the toolbar", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await page.getByTestId("search-result").first().click();

    const active = page.locator(".match-active");
    await expect(active).toHaveCount(1, { timeout: 20_000 });
    await expect(active).toBeInViewport();

    // Not hidden behind the sticky bar — the whole point of centring it.
    const word = await active.boundingBox();
    const bar = await page.getByTestId("reader-toolbar").boundingBox();
    expect(word!.y, "the match must sit below the toolbar").toBeGreaterThan(bar!.y + bar!.height);
  });

  test("«قايتىش» returns to the results, not the book page", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await expect(page.getByTestId("search-result").first()).toBeVisible({ timeout: 20_000 });

    // Scroll the results, so the restored position is observable.
    await page.evaluate(() => window.scrollTo(0, 200));
    await page.waitForTimeout(200);

    await page.getByTestId("search-result").first().click();
    await expect(page).toHaveURL(/\/books\/\d+\/read/);

    await page.getByTestId("reader-back").click();
    await expect(page, "back belongs to the search, not the book").toHaveURL(
      new RegExp(`/search\\?q=${encodeURIComponent(SEED_NEEDLE)}`),
    );
    await expect(page.getByTestId("search-result").first()).toBeVisible();
    // Restored from history rather than re-queried.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("groups a book's hits and expands to every place in it", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);

    const group = page.getByTestId("search-book-group").first();
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(group.getByTestId("search-book-title")).toBeVisible();

    // The desktop's "+" expander: every occurrence in this one book.
    await group.getByTestId("expand-book-matches").click();
    const matches = group.getByTestId("expanded-match");
    await expect(matches.first()).toBeVisible({ timeout: 20_000 });
    await expect(group.getByTestId("expanded-count")).toBeVisible();
    // Each entry shows the word it found, highlighted in its own context.
    await expect(matches.first().locator("mark").first()).toBeVisible();

    // ...and addresses one exact occurrence, not just its page.
    await expect(matches.first()).toHaveAttribute("href", /[?&]m=\d+/);
    await matches.first().click();
    await expect(page).toHaveURL(/\/books\/\d+\/read\?page=\d+.*m=\d+/);
    await expect(page.getByTestId("match-nav")).toBeVisible({ timeout: 20_000 });
  });
});

/**
 * The production bug: searching «نامازغا چا» lit up a standalone «چالايلى» and a
 * standalone «چاقىر» — words that merely began with the phrase's last fragment.
 * ts_headline marked lexemes; the reader marked the literal phrase; the two
 * disagreed on every screen. There is one matcher now, and these hold it to it.
 */
test.describe("one phrase, one algorithm", () => {
  const phraseParam = encodeURIComponent(SEED_FRAGMENT_PHRASE);

  test("the results list marks the whole phrase and never a bare fragment", async ({ page }) => {
    await page.goto(`/search?q=${phraseParam}`);
    const hit = page.getByTestId("search-result").first();
    await expect(hit).toBeVisible({ timeout: 20_000 });

    const marked = await hit.locator("mark").allInnerTexts();
    expect(marked.length).toBeGreaterThan(0);

    for (const text of marked) {
      // Every mark is the phrase itself — not one of its words, not a word that
      // merely starts the same way.
      expect(text, "a mark must be the whole phrase").toBe(SEED_FRAGMENT_PHRASE);
      for (const decoy of SEED_FRAGMENT_DECOYS) {
        expect(text, `«${decoy}» must never be marked on its own`).not.toBe(decoy);
      }
    }
  });

  test("the reader marks exactly the same thing the results list did", async ({ page }) => {
    await page.goto(
      `/books/${seededBookId()}/read?page=${SEED_FRAGMENT_PAGE}&q=${phraseParam}&m=0&from=search`,
    );

    const marks = page.locator(`[data-page-no="${SEED_FRAGMENT_PAGE}"] mark`);
    await expect(marks.first()).toBeVisible({ timeout: 20_000 });

    // The phrase occurs twice on that page: once reaching into «چاقىرىش» and
    // once into «چاقىر». The decoys standing alone are left untouched.
    await expect(marks).toHaveCount(SEED_FRAGMENT_COUNT);
    for (const text of await marks.allInnerTexts()) {
      expect(text).toBe(SEED_FRAGMENT_PHRASE);
    }

    // And the counter agrees with what is on screen.
    await expect(page.getByTestId("match-count")).toHaveText(
      new RegExp(`^1/${SEED_FRAGMENT_COUNT}$`),
    );
  });

  test("a phrase that is nowhere says «تېپىلمىدى» and marks nothing", async ({ page }) => {
    const absent = `${SEED_NEEDLE} قوندۇرۇلمىغانئالاھىدەسۆز`;
    await page.goto(
      `/books/${seededBookId()}/read?page=1&q=${encodeURIComponent(absent)}`,
    );
    await expect(page.getByTestId("match-none")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("match-none")).toHaveText("تېپىلمىدى");
    await expect(page.locator("[data-page-no] mark")).toHaveCount(0);
  });
});

/**
 * Markdown books had no highlighting at all — the reader rendered the page and
 * drew no marks, so arriving from a search result meant hunting for the phrase
 * by eye. Two thirds of the real library is stored this way.
 */
test.describe("a Markdown book highlights too", () => {
  test("clicking a result lands on the phrase, centred and flashed", async ({ page }) => {
    await page.goto(
      `/books/${seededMarkdownBookId()}/read?page=${SEED_MD_NEEDLE_PAGE}` +
        `&q=${encodeURIComponent(SEED_NEEDLE)}&m=0&from=search`,
    );

    // Rendered Markdown, and marks inside it.
    const body = page.locator(`[data-page-no="${SEED_MD_NEEDLE_PAGE}"] .md-body`);
    await expect(body).toBeVisible({ timeout: 20_000 });
    await expect(body.locator("h2")).toBeVisible();

    const active = page.locator(".match-active");
    await expect(active).toHaveCount(1, { timeout: 20_000 });
    await expect(active).toHaveText(SEED_NEEDLE);
    await expect(active).toBeInViewport();

    // Centred, so the sticky toolbar cannot be sitting on top of it — the rule
    // that matters most at 375px.
    const word = await active.boundingBox();
    const bar = await page.getByTestId("reader-toolbar").boundingBox();
    expect(word!.y, "the match must sit below the toolbar").toBeGreaterThan(bar!.y + bar!.height);

    // And it flashed, the way the desktop's flashMatch does.
    await expect(active).toHaveClass(/match-flash/);

    await assertNoHorizontalOverflow(page);
  });

  test("the arrows step through a Markdown book's occurrences", async ({ page }) => {
    await page.goto(
      `/books/${seededMarkdownBookId()}/read?page=${SEED_MD_NEEDLE_PAGE}&q=${encodeURIComponent(SEED_NEEDLE)}`,
    );

    const counter = page.getByTestId("match-count");
    await expect(counter).toHaveText(/^1\/\d+$/, { timeout: 20_000 });
    const total = Number((await counter.innerText()).split("/")[1]);
    // Bold prose plus a list entry: the seed puts the needle on the page twice.
    expect(total).toBeGreaterThanOrEqual(2);

    await page.getByTestId("match-next").click();
    await expect(counter).toHaveText(`2/${total}`);
    const active = page.locator(".match-active");
    await expect(active).toHaveCount(1);
    await expect(active).toBeInViewport();

    // The mark inside <strong> is still one mark, addressed by its own number.
    await expect(active).toHaveAttribute("data-match", /^\d+$/);
  });
});

test.describe("anonymous visitors", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("can browse, read and search without an account", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("book-list")).toBeVisible();
    // Recent reads are personal and must not render for anonymous visitors.
    await expect(page.getByTestId("recent-strip")).toHaveCount(0);

    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    // Bookmarking is a signed-in feature.
    await expect(page.getByTestId("add-bookmark")).toHaveCount(0);

    await page.goto(`/search?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await expect(page.getByTestId("search-result").first()).toBeVisible({ timeout: 20_000 });
  });

  test("is redirected from the personal pages", async ({ page }) => {
    for (const path of ["/my/bookmarks", "/my/notes"]) {
      await page.goto(path);
      await expect(page, `${path} must require a session`).toHaveURL(/\/login/);
    }
  });
});
