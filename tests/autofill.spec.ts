import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { STAFF_STATE_PATH, hasStaffTestEnv, loadEnvLocal, readSeed } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * The site must not invite a browser to fill private data into it.
 *
 * On 2026-09-02 the owner tapped the header search box on his own Android
 * phone and Chrome's keyboard bar offered him a key, a card and a location
 * pin; the card chip listed his real bank cards. Nothing was taken and the
 * page cannot take it — that row is browser chrome — but the search form is a
 * GET, so a mis-tap would have put a card number into `?q=` and from there
 * into the address bar, the history, the Referer header, the access log and
 * the reader's own stored search history.
 *
 * NOTE ON SCOPE. Playwright's desktop Chromium does not render that keyboard
 * bar at all, so nothing here can prove the icons are gone. What it proves is
 * that the markup measured clean on the owner's phone is the markup that
 * ships — and that the sign-in forms, where autofill is wanted, still have it.
 */

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

/** Bring the header's search input into view, whatever the width. */
async function headerSearch(page: Page): Promise<Locator> {
  if (narrow(page)) {
    const opener = page.getByRole("button", { name: "ئىزدەش رامكىسىنى ئېچىش" });
    if ((await opener.getAttribute("aria-expanded")) !== "true") await opener.click();
    const input = page.getByTestId("header-search-mobile");
    await expect(input).toBeVisible();
    return input;
  }
  const input = page.getByTestId("header-search");
  await expect(input).toBeVisible();
  return input;
}

/** Every autocomplete token rendered on the current page. */
async function tokensOnPage(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[autocomplete]")].map(
      (element) => element.getAttribute("autocomplete") ?? "",
    ),
  );
}

const FORBIDDEN = /^(cc-|street-address$|address-(line|level)\d$|postal-code$|country(-name)?$|tel($|-)|impp$)/;

test.describe("every search box refuses autofill", () => {
  test("the header box, its form, and the input inside it", async ({ page }) => {
    await page.goto("/");
    const input = await headerSearch(page);
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input).toHaveAttribute("autocorrect", "off");
    await expect(input).toHaveAttribute("enterkeyhint", "search");
    await expect(input).toHaveAttribute("data-lpignore", "true");
    // The form is marked as well — that pairing is what measured clean.
    const form = input.locator("xpath=ancestor::form[1]");
    await expect(form).toHaveAttribute("autocomplete", "off");
    await expect(form).toHaveAttribute("action", "/search");
  });

  test("the results page's box", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByTestId("search-input");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input.locator("xpath=ancestor::form[1]")).toHaveAttribute("autocomplete", "off");
  });

  test("the Qur'an's box", async ({ page }) => {
    await page.goto("/quran");
    const input = page.getByTestId("quran-search-input");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input.locator("xpath=ancestor::form[1]")).toHaveAttribute("autocomplete", "off");
  });
});

test.describe("no page asks for money, an address or a telephone", () => {
  test("not on the pages a reader with no account sees", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const paths = ["/", "/search?q=%D9%86%D8%A7%D9%85%D8%A7%D8%B2", "/quran", "/privacy"];
    const seed = readSeed();
    if (seed) paths.push(`/books/${seed.bookId}`);

    for (const path of paths) {
      await page.goto(path);
      const offenders = (await tokensOnPage(page)).filter((token) => FORBIDDEN.test(token));
      expect(offenders, `${path} must not ask a browser for private data`).toEqual([]);
    }
    await context.close();
  });

  test("not in the notebook either", async ({ page }) => {
    await page.goto("/notes");
    const offenders = (await tokensOnPage(page)).filter((token) => FORBIDDEN.test(token));
    expect(offenders).toEqual([]);
  });
});

test.describe("autofill still works where a password manager should help", () => {
  /**
   * Deliberately the mirror image of everything above. Someone tightening the
   * screws further could strip these too, and a reader who cannot autofill a
   * password chooses a weaker one — a real loss, not a cosmetic one.
   */
  test("the sign-in form still asks for an email and the current password", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.locator('input[name="email"]')).toHaveAttribute("autocomplete", "email");
    await expect(page.locator('input[name="password"]')).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await context.close();
  });

  test("the sign-up form still asks for a new password", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/register");
    await expect(page.locator('input[name="password"]')).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await expect(page.locator('input[name="email"]')).toHaveAttribute("autocomplete", "email");
    await context.close();
  });

  test("the book-request form still offers to fill in an email", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/request");
    await expect(page.getByTestId("request-contact")).toHaveAttribute("autocomplete", "email");
    // …and the title beside it does not, because it is not the reader's.
    await expect(page.getByTestId("request-title")).toHaveAttribute("autocomplete", "off");
    await context.close();
  });
});

/**
 * The switch belongs to a reader with NO account — /my/account is behind a
 * sign-in and most of this audience has never had one — so every block here
 * runs in its own anonymous context.
 */
test.describe("the reader can stop the search list being kept", () => {
  const HISTORY_KEY = "bh-search-history";
  const OFF_KEY = "bh-search-history-off";

  async function anonymousSearchPage(browser: Browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/search");
    await page.evaluate(
      (keys: string[]) => {
        for (const key of keys) window.localStorage.removeItem(key);
      },
      [HISTORY_KEY, OFF_KEY],
    );
    return { context, page };
  }

  async function seed(page: Page, queries: string[]) {
    await page.evaluate(
      ({ key, list }: { key: string; list: string[] }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify(list.map((query, index) => ({ query, at: Date.now() - index * 1000 }))),
        );
      },
      { key: HISTORY_KEY, list: queries },
    );
    await page.reload();
  }

  /**
   * The dropdown opens on FOCUS, and a focus event only fires when focus
   * actually moves — so the box is blurred first, and the whole thing is
   * re-armed until it takes: a click landing before React has hydrated
   * reaches no handler at all (the same trap as keyboard.spec.ts:151).
   */
  async function openDropdown(page: Page) {
    const input = page.getByTestId("search-input");
    await expect(async () => {
      await input.fill("");
      await input.blur();
      await input.click();
      await expect(page.getByTestId("search-history")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  }

  test("the switch is in the dropdown, and is big enough to tap", async ({ browser }) => {
    const { context, page } = await anonymousSearchPage(browser);
    await seed(page, ["بىرىنچى", "ئىككىنچى"]);
    await openDropdown(page);

    const row = page.getByTestId("search-history-off-row");
    await expect(row).toBeVisible();
    await expect(row).toContainText("ئىزدەش تارىخىنى ساقلىماسلىق");
    const box = (await row.boundingBox())!;
    expect(box.height, "touch target must be at least 44 px").toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("search-history-off")).not.toBeChecked();
    await context.close();
  });

  test("turning it off erases the list and stops offering one", async ({ browser }) => {
    const { context, page } = await anonymousSearchPage(browser);
    await seed(page, ["بىرىنچى", "ئىككىنچى"]);
    await openDropdown(page);
    await expect(page.getByTestId("search-history-item")).toHaveCount(2);

    await page.getByTestId("search-history-off").check();

    // Erased there and then — not an empty list left behind.
    await expect(page.getByTestId("search-history-item")).toHaveCount(0);
    expect(await page.evaluate((key: string) => window.localStorage.getItem(key), HISTORY_KEY)).toBeNull();

    // And nothing new is recorded.
    await page.getByTestId("search-input").fill("ساقلانمايدۇ");
    await page.getByTestId("search-submit").click();
    await page.waitForURL(/\/search\?/);
    expect(await page.evaluate((key: string) => window.localStorage.getItem(key), HISTORY_KEY)).toBeNull();

    // The dropdown offers no past searches, but the switch itself is still
    // reachable — otherwise a reader with no account could never undo this.
    await openDropdown(page);
    await expect(page.getByTestId("search-history-item")).toHaveCount(0);
    await expect(page.getByTestId("search-history-off")).toBeChecked();
    await context.close();
  });

  test("turning it back on starts recording again", async ({ browser }) => {
    const { context, page } = await anonymousSearchPage(browser);
    await page.evaluate((key: string) => window.localStorage.setItem(key, "1"), OFF_KEY);
    await page.reload();

    await openDropdown(page);
    await page.getByTestId("search-history-off").uncheck();
    expect(await page.evaluate((key: string) => window.localStorage.getItem(key), OFF_KEY)).toBeNull();

    await page.getByTestId("search-input").fill("ساقلىنىدۇ");
    await page.getByTestId("search-submit").click();
    await page.waitForURL(/\/search\?/);
    const stored = await page.evaluate((key: string) => window.localStorage.getItem(key), HISTORY_KEY);
    expect(stored).toContain("ساقلىنىدۇ");
    await context.close();
  });

  test("the dropdown scrolls inside itself and never locks the page", async ({ browser }) => {
    const { context, page } = await anonymousSearchPage(browser);
    // Eight entries is the stored maximum, and more than the panel is tall.
    await seed(page, ["بىر", "ئىككى", "ئۈچ", "تۆت", "بەش", "ئالتە", "يەتتە", "سەككىز"]);
    await openDropdown(page);

    const panel = page.getByTestId("search-history");
    const shape = await panel.evaluate((element: Element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      overscroll: getComputedStyle(element).overscrollBehaviorY,
    }));
    expect(shape.overflowY).toBe("auto");
    expect(shape.overscroll).toBe("contain");
    expect(shape.scrollHeight).toBeGreaterThan(shape.clientHeight);

    // The switch stays on screen: it is sticky, so eight entries cannot push
    // it out of reach.
    await expect(page.getByTestId("search-history-off-row")).toBeInViewport();

    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    // The page moves again — or has nothing to move, on a short results page
    // at a phone's height. Either way it is not locked.
    const moved = await page.evaluate(() => {
      const before = window.scrollY;
      window.scrollTo(0, 400);
      const after = window.scrollY;
      window.scrollTo(0, before);
      return after !== before || document.documentElement.scrollHeight <= window.innerHeight;
    });
    expect(moved, "the page must still scroll behind the dropdown").toBe(true);
    await context.close();
  });
});

test.describe("at 360 px, with the dropdown open", () => {
  test("nothing overflows on the home page or the results page", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 720 } });
    const page = await context.newPage();

    await page.goto("/search");
    await page.evaluate(() => {
      window.localStorage.removeItem("bh-search-history-off");
      window.localStorage.setItem(
        "bh-search-history",
        JSON.stringify(
          ["بىر", "ئىككى", "ئۈچ", "تۆت"].map((query, index) => ({
            query,
            at: Date.now() - index * 1000,
          })),
        ),
      );
    });

    await page.reload();
    const pageInput = page.getByTestId("search-input");
    await expect(async () => {
      await pageInput.fill("");
      await pageInput.blur();
      await pageInput.click();
      await expect(page.getByTestId("search-history")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);

    await page.goto("/");
    await expect(async () => {
      const headerInput = await headerSearch(page);
      await headerInput.blur();
      await headerInput.click();
      await expect(page.getByTestId("search-history")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);
    await context.close();
  });
});

test.describe("with JavaScript switched off", () => {
  /**
   * Fixed at a desktop width on purpose, and the same at every project.
   *
   * Below `md` the header's box is `hidden md:flex` and the only way to it is
   * the magnifier button, which is a React control — so on a phone with no
   * script there is no search box in the header to submit. That is how the
   * site has always been and is not what this change is about; the header
   * form at a desktop width is the plain GET that has to keep working.
   */
  test("the header's box still submits, and the server still returns results", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    await page.goto("/");
    // Server-rendered and marked, before any script has run.
    const form = page.locator('form[action="/search"]').first();
    await expect(form).toHaveAttribute("autocomplete", "off");
    const input = form.locator('input[name="q"]');
    await expect(input).toHaveAttribute("autocomplete", "off");

    // A single text field in a form: Enter submits it natively.
    await input.fill("ناماز");
    await input.press("Enter");
    await page.waitForURL(/\/search\?q=/);
    // Nothing extra rode along: the scope control writes its field only once
    // React is running, so with no script the search covers everything.
    expect(new URL(page.url()).searchParams.has("cat")).toBe(false);

    /**
     * The results are IN the document. Not `toBeVisible`: /search has a
     * loading.tsx, so Next streams it, and the inline script that moves the
     * streamed chunk into place is exactly what a browser with no script does
     * not run — the results arrive inside a hidden element. That is a
     * pre-existing property of every route here with a loading boundary, not
     * something the autofill work changed, and the server answered in full.
     */
    const html = await page.content();
    expect(html).toMatch(/data-testid="search-(meta|empty)"/);
    await context.close();
  });
});

/** Kept out of the anonymous blocks above: this one needs the account page. */
test.describe("the account page's copy of the switch", () => {
  test.use({ storageState: STAFF_STATE_PATH });

  test("agrees with the search box, over the same key", async ({ page }) => {
    await page.goto("/my/account");
    await page.evaluate(() => window.localStorage.removeItem("bh-search-history-off"));
    await page.reload();

    const box = page.getByTestId("search-history-off");
    await expect(box).not.toBeChecked();
    await box.check();
    expect(
      await page.evaluate(() => window.localStorage.getItem("bh-search-history-off")),
    ).toBe("1");

    // And the search box sees the same answer.
    await page.goto("/search");
    const input = page.getByTestId("search-input");
    await input.fill("");
    await input.click();
    await expect(page.getByTestId("search-history-off")).toBeChecked();
    await expect(page.getByTestId("search-history-item")).toHaveCount(0);

    await page.evaluate(() => window.localStorage.removeItem("bh-search-history-off"));
  });
});
