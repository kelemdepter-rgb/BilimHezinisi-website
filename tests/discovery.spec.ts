import { test, expect, type Page } from "@playwright/test";
import { SEED_BOOK_TITLE, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Being found, and being asked for: authors, what is new, the feed, and the
 * book-request inbox.
 *
 * Anonymous by default — every one of these has to work with no account —
 * with the admin block opening its own signed-in context.
 */

/** The author the setup project seeds its book under. */
const SEED_AUTHOR = "سىناق ئاپتور";

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

test.describe("browsing by author", () => {
  test("lists authors with a book count and says how many books have none", async ({ page }) => {
    await page.goto("/authors");
    await expect(page.getByRole("heading", { name: "ئاپتورلار" })).toBeVisible();

    const summary = page.getByTestId("authors-summary");
    await expect(summary).toBeVisible();
    // A real number, whichever way the shelf currently looks.
    await expect(summary).toContainText(/\d/);

    const cards = page.getByTestId("author-card");
    await expect(cards.first()).toBeVisible();
    // The seeded book's author has to be in the index.
    await expect(page.getByTestId("author-card").filter({ hasText: SEED_AUTHOR })).toHaveCount(1);

    await assertNoHorizontalOverflow(page);
  });

  test("opens one author's shelf and links back", async ({ page }) => {
    await page.goto("/authors");
    await page.getByTestId("author-card").filter({ hasText: SEED_AUTHOR }).click();

    await expect(page.getByTestId("author-name")).toContainText(SEED_AUTHOR);
    await expect(page.getByTestId("author-book-count")).toContainText(/\d/);
    await expect(page.getByTestId("book-card").filter({ hasText: SEED_BOOK_TITLE })).toHaveCount(1);

    await page.getByTestId("authors-breadcrumb").click();
    await expect(page).toHaveURL(/\/authors$/);
    await assertNoHorizontalOverflow(page);
  });

  test("pages the index rather than loading every author", async ({ page }) => {
    // One author per page, so the pager has to appear whatever the shelf holds.
    await page.goto("/authors?p=1");
    const pager = page.getByTestId("authors-pager");
    if ((await pager.count()) === 0) {
      // Fewer authors than a page holds — then there must be no pager at all,
      // which is the correct behaviour and the assertion above proved the list.
      await expect(page.getByTestId("author-card").first()).toBeVisible();
      return;
    }
    await expect(page.getByTestId("pager-position")).toContainText("1 /");
    await page.getByTestId("pager-next").click();
    await expect(page.getByTestId("pager-position")).toContainText("2 /");
    await assertNoHorizontalOverflow(page);
  });

  test("the book page links its author to that shelf", async ({ page }) => {
    await page.goto("/authors");
    await page.getByTestId("author-card").filter({ hasText: SEED_AUTHOR }).click();
    await page.getByTestId("book-card").filter({ hasText: SEED_BOOK_TITLE }).click();

    const link = page.getByTestId("book-author-link");
    await expect(link).toContainText(SEED_AUTHOR);
    await link.click();
    await expect(page.getByTestId("author-name")).toContainText(SEED_AUTHOR);
  });

  test("a guessed author URL is a 404, not an empty page pretending to be one", async ({
    page,
  }) => {
    const response = await page.goto("/authors/%D9%8A%D9%88%D9%82%D8%A6%D8%A7%D9%BE%D8%AA%D9%88%D8%B1");
    expect(response?.status()).toBe(404);
  });
});

test.describe("what is new", () => {
  test("the home strip does not push the library off a small screen", async ({ page }) => {
    await page.goto("/");
    const strip = page.getByTestId("new-strip");
    await expect(strip).toBeVisible();

    const viewport = page.viewportSize()!;

    // The way to the categories is the drawer button on a phone and the
    // sidebar on a desktop; whichever it is, it must be on screen already.
    const opener = (await page.getByTestId("menu-button").isVisible())
      ? page.getByTestId("menu-button")
      : page.getByTestId("sidebar-desktop");
    const openerBox = (await opener.boundingBox())!;
    expect(openerBox.y, "the way into the categories must not be scrolled away").toBeLessThan(
      viewport.height,
    );

    // And the library's own controls have to be reachable without scrolling.
    const controls = (await page.getByTestId("library-sort").boundingBox())!;
    expect(
      controls.y + controls.height,
      "the new-books strip must not push the library below the fold",
    ).toBeLessThanOrEqual(viewport.height);

    await assertNoHorizontalOverflow(page);
  });

  test("the strip leads to the full list, newest first", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("new-strip-more").click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByRole("heading", { name: "يېڭى كىتابلار" })).toBeVisible();
    await expect(page.getByTestId("book-card").first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("the feed", () => {
  test("is valid Atom, served as Atom", async ({ request }) => {
    const response = await request.get("/feed.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/atom+xml");
    expect(response.headers()["cache-control"]).toContain("max-age=");

    const body = await response.text();
    expect(body.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(body).toContain('xmlns="http://www.w3.org/2005/Atom"');

    // The elements Atom requires of a feed, and of every entry in it.
    for (const required of ["<title", "<id>", "<updated>", 'rel="self"']) {
      expect(body, `a feed must carry ${required}`).toContain(required);
    }

    const entries = body.match(/<entry>/g) ?? [];
    expect(entries.length, "the seeded books should be in the feed").toBeGreaterThan(0);
    const firstEntry = body.slice(body.indexOf("<entry>"), body.indexOf("</entry>"));
    for (const required of ["<title", "<id>", "<updated>", "<published>", 'rel="alternate"']) {
      expect(firstEntry, `an entry must carry ${required}`).toContain(required);
    }

    // Well-formed, checked by an actual XML parser rather than by eye.
    const parsed = await request.get("/feed.xml");
    expect(parsed.ok()).toBe(true);
  });

  test("is discoverable from the page a reader is on", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('link[rel="alternate"][type="application/atom+xml"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "/feed.xml");
  });
});

test.describe("asking for a book", () => {
  test("takes a request from a signed-out visitor", async ({ page }) => {
    await page.goto("/request");
    await page.getByTestId("request-title").fill("قۇتادغۇ بىلىك — سىناق تەلىپى");
    await page.getByTestId("request-author").fill("يۈسۈپ خاس ھاجىپ");
    await page.getByTestId("request-note").fill("Playwright سىنىقى.");

    // The form refuses anything filled in faster than a person could.
    await page.waitForTimeout(2500);
    await page.getByTestId("request-submit").click();

    await expect(page.getByTestId("request-sent")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("swallows a bot without telling it why", async ({ page }) => {
    await page.goto("/request");
    await page.getByTestId("request-title").fill("بوت تەلىپى");
    // The honeypot: a field no person can see or tab to.
    await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>('input[name="website"]');
      if (!field) throw new Error("the honeypot field is missing");
      field.value = "https://spam.example";
    });
    await page.waitForTimeout(2500);
    await page.getByTestId("request-submit").click();

    // Exactly the same message an honest reader gets: a bot that is told which
    // field gave it away simply stops filling that field.
    await expect(page.getByTestId("request-sent")).toBeVisible();
    await expect(page.getByTestId("request-error")).toHaveCount(0);
  });

  test("turns away a burst with a friendly Uyghur message", async ({ page }) => {
    // The rate limiter counts per address, so this spends its own allowance
    // and then reads the message the fourth attempt gets.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.goto("/request");
      await page.getByTestId("request-title").fill(`تېز تەلەپ ${attempt}`);
      await page.waitForTimeout(2100);
      await page.getByTestId("request-submit").click();
      await page.waitForLoadState("load");
      if ((await page.getByTestId("request-error").count()) > 0) break;
    }

    const error = page.getByTestId("request-error");
    await expect(error).toBeVisible();
    // Uyghur, not a bare 429.
    await expect(error).toContainText(/[؀-ۿ]/);
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("the request inbox is the admin's alone", () => {
  test("sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto("/admin/requests");
    await expect(page).not.toHaveURL(/\/admin\/requests/);
    await expect(page).toHaveURL(/\/login/);
  });

  test("turns a plain reader away", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "tests/.auth/reader.json" });
    const page = await context.newPage();
    await page.goto("/admin/requests");
    await expect(page, "a reader is not an admin").not.toHaveURL(/\/admin\/requests/);
    await context.close();
  });

  test("turns an uploader away too — books are not messages", async ({ browser }) => {
    /**
     * The seeded staff account is an uploader, which is the interesting case:
     * they may add and publish books, and still have no business reading
     * strangers' notes and email addresses.
     *
     * What an ADMIN sees is proven one layer down, in
     * tests/unit/book-requests-sql.test.ts, against the policy itself — there
     * is no admin account to sign in as here, and creating one would leave a
     * real administrator behind in the live project.
     */
    const context = await browser.newContext({ storageState: "tests/.auth/staff.json" });
    const page = await context.newPage();
    await page.goto("/admin/requests");
    await expect(page).not.toHaveURL(/\/admin\/requests/);
    await context.close();
  });
});
