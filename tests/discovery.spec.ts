import { test, expect, type Page } from "@playwright/test";
import { SEED_BOOK_TITLE, SEED_REQUEST_PREFIX, hasStaffTestEnv, loadEnvLocal } from "./env";

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

/**
 * The centred line in the new-books heading row saying the shelf is growing.
 *
 * It is aimed at a visitor arriving for the first time, so every check runs
 * signed out. It shares its row with the heading and «ھەممىسى», and on a phone
 * that row has no space to spare — which is what most of this block is about.
 */
test.describe("the invitation above the shelf", () => {
  /** Tailwind's `sm` breakpoint, where the line moves into the row. */
  const SM = 640;

  test("says the library is growing, in the site's own type, and leads to /new", async ({
    page,
  }) => {
    await page.goto("/");
    const hint = page.getByTestId("new-strip-hint");

    await expect(hint).toHaveText("يېڭى كىتابلار قوشۇلۇۋاتىدۇ، زىيارەت قىلىپ تۇرۇڭ…");
    await expect(hint).toHaveAttribute("href", "/new");

    const style = await hint.evaluate((node) => {
      const own = getComputedStyle(node);
      // A probe painted with the token proves the link's colour IS the token,
      // whichever theme is on — comparing to a hex would only pin today's one.
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--am");
      document.body.append(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      return {
        size: parseFloat(own.fontSize),
        family: own.fontFamily,
        color: own.color,
        align: own.textAlign,
        token,
      };
    });
    const moreSize = await page
      .getByTestId("new-strip-more")
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    const bodyFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);

    // Bigger than the «ھەممىسى» link it shares the row with, but no heading.
    expect(style.size, "the invitation must outsize the row's other link").toBeGreaterThan(
      moreSize,
    );
    expect(style.size, "…without competing with a heading").toBeLessThanOrEqual(16);
    expect(style.align, "the line is centred").toBe("center");
    // Inherited, not declared: no @font-face and no font-family of its own.
    expect(style.family, "the line must inherit the site font").toBe(bodyFamily);
    expect(style.color, "the line must use the --am token, not a new colour").toBe(style.token);

    await hint.click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByRole("heading", { name: "يېڭى كىتابلار" })).toBeVisible();
  });

  test("sits centred in the row, and drops to its own line on a phone", async ({ page }) => {
    await page.goto("/");
    const width = page.viewportSize()!.width;

    // The strip arrives behind Suspense, so under load `boundingBox()` can be
    // read before the row exists and hands back null. Wait for all three, and
    // re-read them together — a box measured across a re-render is worse than
    // no box at all.
    const parts = {
      heading: page.locator("#new-strip-heading"),
      hint: page.getByTestId("new-strip-hint"),
      more: page.getByTestId("new-strip-more"),
    };
    for (const [name, locator] of Object.entries(parts)) {
      await expect(locator, `${name} must render`).toBeVisible();
    }
    let heading!: NonNullable<Awaited<ReturnType<typeof parts.heading.boundingBox>>>;
    let hint!: typeof heading;
    let more!: typeof heading;
    await expect(async () => {
      const boxes = await Promise.all([
        parts.heading.boundingBox(),
        parts.hint.boundingBox(),
        parts.more.boundingBox(),
      ]);
      expect(boxes.every(Boolean), "every part of the row must have a box").toBe(true);
      [heading, hint, more] = boxes as [typeof heading, typeof heading, typeof heading];
    }).toPass({ timeout: 5000 });

    if (width >= SM) {
      // RTL: the heading is furthest right, then the line, then «ھەممىسى».
      expect(hint.x + hint.width, "the line must sit start-ward of the heading").toBeLessThanOrEqual(
        heading.x + 1,
      );
      expect(more.x + more.width, "«ھەممىسى» must stay at the far end").toBeLessThanOrEqual(
        hint.x + 1,
      );
      // Centred in the gap the two of them leave, give or take a pixel.
      const gapMiddle = (more.x + more.width + heading.x) / 2;
      expect(
        Math.abs(hint.x + hint.width / 2 - gapMiddle),
        "the line must be centred between them",
      ).toBeLessThanOrEqual(2);
    } else {
      // No room beside them: its own line, under both, centred on the row.
      expect(hint.y, "the line must drop below the heading").toBeGreaterThanOrEqual(
        heading.y + heading.height - 1,
      );
      expect(hint.y, "…and below «ھەممىسى» too").toBeGreaterThanOrEqual(
        more.y + more.height - 1,
      );
      expect(
        Math.abs(hint.x + hint.width / 2 - width / 2),
        "the line must be centred on the row",
      ).toBeLessThanOrEqual(2);
      expect(hint.height, "a line you can tap needs 44 px").toBeGreaterThanOrEqual(44);
    }

    await assertNoHorizontalOverflow(page);
  });

  test("never costs the page a control, before or after a scroll", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("new-strip-hint")).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));

    // The row's own link, and the library's controls under it.
    for (const testId of ["new-strip-more", "library-sort", "view-grid", "view-list"]) {
      const control = page.getByTestId(testId);
      await expect(control, `${testId} must still be on screen`).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x, `${testId} must not hang off the start edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${testId} must not hang off the end edge`).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
    }

    // Visible is not enough — something could be sitting on top of them.
    await page.getByTestId("view-list").click();
    await expect(page.getByTestId("book-list")).toHaveAttribute("data-view", "list");
    await page.getByTestId("view-grid").click();
    await expect(page.getByTestId("book-list")).toHaveAttribute("data-view", "grid");
    await page.getByTestId("library-sort").selectOption("title");
    await expect(page).toHaveURL(/sort=title/);

    await assertNoHorizontalOverflow(page);
  });

  /**
   * 360 px is the floor CLAUDE.md names and the suite's own projects start at
   * 375, so — like domain.spec.ts — this sets its own viewport and runs once
   * rather than adding a fourth project.
   *
   * The filtered view is checked too, but for overflow only: the home page
   * asks for the new books with no category, so a filtered view has no strip
   * (app/(library)/page.tsx skips listNewBooks when `cat` is set) and
   * therefore no line either.
   */
  test("holds at 360 px, and a filtered view stays whole without it", async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, "sets its own viewport; runs once, from the desktop project");
    await page.setViewportSize({ width: 360, height: 640 });

    await page.goto("/");
    await expect(page.getByTestId("new-strip-hint")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    for (const testId of ["new-strip-more", "library-sort", "view-grid", "view-list"]) {
      const box = (await page.getByTestId(testId).boundingBox())!;
      expect(box.x, `${testId} must not hang off the start edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${testId} must fit the screen`).toBeLessThanOrEqual(360);
    }

    const category = page.locator('a[href*="cat="]').first();
    if (await category.count()) {
      await page.goto((await category.getAttribute("href"))!);
      await expect(page.getByTestId("new-strip-hint")).toHaveCount(0);
      await expect(page.getByTestId("library-sort")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
  });
});

test.describe("the feed", () => {
  test("is valid Atom, served as Atom", async ({ request, page }) => {
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

    /**
     * Well formed, checked by a real XML parser rather than by eye. One
     * unescaped ampersand in a book's title makes the whole feed unreadable,
     * and string assertions would never notice.
     */
    const parseError = await page.evaluate((xml) => {
      const document_ = new DOMParser().parseFromString(xml, "application/xml");
      return document_.querySelector("parsererror")?.textContent ?? null;
    }, body);
    expect(parseError, "the feed must parse as XML").toBeNull();
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
    await page.getByTestId("request-title").fill(`${SEED_REQUEST_PREFIX} قۇتادغۇ بىلىك`);
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
    await page.getByTestId("request-title").fill(`${SEED_REQUEST_PREFIX} بوت تەلىپى`);
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
      await page.getByTestId("request-title").fill(`${SEED_REQUEST_PREFIX} تېز تەلەپ ${attempt}`);
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
